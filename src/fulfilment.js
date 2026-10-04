'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const wallet = require('./wallet');
const payments = require('./payments');
const notify = require('./notify');
const market = require('./market');
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

/** Puts an order's items back on the shelf of the offer they were sold from. */
function restock(d, orderId) {
  const items = d.prepare('SELECT product_id, offer_id, qty FROM order_items WHERE order_id = ?').all(orderId);
  const sold = d.prepare('UPDATE products SET sold_count = MAX(0, sold_count - ?) WHERE id = ?');
  for (const it of items) {
    if (it.offer_id) market.moveStock(d, it.offer_id, it.qty);
    else d.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
    sold.run(it.qty, it.product_id);
    if (it.offer_id) market.syncProduct(d, it.product_id);
  }
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

/**
 * Moves an order to `next`. `actor` is 'customer', 'seller', 'admin' or 'system'. Must run inside db.tx().
 * A self-shipping seller passes their own `courier` and `awb`; `quiet` skips the buyer message.
 */
function move(d, orderId, next, { actor = 'admin', note = '', refundToWallet = false, allowAny = false, courier, awb, quiet = false } = {}) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (actor === 'customer' && next === 'cancelled' && !CUSTOMER_CANCELLABLE.includes(o.status)) {
    throw new HttpError(400, 'This order can no longer be cancelled. Once it is delivered, you can return it.');
  }
  if (!allowAny && !(FLOW[o.status] || []).includes(next)) {
    throw new HttpError(400, `This order is ${LABEL[o.status].toLowerCase()} and cannot be moved to "${LABEL[next] || next}".`);
  }
  const now = Date.now();
  const set = { status: next, payment_status: o.payment_status, courier: o.courier, awb: o.awb, delivered_at: o.delivered_at, shipped_at: o.shipped_at };
  let text = '';
  let eventNote = note;

  if (next === 'confirmed') text = 'Your order is confirmed.';
  if (next === 'packed') text = 'Your order is packed and will ship soon.';
  if (next === 'shipped') {
    if (o.awb) {
      // The courier was booked when the seller packed the order; this is the pickup scan.
      text = `Shipped with ${set.courier}, tracking number ${set.awb}.`;
    } else if (o.delivery_speed === 'express') {
      set.courier = courier || 'Bazaario Express rider';
      set.awb = awb || `EXP${crypto.randomInt(1e7, 1e8)}`;
      text = 'A rider has picked up your Express order.';
      // Studio marked the pickup by hand: the rider's drop time starts now.
      if (o.rider_id && !o.rider_picked_at) {
        const route = JSON.parse(o.route);
        const hyper = require('./hyperlocal');
        d.prepare('UPDATE orders SET rider_picked_at = ?, eta_drop = ? WHERE id = ?')
          .run(now, now + (config.express.handoverMins + hyper.travelMins(route.km)) * 60_000, orderId);
      }
    } else if (courier && awb) {
      // Self Ship sellers book their own courier and enter its tracking number.
      set.courier = courier;
      set.awb = awb;
      text = `Shipped with ${set.courier}, tracking number ${set.awb}.`;
    } else {
      // Test courier: generates the airway bill number a shipping partner would return.
      set.courier = config.courierProvider === 'test' ? 'Bazaario Logistics' : config.courierProvider;
      set.awb = `BZL${crypto.randomInt(1e9, 1e10)}`;
      text = `Shipped with ${set.courier}, tracking number ${set.awb}.`;
    }
    set.shipped_at = now;
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
    // A friend's first delivered order rewards both people (referrals, blueprint stage 12).
    require('./growth').rewardReferral(d, o, now);
  }
  if (next === 'cancelled' || next === 'rto' || next === 'returned') {
    const reason = next === 'cancelled' ? `Refund for cancelled order ${o.order_no}` : next === 'rto' ? `Refund for undelivered order ${o.order_no}` : `Refund for returned order ${o.order_no}`;
    const r = settleRefund(d, { ...o, payment_status: set.payment_status }, { toWallet: refundToWallet, reason });
    set.payment_status = r.paymentStatus;
    restock(d, orderId);
    // An order cancelled while it waited for a seller closes that request too.
    d.prepare("UPDATE order_routes SET decided_at = ?, note = 'Order closed before the seller answered' WHERE order_id = ? AND outcome = 'waiting'")
      .run(now, orderId);
    eventNote = [eventNote, r.note].filter(Boolean).join(' ');
    // Partner shops are paid the day after delivery, so a later return is taken back from their next payout.
    if (next === 'returned' && o.payout_id) {
      const paid = d.prepare('SELECT net FROM payout_lines WHERE payout_id = ? AND order_id = ? AND claim_id IS NULL').get(o.payout_id, orderId);
      if (paid && !d.prepare('SELECT 1 FROM claims WHERE order_id = ?').get(orderId)) {
        d.prepare(`INSERT INTO claims (order_id, seller_id, reason, note, status, amount, decision_note, created_at, updated_at)
          VALUES (?,?,'Return after payout','The buyer returned this order after it was paid out.','approved',?,'Taken back from the next payout',?,?)`)
          .run(orderId, o.seller_id, -paid.net, now, now);
      }
    }
    text = next === 'cancelled' ? 'Your order is cancelled.' : next === 'rto' ? 'Your order could not be delivered and is coming back to us.' : 'Your return is complete.';
    if (r.note) text += ' ' + r.note;
  }

  d.prepare(`UPDATE orders SET status = ?, payment_status = ?, courier = ?, awb = ?, delivered_at = ?, shipped_at = ?, updated_at = ? WHERE id = ?`)
    .run(set.status, set.payment_status, set.courier, set.awb, set.delivered_at, set.shipped_at, now, orderId);
  event(d, orderId, next, eventNote);
  if (text && !quiet) notify.orderUpdate(d, o, text);
  // A packed Express order gets the nearest free rider straight away.
  if (next === 'packed' && o.delivery_speed === 'express') require('./hyperlocal').dispatch(d, orderId, now);
  // Shipping, delivery and cancellations feed the seller's performance score.
  if (o.seller_id && ['shipped', 'delivered', 'cancelled', 'returned'].includes(next)) market.refreshScore(d, o.seller_id);
  return { ...o, ...set };
}

module.exports = { FLOW, LABEL, CUSTOMER_CANCELLABLE, move, event, restock, settleRefund, fmtTime };
