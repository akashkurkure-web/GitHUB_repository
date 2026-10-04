'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const wallet = require('./wallet');
const payments = require('./payments');
const notify = require('./notify');
const { HttpError } = require('./security');

/**
 * Order life cycle (blueprint stage 8). Every change goes through move(), which records a timeline event,
 * settles money (COD collected, refunds to wallet or source), returns stock and messages the buyer.
 * Returns have their own steps in routes/returns, which end in move(..., 'returned').
 */
const FLOW = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered', 'delivery_failed'],
  delivery_failed: ['out_for_delivery', 'rto'],
  delivered: [],
  return_requested: [],
  returned: [],
  rto: [],
  cancelled: [],
};

const LABEL = {
  placed: 'Order placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', out_for_delivery: 'Out for delivery',
  delivery_failed: 'Delivery attempt failed', delivered: 'Delivered', rto: 'Returned to Bazaario', cancelled: 'Cancelled',
  return_requested: 'Return requested', returned: 'Returned and refunded',
};

const CUSTOMER_CANCELLABLE = ['placed', 'confirmed', 'packed'];

function event(d, orderId, status, note = '') {
  d.prepare('INSERT INTO order_events (order_id, status, note, created_at) VALUES (?,?,?,?)').run(orderId, status, note, Date.now());
}

function restock(d, orderId) {
  const items = d.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(orderId);
  const up = d.prepare('UPDATE products SET stock = stock + ?, sold_count = MAX(0, sold_count - ?) WHERE id = ?');
  for (const it of items) up.run(it.qty, it.qty, it.product_id);
}

const fmtTime = (ts) => new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Gives money back for a cancelled, refused or returned order.
 * Wallet money always goes back to the wallet. Money paid by card, UPI or EMI goes back to the source, or to the
 * wallet when the buyer asked for that. Cash collected on delivery can only be refunded to the wallet.
 */
function settleRefund(d, o, { toWallet = false, reason }) {
  const paidOnline = o.payment_status === 'paid' && o.payment_method !== 'cod' && o.payment_method !== 'wallet';
  const paidCash = o.payment_status === 'paid' && o.payment_method === 'cod';
  const gatewayAmount = paidOnline || paidCash ? o.total - o.wallet_used : 0;
  let back = o.wallet_used;
  let note = '';
  if (gatewayAmount > 0 && (toWallet || paidCash)) {
    back += gatewayAmount;
  } else if (gatewayAmount > 0) {
    const rf = payments.refund(o, gatewayAmount);
    note = `Refund of ₹${gatewayAmount / 100} sent to your ${o.payment_method.toUpperCase()} account (ref ${rf}). It can take 5-7 working days to show.`;
  }
  if (back > 0) {
    wallet.post(d, o.user_id, back, reason, o.id);
    note = [note, `₹${back / 100} added to your Bazaario wallet.`].filter(Boolean).join(' ');
  }
  const refunded = o.payment_status === 'paid' || o.wallet_used > 0;
  return { paymentStatus: refunded ? 'refunded' : o.payment_status, note };
}

/** Moves an order to `next`. `actor` is 'customer', 'admin' or 'system'. Must run inside db.tx(). */
function move(d, orderId, next, { actor = 'admin', note = '', refundToWallet = false, allowAny = false } = {}) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (actor === 'customer' && next === 'cancelled' && !CUSTOMER_CANCELLABLE.includes(o.status)) {
    throw new HttpError(400, 'This order can no longer be cancelled. Once it is delivered, you can return it.');
  }
  if (!allowAny && !(FLOW[o.status] || []).includes(next)) {
    throw new HttpError(400, `This order is ${LABEL[o.status].toLowerCase()} and cannot be moved to "${LABEL[next] || next}".`);
  }
  const now = Date.now();
  const set = { status: next, payment_status: o.payment_status, courier: o.courier, awb: o.awb, delivered_at: o.delivered_at };
  let text = '';
  let eventNote = note;

  if (next === 'confirmed') text = 'Your order is confirmed.';
  if (next === 'packed') text = 'Your order is packed and will ship soon.';
  if (next === 'shipped') {
    if (o.delivery_speed === 'express') {
      set.courier = 'Bazaario Express rider';
      set.awb = `EXP${crypto.randomInt(1e7, 1e8)}`;
      text = 'A rider has picked up your Express order.';
    } else {
      // Test courier: generates the airway bill number a shipping partner would return.
      set.courier = config.courierProvider === 'test' ? 'Bazaario Logistics' : config.courierProvider;
      set.awb = `BZL${crypto.randomInt(1e9, 1e10)}`;
      text = `Shipped with ${set.courier}, tracking number ${set.awb}.`;
    }
    eventNote = eventNote || `${set.courier} · ${set.awb}`;
  }
  if (next === 'out_for_delivery') text = o.payment_method === 'cod' ? `Out for delivery today. Please keep ₹${(o.total - o.wallet_used) / 100} ready.` : 'Out for delivery today.';
  if (next === 'delivery_failed') {
    text = 'We could not deliver your order today. Open your order to choose a new time.';
    eventNote = eventNote || 'Buyer not available';
  }
  if (next === 'delivered') {
    set.delivered_at = now;
    if (o.payment_method === 'cod' && o.payment_status === 'pending') set.payment_status = 'paid';
    text = 'Delivered. We hope you love it.';
  }
  if (next === 'cancelled' || next === 'rto' || next === 'returned') {
    const reason = next === 'cancelled' ? `Refund for cancelled order ${o.order_no}` : next === 'rto' ? `Refund for undelivered order ${o.order_no}` : `Refund for returned order ${o.order_no}`;
    const r = settleRefund(d, { ...o, payment_status: set.payment_status }, { toWallet: refundToWallet, reason });
    set.payment_status = r.paymentStatus;
    restock(d, orderId);
    eventNote = [eventNote, r.note].filter(Boolean).join(' ');
    text = next === 'cancelled' ? 'Your order is cancelled.' : next === 'rto' ? 'Your order could not be delivered and is coming back to us.' : 'Your return is complete.';
    if (r.note) text += ' ' + r.note;
  }

  d.prepare(`UPDATE orders SET status = ?, payment_status = ?, courier = ?, awb = ?, delivered_at = ?, updated_at = ? WHERE id = ?`)
    .run(set.status, set.payment_status, set.courier, set.awb, set.delivered_at, now, orderId);
  event(d, orderId, next, eventNote);
  if (text) notify.orderUpdate(d, o, text);
  return { ...o, ...set };
}

module.exports = { FLOW, LABEL, CUSTOMER_CANCELLABLE, move, event, restock, settleRefund, fmtTime };
