'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { quote } = require('../pricing');
const { HttpError, requireAuth, audit, v } = require('../security');

const router = express.Router();
router.use(requireAuth);

// ---------- Payment (mock gateway: validates input, never stores full card data) ----------
function luhn(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function processPayment(method, payment, total) {
  if (method === 'cod') {
    if (total > config.codMaxOrder) throw new HttpError(400, 'Cash on Delivery is not available for orders above ₹50,000.');
    return { status: 'pending', ref: null };
  }
  if (method === 'card') {
    const number = String((payment && payment.cardNumber) || '').replace(/[\s-]/g, '');
    const expiry = String((payment && payment.expiry) || '');
    const cvv = String((payment && payment.cvv) || '');
    if (!/^\d{12,19}$/.test(number) || !luhn(number)) throw new HttpError(400, 'Please enter a valid card number.');
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expiry);
    if (!m) throw new HttpError(400, 'Card expiry must be in MM/YY format.');
    const expEnd = new Date(2000 + Number(m[2]), Number(m[1]), 1).getTime();
    if (expEnd <= Date.now()) throw new HttpError(400, 'This card has expired.');
    if (!/^\d{3,4}$/.test(cvv)) throw new HttpError(400, 'Please enter a valid CVV.');
    // Only a masked reference is kept. In production, replace with a PCI-DSS compliant gateway
    // (Razorpay / PayU / Stripe) using client-side tokenisation so card data never touches this server.
    return { status: 'paid', ref: `CARD-xxxx${number.slice(-4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}` };
  }
  if (method === 'upi') {
    const vpa = String((payment && payment.upiId) || '');
    if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa)) throw new HttpError(400, 'Please enter a valid UPI ID (e.g. name@bank).');
    return { status: 'paid', ref: `UPI-${crypto.randomBytes(5).toString('hex').toUpperCase()}` };
  }
  throw new HttpError(400, 'Please choose a payment method.');
}

const orderNo = () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `BZ${ymd}-${crypto.randomInt(1e6, 1e7)}`;
};

router.post('/checkout/quote', (req, res) => {
  const coupon = req.body.coupon ? v.str(req.body.coupon, 'Coupon code', { max: 20, pattern: /^[A-Za-z0-9]+$/ }) : null;
  const q = quote(req.user.id, coupon, req.body.paymentMethod);
  res.json(q);
});

router.post('/orders', (req, res) => {
  const addressId = v.int(req.body.addressId, 'Delivery address', { min: 1 });
  const method = String(req.body.paymentMethod || '');
  const coupon = req.body.coupon ? v.str(req.body.coupon, 'Coupon code', { max: 20, pattern: /^[A-Za-z0-9]+$/ }) : null;
  const idem = req.body.idempotencyKey ? v.str(req.body.idempotencyKey, 'Idempotency key', { min: 8, max: 64, pattern: /^[A-Za-z0-9-]+$/ }) : null;

  // Double-click / retry protection: the same key returns the order already placed.
  if (idem) {
    const prior = db.get().prepare('SELECT id, order_no FROM orders WHERE user_id = ? AND idempotency_key = ?').get(req.user.id, idem);
    if (prior) return res.status(200).json({ orderId: prior.id, orderNo: prior.order_no, duplicate: true });
  }

  const address = db.get().prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(addressId, req.user.id);
  if (!address) throw new HttpError(400, 'Please choose a delivery address.');

  const result = db.tx((d) => {
    const q = quote(req.user.id, coupon, method);
    if (!q.lines.length) throw new HttpError(400, 'Your cart is empty.');
    for (const l of q.lines) {
      if (!l.active) throw new HttpError(409, `"${l.title}" is no longer available. Please remove it from your cart.`);
      if (l.qty > l.stock) throw new HttpError(409, `Only ${l.stock} unit(s) of "${l.title}" left. Please update your cart.`);
    }
    const pay = processPayment(method, req.body.payment, q.total);
    const now = Date.now();
    const no = orderNo();
    const snapshot = JSON.stringify({
      fullName: address.full_name, phone: address.phone, line1: address.line1, line2: address.line2,
      city: address.city, state: address.state, pincode: address.pincode,
    });
    const orderId = Number(d.prepare(`INSERT INTO orders (order_no, user_id, status, subtotal, discount, shipping, total, coupon_code,
        payment_method, payment_status, payment_ref, address, idempotency_key, created_at, updated_at)
        VALUES (?,?,'placed',?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, req.user.id, q.subtotal, q.discount, q.shipping + q.codFee, q.total, q.coupon, method, pay.status, pay.ref,
        snapshot, idem, now, now).lastInsertRowid);
    const insItem = d.prepare('INSERT INTO order_items (order_id, product_id, title, emoji, price, qty) VALUES (?,?,?,?,?,?)');
    // Conditional decrement guards against overselling under concurrency.
    const decStock = d.prepare('UPDATE products SET stock = stock - ?, sold_count = sold_count + ? WHERE id = ? AND stock >= ?');
    for (const l of q.lines) {
      insItem.run(orderId, l.product_id, l.title, l.emoji, l.price, l.qty);
      if (decStock.run(l.qty, l.qty, l.product_id, l.qty).changes !== 1) throw new HttpError(409, `"${l.title}" just went out of stock.`);
    }
    d.prepare('DELETE FROM cart_items WHERE user_id = ? AND saved_for_later = 0').run(req.user.id);
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
  delete o.idempotency_key;
  return o;
}

router.get('/orders', (req, res) => {
  const orders = db.get().prepare(
    `SELECT id, order_no, status, total, payment_method, payment_status, created_at, delivered_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
  ).all(req.user.id);
  const items = db.get().prepare(ITEMS_SQL);
  for (const o of orders) o.items = items.all(o.id);
  res.json({ orders });
});

router.get('/orders/:id', (req, res) => {
  res.json({ order: loadOrder(req.user.id, v.int(req.params.id, 'Order', { min: 1 })) });
});

function restock(d, orderId) {
  const items = d.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(orderId);
  const up = d.prepare('UPDATE products SET stock = stock + ?, sold_count = MAX(0, sold_count - ?) WHERE id = ?');
  for (const it of items) up.run(it.qty, it.qty, it.product_id);
}

router.post('/orders/:id/cancel', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  db.tx((d) => {
    const o = d.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (!['placed', 'packed'].includes(o.status)) throw new HttpError(400, 'This order can no longer be cancelled.');
    d.prepare(`UPDATE orders SET status = 'cancelled', payment_status = CASE WHEN payment_status = 'paid' THEN 'refunded' ELSE payment_status END,
      updated_at = ? WHERE id = ?`).run(Date.now(), id);
    restock(d, id);
  });
  audit(req, 'order.cancel', { orderId: id });
  res.json({ order: loadOrder(req.user.id, id) });
});

router.post('/orders/:id/return', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const o = db.get().prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (o.status !== 'delivered') throw new HttpError(400, 'Only delivered orders can be returned.');
  if (Date.now() - o.delivered_at > config.returnWindowDays * 86400_000) {
    throw new HttpError(400, `The ${config.returnWindowDays}-day return window for this order has closed.`);
  }
  db.get().prepare("UPDATE orders SET status = 'return_requested', updated_at = ? WHERE id = ?").run(Date.now(), id);
  audit(req, 'order.return_request', { orderId: id });
  res.json({ order: loadOrder(req.user.id, id) });
});

module.exports = { router, loadOrder, restock };
