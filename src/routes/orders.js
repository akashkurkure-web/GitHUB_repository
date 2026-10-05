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
const market = require('../market');
const routing = require('../routing');
const hyper = require('../hyperlocal');
const { invoice } = require('../invoice');
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
  let state = null;
  if (body.addressId) {
    const a = db.get().prepare('SELECT pincode, state FROM addresses WHERE id = ? AND user_id = ?').get(Number(body.addressId), userId);
    if (a) ({ pincode, state } = a);
  }
  return { coupon, speed, pincode, state, useWallet: !!body.useWallet };
}

router.post('/checkout/quote', (req, res) => {
  const c = readCheckout(req.body, req.user.id);
  res.json(quote(req.user.id, c.coupon, req.body.paymentMethod, c));
});

/** Splits `amount` across parts in proportion to `weights`; rounding leftovers go to the first part. */
function allocate(amount, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => (sum ? Math.floor((amount * w) / sum) : 0));
  parts[0] += amount - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/**
 * Places the bag. Each seller's items become their own order (their own package, tracking and invoice);
 * the orders share one checkout reference and one payment. Fees sit on the first order and the coupon and wallet
 * are shared in proportion, so refunding any one order gives back exactly what was paid for it.
 */
router.post('/orders', (req, res) => {
  const addressId = v.int(req.body.addressId, 'Delivery address', { min: 1 });
  let method = String(req.body.paymentMethod || '');
  const c = readCheckout(req.body, req.user.id);
  const idem = req.body.idempotencyKey ? v.str(req.body.idempotencyKey, 'Idempotency key', { min: 8, max: 64, pattern: /^[A-Za-z0-9-]+$/ }) : null;

  // Double-click / retry protection: the same key returns the orders already placed.
  if (idem) {
    const prior = db.get().prepare('SELECT id, order_no, checkout_ref FROM orders WHERE user_id = ? AND idempotency_key = ?').get(req.user.id, idem);
    if (prior) {
      const orders = db.get().prepare('SELECT id, order_no AS orderNo FROM orders WHERE checkout_ref = ? ORDER BY id').all(prior.checkout_ref);
      return res.status(200).json({ orderId: prior.id, orderNo: prior.order_no, checkoutRef: prior.checkout_ref, orders, duplicate: true });
    }
  }

  const address = db.get().prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(addressId, req.user.id);
  if (!address) throw new HttpError(400, 'Please choose a delivery address.');

  const result = db.tx((d) => {
    const q = quote(req.user.id, c.coupon, method, c);
    if (!q.lines.length) throw new HttpError(400, 'Your cart is empty.');
    for (const l of q.lines) {
      if (!l.active) throw new HttpError(409, `"${l.title}" is no longer available. Please remove it from your cart.`);
      if (l.qty > l.stock) throw new HttpError(409, `Only ${l.stock} unit(s) of "${l.title}" left. Please update your cart.`);
      if (l.blocked) throw new HttpError(409, `"${l.title}": ${l.blocked} Please choose another seller for this address.`);
    }
    if (c.speed === 'express' && q.speed !== 'express') {
      throw new HttpError(409, 'Express delivery is not available for this address or these items. Please choose Standard delivery.');
    }
    if (q.payable === 0) method = 'wallet';
    if (method === 'cod' && !q.cod.ok) throw new HttpError(400, q.cod.reason);
    const pay = payments.charge(method, req.body.payment, q.payable);
    const now = Date.now();
    const checkoutRef = `CK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const snapshot = JSON.stringify({
      fullName: address.full_name, phone: address.phone, line1: address.line1, line2: address.line2,
      city: address.city, state: address.state, pincode: address.pincode,
    });
    const byId = new Map(q.lines.map((l) => [l.product_id, l]));
    const packs = q.packages.map((p) => ({ ...p, lines: p.lines.map((id) => byId.get(id)) }));
    const subs = packs.map((p) => p.lines.reduce((s, l) => s + l.price * l.qty, 0));
    // Sale discounts belong to the package they were on; the coupon is shared in proportion.
    const saleOffs = packs.map((p) => p.lines.reduce((s, l) => s + l.sale_off * l.qty, 0));
    const coupons = allocate(q.couponDiscount, subs.map((sub, i) => sub - saleOffs[i]));
    const discounts = coupons.map((c, i) => c + saleOffs[i]);
    const fees = q.shipping + q.expressFee + q.codFee;
    const totals = subs.map((sub, i) => sub - discounts[i] + (i === 0 ? fees : 0));
    const wallets = allocate(q.walletApplied, totals);
    const holdReason = routing.riskHold(d, { userId: req.user.id, method, payable: q.payable, lines: q.lines, now });

    const insOrder = d.prepare(`INSERT INTO orders (order_no, user_id, status, subtotal, discount, shipping, total, wallet_used,
        coupon_code, payment_method, payment_status, payment_ref, emi_months, delivery_speed, promised_at, address, idempotency_key,
        seller_id, checkout_ref, created_at, updated_at) VALUES (?,?,'placed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insItem = d.prepare(`INSERT INTO order_items (order_id, product_id, offer_id, title, emoji, price, qty, hsn, gst_rate, share_id, reseller_margin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const sold = d.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?');
    const orders = [];
    packs.forEach((p, i) => {
      const no = orderNo();
      const orderId = Number(insOrder.run(no, req.user.id, subs[i], discounts[i], i === 0 ? fees : 0, totals[i], wallets[i], q.coupon,
        method, pay.status, pay.ref, pay.emiMonths || null, p.speed, p.promisedAt || q.promisedAt, snapshot, i === 0 ? idem : null,
        p.sellerId, checkoutRef, now, now).lastInsertRowid);
      // What Plus saved on this checkout (free delivery, lower Express fee) is kept on its first order.
      const plusSaved = q.plus && i === 0 ? q.plus.shippingSaved + q.plus.expressSaved : 0;
      d.prepare('UPDATE orders SET sale_discount = ?, plus = ?, plus_saved = ? WHERE id = ?').run(saleOffs[i], q.plus ? 1 : 0, plusSaved, orderId);
      for (const l of p.lines) {
        insItem.run(orderId, l.product_id, l.offer_id, l.title, l.emoji, l.price, l.qty, l.hsn, l.gst_rate, l.share_id, l.reseller_margin);
        // Conditional decrement guards against overselling under concurrency.
        if (!market.moveStock(d, l.offer_id, -l.qty)) throw new HttpError(409, `"${l.title}" just went out of stock.`);
        sold.run(l.qty, l.product_id);
        market.syncProduct(d, l.product_id);
      }
      if (wallets[i]) wallet.post(d, req.user.id, -wallets[i], `Paid for order ${no}`, orderId);
      event(d, orderId, 'placed', method === 'cod' ? 'Cash on Delivery' : `Paid by ${method.toUpperCase()}`);
      const o = { id: orderId, order_no: no, user_id: req.user.id, address: snapshot };
      if (holdReason) {
        routing.hold(d, orderId, holdReason);
        notify.orderUpdate(d, o, 'Thank you! We have received your order and are checking a few details before sending it.');
      } else {
        const seller = d.prepare('SELECT * FROM sellers WHERE id = ?').get(p.sellerId);
        const near = seller.lane === 'shop' ? p.lines[0].shop : null;
        const reason = seller.lane === 'shop' ? `Express from ${seller.display_name}${near && near.km !== null ? `, ${near.km} km away` : ''}`
          : p.speed === 'express' ? 'Express from a Bazaario city store'
              : seller.lane === 'direct' ? 'Bazaario warehouse has stock'
                : seller.fulfilment === 'fulfilled' ? `${seller.display_name}'s stock in the Bazaario warehouse` : `Best offer from ${seller.display_name}`;
        routing.assign(d, orderId, p.sellerId, reason, now);
        const at = p.promisedAt || q.promisedAt;
        const when = !at ? '' : p.speed === 'express' ? ` by ${fmtTime(at)}` : ` by ${fmtTime(at).split(',').slice(0, 2).join(',')}`;
        const lead = routing.handledByBazaario(seller) ? 'Your order is confirmed' : 'We have received your order';
        notify.orderUpdate(d, o, `Thank you! ${lead} and it will arrive${when}.${packs.length > 1 ? ` It is package ${i + 1} of ${packs.length}.` : ''}`);
      }
      orders.push({ id: orderId, orderNo: no });
    });
    d.prepare('DELETE FROM cart_items WHERE user_id = ? AND saved_for_later = 0').run(req.user.id);
    return { orderId: orders[0].id, orderNo: orders[0].orderNo, checkoutRef, orders, total: q.total };
  });
  audit(req, 'order.place', { checkoutRef: result.checkoutRef, orders: result.orders.map((o) => o.id), total: result.total });
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
  const seller = o.seller_id ? db.get().prepare('SELECT * FROM sellers WHERE id = ?').get(o.seller_id) : null;
  o.seller = seller ? market.publicSeller(seller) : null;
  o.packages = o.checkout_ref ? db.get().prepare('SELECT COUNT(*) AS n FROM orders WHERE checkout_ref = ?').get(o.checkout_ref).n : 1;
  // Express orders: the rider, where they are now and the route for the live map.
  o.rider = null;
  if (o.rider_id && o.route) {
    const r = db.get().prepare('SELECT name, phone FROM riders WHERE id = ?').get(o.rider_id);
    const route = JSON.parse(o.route);
    o.rider = { name: r ? r.name : 'Rider', phone: r ? r.phone : '', etaPickup: o.eta_pickup, etaDrop: o.eta_drop, pickedAt: o.rider_picked_at,
      route, position: hyper.position(o) };
  }
  delete o.route;
  if (!isAdmin) delete o.rider_fee;
  // Buyers see that the order is being checked, not the risk rule that held it.
  if (!isAdmin) o.hold_reason = o.hold_reason ? 'review' : null;
  delete o.idempotency_key;
  return o;
}

router.get('/orders', (req, res) => {
  const ref = typeof req.query.ref === 'string' && /^CK-[0-9A-F]{12}$/.test(req.query.ref) ? req.query.ref : null;
  const orders = db.get().prepare(
    `SELECT o.id, o.order_no, o.status, o.total, o.payment_method, o.payment_status, o.delivery_speed, o.promised_at, o.created_at,
            o.delivered_at, o.checkout_ref, o.hold_reason IS NOT NULL AS on_hold, s.display_name AS seller_name
       FROM orders o LEFT JOIN sellers s ON s.id = o.seller_id
      WHERE o.user_id = ? ${ref ? 'AND o.checkout_ref = ?' : ''} ORDER BY o.created_at DESC, o.id LIMIT 100`
  ).all(req.user.id, ...(ref ? [ref] : []));
  const items = db.get().prepare(ITEMS_SQL);
  for (const o of orders) o.items = items.all(o.id);
  res.json({ orders });
});

router.get('/orders/:id', (req, res) => {
  res.json({ order: loadOrder(req.user.id, v.int(req.params.id, 'Order', { min: 1 })) });
});

// GST invoice from the seller, once the order has shipped.
router.get('/orders/:id/invoice', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const o = db.get().prepare('SELECT status FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (!['shipped', 'out_for_delivery', 'delivery_failed', 'delivered', 'return_requested', 'returned'].includes(o.status)) {
    throw new HttpError(400, 'The invoice is ready once your order ships.');
  }
  res.json({ invoice: invoice(db.get(), id) });
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
    if (o.seller_id) market.refreshScore(d, o.seller_id);
  });
  audit(req, 'order.return_request', { orderId: id });
  res.json({ order: loadOrder(req.user.id, id) });
});

// ---------- Wallet ----------
router.get('/wallet', (req, res) => {
  res.json({ balance: wallet.balance(req.user.id), entries: wallet.history(req.user.id) });
});

module.exports = { router, loadOrder, restock, LABEL };
