'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { quote } = require('../pricing');
const payments = require('../payments');
const wallet = require('../wallet');
const notify = require('../notify');
const { move, event, restock, LABEL, fmtTime } = require('../fulfilment');
const { HttpError, requireAuth, audit, v } = require('../security');

const router = express.Router();
router.use(requireAuth);

const orderNo = () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `BZ${ymd}-${crypto.randomInt(1e6, 1e7)}`;
};

function readCheckout(body, userId) {
  const coupon = body.coupon ? v.str(body.coupon, 'Coupon code', { max: 20, pattern: /^[A-Za-z0-9]+$/ }) : null;
  const speed = body.speed === 'express' ? 'express' : 'standard';
  let pincode = null;
  if (body.addressId) {
    const a = db.get().prepare('SELECT pincode FROM addresses WHERE id = ? AND user_id = ?').get(Number(body.addressId), userId);
    if (a) pincode = a.pincode;
  }
  return { coupon, speed, pincode, useWallet: !!body.useWallet };
}

router.post('/checkout/quote', (req, res) => {
  const c = readCheckout(req.body, req.user.id);
  res.json(quote(req.user.id, c.coupon, req.body.paymentMethod, c));
});

router.post('/orders', (req, res) => {
  const addressId = v.int(req.body.addressId, 'Delivery address', { min: 1 });
  let method = String(req.body.paymentMethod || '');
  const c = readCheckout(req.body, req.user.id);
  const idem = req.body.idempotencyKey ? v.str(req.body.idempotencyKey, 'Idempotency key', { min: 8, max: 64, pattern: /^[A-Za-z0-9-]+$/ }) : null;

  // Double-click / retry protection: the same key returns the order already placed.
  if (idem) {
    const prior = db.get().prepare('SELECT id, order_no FROM orders WHERE user_id = ? AND idempotency_key = ?').get(req.user.id, idem);
    if (prior) return res.status(200).json({ orderId: prior.id, orderNo: prior.order_no, duplicate: true });
  }

  const address = db.get().prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(addressId, req.user.id);
  if (!address) throw new HttpError(400, 'Please choose a delivery address.');

  const result = db.tx((d) => {
    const q = quote(req.user.id, c.coupon, method, c);
    if (!q.lines.length) throw new HttpError(400, 'Your cart is empty.');
    for (const l of q.lines) {
      if (!l.active) throw new HttpError(409, `"${l.title}" is no longer available. Please remove it from your cart.`);
      if (l.qty > l.stock) throw new HttpError(409, `Only ${l.stock} unit(s) of "${l.title}" left. Please update your cart.`);
    }
    if (c.speed === 'express' && q.speed !== 'express') {
      throw new HttpError(409, 'Express delivery is not available for this address or these items. Please choose Standard delivery.');
    }
    if (q.payable === 0) method = 'wallet';
    if (method === 'cod' && !q.cod.ok) throw new HttpError(400, q.cod.reason);
    const pay = payments.charge(method, req.body.payment, q.payable);
    const now = Date.now();
    const no = orderNo();
    const snapshot = JSON.stringify({
      fullName: address.full_name, phone: address.phone, line1: address.line1, line2: address.line2,
      city: address.city, state: address.state, pincode: address.pincode,
    });
    const orderId = Number(d.prepare(`INSERT INTO orders (order_no, user_id, status, subtotal, discount, shipping, total, wallet_used,
        coupon_code, payment_method, payment_status, payment_ref, emi_months, delivery_speed, promised_at, address, idempotency_key,
        created_at, updated_at) VALUES (?,?,'confirmed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, req.user.id, q.subtotal, q.discount, q.shipping + q.expressFee + q.codFee, q.total, q.walletApplied, q.coupon,
        method, pay.status, pay.ref, pay.emiMonths || null, q.speed, q.promisedAt, snapshot, idem, now, now).lastInsertRowid);
    const insItem = d.prepare('INSERT INTO order_items (order_id, product_id, title, emoji, price, qty) VALUES (?,?,?,?,?,?)');
    // Conditional decrement guards against overselling under concurrency.
    const decStock = d.prepare('UPDATE products SET stock = stock - ?, sold_count = sold_count + ? WHERE id = ? AND stock >= ?');
    for (const l of q.lines) {
      insItem.run(orderId, l.product_id, l.title, l.emoji, l.price, l.qty);
      if (decStock.run(l.qty, l.qty, l.product_id, l.qty).changes !== 1) throw new HttpError(409, `"${l.title}" just went out of stock.`);
    }
    if (q.walletApplied) wallet.post(d, req.user.id, -q.walletApplied, `Paid for order ${no}`, orderId);
    d.prepare('DELETE FROM cart_items WHERE user_id = ? AND saved_for_later = 0').run(req.user.id);
    // Payment and the COD risk check passed above, so the order is confirmed straight away.
    event(d, orderId, 'placed');
    event(d, orderId, 'confirmed', method === 'cod' ? 'Cash on Delivery' : `Paid by ${method.toUpperCase()}`);
    const when = q.speed === 'express' ? `by ${fmtTime(q.promisedAt)}` : `by ${fmtTime(q.promisedAt).split(',').slice(0, 2).join(',')}`;
    notify.orderUpdate(d, { id: orderId, order_no: no, user_id: req.user.id, address: snapshot },
      `Thank you! Your order is confirmed and will arrive ${when}.`);
    return { orderId, orderNo: no, total: q.total };
  });
  audit(req, 'order.place', result);
  res.status(201).json(result);
});

// Line items keep the title and price from the time of purchase; the photo comes from the current product.
const ITEMS_SQL = `SELECT oi.product_id, oi.title, oi.emoji, oi.price, oi.qty, COALESCE(p.image, '') AS image
  FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`;

function loadOrder(userId, id, isAdmin = false) {
  const o = isAdmin
    ? db.get().prepare('SELECT * FROM orders WHERE id = ?').get(id)
    : db.get().prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!o) throw new HttpError(404, 'Order not found.');
  o.address = JSON.parse(o.address);
  o.items = db.get().prepare(ITEMS_SQL).all(id);
  o.events = db.get().prepare('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').all(id);
  o.return = db.get().prepare('SELECT reason, comment, refund_to, status, note, created_at, updated_at FROM returns WHERE order_id = ?').get(id) || null;
  delete o.idempotency_key;
  return o;
}

router.get('/orders', (req, res) => {
  const orders = db.get().prepare(
    `SELECT id, order_no, status, total, payment_method, payment_status, delivery_speed, promised_at, created_at, delivered_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
  ).all(req.user.id);
  const items = db.get().prepare(ITEMS_SQL);
  for (const o of orders) o.items = items.all(o.id);
  res.json({ orders });
});

router.get('/orders/:id', (req, res) => {
  res.json({ order: loadOrder(req.user.id, v.int(req.params.id, 'Order', { min: 1 })) });
});

router.post('/orders/:id/cancel', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  db.tx((d) => {
    const o = d.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!o) throw new HttpError(404, 'Order not found.');
    move(d, id, 'cancelled', { actor: 'customer', note: 'Cancelled by you' });
  });
  audit(req, 'order.cancel', { orderId: id });
  res.json({ order: loadOrder(req.user.id, id) });
});

// After a failed delivery the buyer picks when the courier should try again (blueprint stage 8, NDR).
const REATTEMPT = { tomorrow: 'Try again tomorrow', evening: 'Try again tomorrow evening', weekend: 'Try again on the weekend' };
router.post('/orders/:id/reattempt', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const when = REATTEMPT[req.body.when];
  if (!when) throw new HttpError(400, 'Please choose when we should try again.');
  const note = v.str(req.body.note, 'Note for the delivery partner', { max: 200, optional: true });
  db.tx((d) => {
    const o = d.prepare('SELECT status FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (o.status !== 'delivery_failed') throw new HttpError(400, 'This order is not waiting for a new delivery time.');
    event(d, id, 'reattempt_requested', [when, note].filter(Boolean).join('. '));
  });
  audit(req, 'order.reattempt', { orderId: id });
  res.json({ order: loadOrder(req.user.id, id) });
});

// ---------- Returns (blueprint stage 9) ----------
const RETURN_REASONS = [
  'Item is damaged or defective', 'Received a different item', 'Size or fit is not right', 'Quality is not as expected',
  'Item is missing parts', 'No longer needed',
];

router.get('/returns/reasons', (_req, res) => res.json({ reasons: RETURN_REASONS }));

router.post('/orders/:id/return', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const reason = String(req.body.reason || '');
  if (!RETURN_REASONS.includes(reason)) throw new HttpError(400, 'Please choose a reason for the return.');
  const comment = v.str(req.body.comment, 'Details', { max: 1000, optional: true });
  db.tx((d) => {
    const o = d.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (o.status !== 'delivered') throw new HttpError(400, 'Only delivered orders can be returned.');
    if (Date.now() - o.delivered_at > config.returnWindowDays * 86400_000) {
      throw new HttpError(400, `The ${config.returnWindowDays}-day return window for this order has closed.`);
    }
    if (d.prepare('SELECT 1 FROM returns WHERE order_id = ?').get(id)) throw new HttpError(409, 'A return was already requested for this order.');
    // Cash collected on delivery can only come back to the wallet.
    const refundTo = o.payment_method === 'cod' || o.payment_method === 'wallet' || req.body.refundTo === 'wallet' ? 'wallet' : 'source';
    const now = Date.now();
    d.prepare(`INSERT INTO returns (order_id, user_id, reason, comment, refund_to, status, created_at, updated_at)
      VALUES (?,?,?,?,?,'requested',?,?)`).run(id, req.user.id, reason, comment, refundTo, now, now);
    d.prepare("UPDATE orders SET status = 'return_requested', updated_at = ? WHERE id = ?").run(now, id);
    event(d, id, 'return_requested', reason);
    notify.orderUpdate(d, o, 'We have received your return request. We will confirm the pickup shortly.');
  });
  audit(req, 'order.return_request', { orderId: id });
  res.json({ order: loadOrder(req.user.id, id) });
});

// ---------- Wallet ----------
router.get('/wallet', (req, res) => {
  res.json({ balance: wallet.balance(req.user.id), entries: wallet.history(req.user.id) });
});

module.exports = { router, loadOrder, restock, LABEL };
