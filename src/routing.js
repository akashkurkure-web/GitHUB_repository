'use strict';
const config = require('./config');
const db = require('./db');
const market = require('./market');
const notify = require('./notify');
const { move, event } = require('./fulfilment');
const { HttpError } = require('./security');

/**
 * Order routing (blueprint stage 6): the decision that joins the three speeds.
 *  1. Risk first: risky orders are held for a person to check.
 *  2. Bazaario Direct and Bazaario Fulfilled stock ships from our warehouse, confirmed at once.
 *  3. Seller stock goes to the seller with the best offer, who must accept within 24 hours.
 *     If they reject it or the time runs out, the order moves to the next seller who has every item at the
 *     same price or less. If no one can take it, it is cancelled and refunded.
 * Express orders always come from Bazaario's own stock (partner shops join in Phase C).
 */
const M = config.market;
const HOUR = 3600_000;

/** Returns why an order should be held for review, or null. */
function riskHold(d, { userId, method, payable, lines, now = Date.now() }) {
  const user = d.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
  if (method === 'cod' && payable > M.holdCodAbove && now - user.created_at < M.holdNewAccountMs) {
    return `Cash on Delivery above ₹${(M.holdCodAbove / 100).toLocaleString('en-IN')} from an account opened today`;
  }
  if (method === 'cod' && d.prepare("SELECT 1 FROM orders WHERE user_id = ? AND status = 'rto' AND payment_method = 'cod'").get(userId)) {
    return 'An earlier Cash on Delivery order was refused';
  }
  const bulk = lines.find((l) => l.qty >= M.holdBulkQty);
  if (bulk) return `Bulk order: ${bulk.qty} units of one item`;
  return null;
}

const handledByBazaario = (s) => s.lane === 'direct' || s.fulfilment === 'fulfilled';

function sellerContact(d, s) {
  if (s.email) return s.email;
  const u = s.user_id ? d.prepare('SELECT email FROM users WHERE id = ?').get(s.user_id) : null;
  return u ? u.email : null;
}

function tellSeller(d, s, order, text) {
  notify.send(d, { userId: s.user_id, orderId: order.id, channel: 'email', recipient: sellerContact(d, s), body: `${config.storeName} Seller Hub: ${text} Order ${order.order_no}.` });
}

/** Days the seller needs to hand the order to the courier (the slowest item). */
function dispatchDays(d, orderId) {
  return d.prepare(`SELECT COALESCE(MAX(o.dispatch_days), 1) AS n FROM order_items i LEFT JOIN offers o ON o.id = i.offer_id
    WHERE i.order_id = ?`).get(orderId).n;
}

/** Sends an order to a seller. Warehouse orders are confirmed at once; seller orders wait for the seller. */
function assign(d, orderId, sellerId, reason, now = Date.now()) {
  const s = d.prepare('SELECT * FROM sellers WHERE id = ?').get(sellerId);
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  d.prepare('UPDATE orders SET seller_id = ?, route_reason = ?, hold_reason = NULL, updated_at = ? WHERE id = ?').run(sellerId, reason, now, orderId);
  if (handledByBazaario(s)) {
    d.prepare("INSERT INTO order_routes (order_id, seller_id, outcome, note, created_at, decided_at) VALUES (?,?,'accepted',?,?,?)")
      .run(orderId, sellerId, reason, now, now);
    d.prepare('UPDATE orders SET accept_by = NULL, dispatch_by = ? WHERE id = ?').run(now + dispatchDays(d, orderId) * 24 * HOUR, orderId);
    const paid = o.payment_method === 'cod' ? 'Cash on Delivery' : `Paid by ${o.payment_method.toUpperCase()}`;
    move(d, orderId, 'confirmed', { actor: 'system', note: s.lane === 'direct' ? paid : `${paid}. Ships from the Bazaario warehouse.`, quiet: true });
  } else {
    d.prepare("INSERT INTO order_routes (order_id, seller_id, outcome, note, created_at) VALUES (?,?,'waiting',?,?)").run(orderId, sellerId, reason, now);
    d.prepare('UPDATE orders SET accept_by = ? WHERE id = ?').run(now + M.acceptHours * HOUR, orderId);
    event(d, orderId, 'sent_to_seller', `Sent to ${s.display_name}`);
    tellSeller(d, s, o, `New order to accept within ${M.acceptHours} hours.`);
  }
}

/** Holds an order for review (risk check). */
function hold(d, orderId, reason) {
  d.prepare('UPDATE orders SET hold_reason = ?, updated_at = ? WHERE id = ?').run(reason, Date.now(), orderId);
  event(d, orderId, 'on_hold', 'We are checking a few details before sending your order');
}

/** Studio released a held order: route it as usual. */
function release(d, orderId) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (!o.hold_reason || o.status !== 'placed') throw new HttpError(400, 'This order is not on hold.');
  assign(d, orderId, o.seller_id, `Released after review: ${o.hold_reason}`);
}

function sellerOrder(d, orderId, sellerId) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ? AND seller_id = ?').get(orderId, sellerId);
  if (!o) throw new HttpError(404, 'Order not found.');
  return o;
}

function decide(d, orderId, sellerId, outcome, note = '') {
  d.prepare("UPDATE order_routes SET outcome = ?, note = CASE WHEN ? = '' THEN note ELSE ? END, decided_at = ? WHERE order_id = ? AND seller_id = ? AND outcome IN ('waiting','accepted')")
    .run(outcome, note, note, Date.now(), orderId, sellerId);
}

/** The seller confirms they will ship the order. */
function accept(d, orderId, sellerId) {
  const o = sellerOrder(d, orderId, sellerId);
  if (o.status !== 'placed' || o.hold_reason) throw new HttpError(400, 'This order is not waiting for you to accept it.');
  const now = Date.now();
  decide(d, orderId, sellerId, 'accepted');
  d.prepare('UPDATE orders SET accept_by = NULL, dispatch_by = ? WHERE id = ?').run(now + dispatchDays(d, orderId) * 24 * HOUR, orderId);
  const s = d.prepare('SELECT display_name FROM sellers WHERE id = ?').get(sellerId);
  move(d, orderId, 'confirmed', { actor: 'seller', note: `Confirmed by ${s.display_name}` });
  market.refreshScore(d, sellerId);
}

/**
 * Finds the next seller who has every item of the order in stock at the price the buyer paid or less,
 * and who can deliver to the buyer's state. Sellers who already had this order are skipped.
 */
function nextSeller(d, o) {
  const items = d.prepare('SELECT product_id, offer_id, qty, price FROM order_items WHERE order_id = ?').all(o.id);
  const tried = new Set(d.prepare('SELECT seller_id FROM order_routes WHERE order_id = ?').all(o.id).map((r) => r.seller_id));
  const state = JSON.parse(o.address).state;
  const bySeller = new Map();
  for (const it of items) {
    const offers = market.rankOffers(market.offersFor(d, it.product_id))
      .filter((of) => !tried.has(of.seller_id) && of.stock >= it.qty && of.price <= it.price && market.deliverable(of, state)
        && (o.delivery_speed !== 'express' || of.lane === 'direct'));
    for (const of of offers) {
      if (!bySeller.has(of.seller_id)) bySeller.set(of.seller_id, { sellerId: of.seller_id, name: of.seller_name, score: of.score, picks: [], cost: 0 });
      const c = bySeller.get(of.seller_id);
      if (!c.picks.some((p) => p.item === it)) { c.picks.push({ item: it, offer: of }); c.cost += of.price * it.qty; }
    }
  }
  return [...bySeller.values()].filter((c) => c.picks.length === items.length)
    .sort((a, b) => a.cost - b.cost || (b.score ?? 70) - (a.score ?? 70))[0] || null;
}

/** Moves an order away from a seller who could not ship it, or cancels it when no one else can. */
function reroute(d, orderId, why) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const from = d.prepare('SELECT display_name FROM sellers WHERE id = ?').get(o.seller_id);
  const next = nextSeller(d, o);
  if (!next) {
    move(d, orderId, 'cancelled', { actor: 'system', allowAny: true, note: `No other seller could take this order (${why}).` });
    return null;
  }
  const touched = new Set();
  for (const { item, offer } of next.picks) {
    if (item.offer_id) market.moveStock(d, item.offer_id, item.qty);
    if (!market.moveStock(d, offer.id, -item.qty)) throw new HttpError(409, 'Stock changed while moving the order. Please try again.');
    d.prepare('UPDATE order_items SET offer_id = ? WHERE order_id = ? AND product_id = ?').run(offer.id, orderId, item.product_id);
    touched.add(item.product_id);
  }
  for (const pid of touched) market.syncProduct(d, pid);
  event(d, orderId, 'rerouted', `Moved from ${from.display_name} to ${next.name}`);
  assign(d, orderId, next.sellerId, `Moved from ${from.display_name}: ${why}`);
  return next.sellerId;
}

/** The seller cannot ship the order. */
function reject(d, orderId, sellerId, reason) {
  const o = sellerOrder(d, orderId, sellerId);
  if (o.status !== 'placed' || o.hold_reason) throw new HttpError(400, 'This order is not waiting for you to accept it.');
  decide(d, orderId, sellerId, 'rejected', reason);
  const next = reroute(d, orderId, `seller could not ship: ${reason}`);
  market.refreshScore(d, sellerId);
  return next;
}

/** The seller accepted but now cannot ship. Counts against their score like a rejection. */
function sellerCancel(d, orderId, sellerId, reason) {
  const o = sellerOrder(d, orderId, sellerId);
  if (!['confirmed', 'packed'].includes(o.status)) throw new HttpError(400, 'Only orders that have not shipped can be cancelled.');
  decide(d, orderId, sellerId, 'seller_cancelled', reason);
  d.prepare("UPDATE orders SET status = 'placed', updated_at = ? WHERE id = ?").run(Date.now(), orderId);
  const next = reroute(d, orderId, `seller cancelled: ${reason}`);
  market.refreshScore(d, sellerId);
  return next;
}

/** Orders a seller did not accept in time move on. Runs every few minutes and before order lists load. */
function sweep(now = Date.now()) {
  const d = db.get();
  const late = d.prepare("SELECT id, seller_id FROM orders WHERE status = 'placed' AND hold_reason IS NULL AND accept_by IS NOT NULL AND accept_by < ?").all(now);
  for (const o of late) {
    db.tx((t) => {
      const cur = t.prepare('SELECT status, accept_by FROM orders WHERE id = ?').get(o.id);
      if (cur.status !== 'placed' || !cur.accept_by || cur.accept_by >= now) return;
      decide(t, o.id, o.seller_id, 'expired', `Not confirmed within ${M.acceptHours} hours`);
      reroute(t, o.id, `not confirmed within ${M.acceptHours} hours`);
      market.refreshScore(t, o.seller_id);
    });
  }
  return late.length;
}

module.exports = { riskHold, assign, hold, release, accept, reject, sellerCancel, reroute, sweep, handledByBazaario, tellSeller };
