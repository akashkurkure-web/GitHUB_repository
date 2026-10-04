'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const market = require('./market');
const notify = require('./notify');

/**
 * Settlement and payouts (blueprint stage 10).
 * Buyer money is held until the return window closes. Then each seller is paid the item price minus Bazaario's
 * commission and fulfilment fee, GST on those fees, GST TCS (section 52) and income-tax TDS (section 194-O).
 * Coupons are funded by Bazaario, so they never reduce what the seller receives.
 * The test payout provider records a UTR reference; a real payout partner (RazorpayX, Cashfree Payouts) sends the money.
 */
const M = config.market;
const DAY = 86400_000;
const pctOf = (amount, pct) => Math.round((amount * pct) / 100);

/** What one delivered order earns its seller. */
function breakdown(d, order, seller) {
  const items = d.prepare(`SELECT i.price, i.qty, i.gst_rate, c.slug FROM order_items i JOIN products p ON p.id = i.product_id
    JOIN categories c ON c.id = p.category_id WHERE i.order_id = ?`).all(order.id);
  let gross = 0;
  let commission = 0;
  let taxable = 0;
  for (const it of items) {
    const amount = it.price * it.qty;
    gross += amount;
    commission += pctOf(amount, market.commissionPct(seller.lane, it.slug));
    taxable += Math.round((amount * 100) / (100 + it.gst_rate));
  }
  const fees = M.fulfilmentFee[seller.fulfilment] || 0;
  const gstOnFees = pctOf(commission + fees, M.gstOnFeesPct);
  // TCS applies to sellers registered for GST; sellers with only an enrolment ID are not.
  const tcs = seller.gstin ? pctOf(taxable, M.tcsPct) : 0;
  const tds = pctOf(gross, M.tdsPct);
  return { gross, commission, fees, gstOnFees, tcs, tds, net: gross - commission - fees - gstOnFees - tcs - tds };
}

const releaseAt = (o) => o.delivered_at + config.returnWindowDays * DAY;

/** Delivered seller orders whose return window has closed and that have not been paid yet. */
function eligible(d, now, sellerId) {
  return d.prepare(`SELECT o.* FROM orders o JOIN sellers s ON s.id = o.seller_id
    WHERE s.lane != 'direct' AND o.status = 'delivered' AND o.payout_id IS NULL AND o.delivered_at <= ? ${sellerId ? 'AND o.seller_id = ?' : ''}
    ORDER BY o.delivered_at`).all(now - config.returnWindowDays * DAY, ...(sellerId ? [sellerId] : []));
}

/** Money on its way to a seller: delivered orders still inside the return window, and approved claims. */
function upcoming(d, sellerId, now = Date.now()) {
  const seller = d.prepare('SELECT * FROM sellers WHERE id = ?').get(sellerId);
  const orders = d.prepare(`SELECT * FROM orders WHERE seller_id = ? AND payout_id IS NULL AND status IN ('delivered','return_requested')
    ORDER BY delivered_at`).all(sellerId);
  const lines = orders.map((o) => ({ orderId: o.id, orderNo: o.order_no, deliveredAt: o.delivered_at, releaseAt: releaseAt(o),
    ready: o.status === 'delivered' && releaseAt(o) <= now, onHold: o.status === 'return_requested', ...breakdown(d, o, seller) }));
  const claims = d.prepare("SELECT c.id, c.amount, c.reason, o.order_no FROM claims c JOIN orders o ON o.id = c.order_id WHERE c.seller_id = ? AND c.status = 'approved' AND c.payout_id IS NULL")
    .all(sellerId);
  return { lines, claims, net: lines.reduce((s, l) => s + l.net, 0) + claims.reduce((s, c) => s + c.amount, 0) };
}

const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

/** Pays every seller who has settled orders or approved claims. Must run inside db.tx(). Returns the payouts made. */
function run(d, now = Date.now()) {
  const due = eligible(d, now);
  const claims = d.prepare("SELECT * FROM claims WHERE status = 'approved' AND payout_id IS NULL").all();
  const sellerIds = [...new Set([...due.map((o) => o.seller_id), ...claims.map((c) => c.seller_id)])];
  const made = [];
  for (const sellerId of sellerIds) {
    const seller = d.prepare('SELECT * FROM sellers WHERE id = ?').get(sellerId);
    // Payouts to a suspended seller wait until Studio reinstates them.
    if (seller.status !== 'approved') continue;
    const lines = due.filter((o) => o.seller_id === sellerId).map((o) => ({ order: o, ...breakdown(d, o, seller) }));
    const mine = claims.filter((c) => c.seller_id === sellerId);
    const adjustments = sum(mine, 'amount');
    const totals = { gross: sum(lines, 'gross'), commission: sum(lines, 'commission'), fees: sum(lines, 'fees'), gstOnFees: sum(lines, 'gstOnFees'),
      tcs: sum(lines, 'tcs'), tds: sum(lines, 'tds') };
    const net = sum(lines, 'net') + adjustments;
    if (net <= 0) continue;
    const ymd = new Date(now + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, '');
    const no = `PO-${ymd}-${seller.code}-${crypto.randomInt(1000, 10000)}`;
    const utr = config.paymentProvider === 'test' ? `TESTUTR${crypto.randomInt(1e9, 1e10)}` : null;
    const payoutId = Number(d.prepare(`INSERT INTO payouts (payout_no, seller_id, gross, commission, fees, gst_on_fees, tcs, tds, adjustments, net, status, utr, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'paid',?,?)`).run(no, sellerId, totals.gross, totals.commission, totals.fees, totals.gstOnFees, totals.tcs, totals.tds,
      adjustments, net, utr, now).lastInsertRowid);
    const insLine = d.prepare(`INSERT INTO payout_lines (payout_id, order_id, claim_id, gross, commission, fees, gst_on_fees, tcs, tds, adjustment, net)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of lines) {
      insLine.run(payoutId, l.order.id, null, l.gross, l.commission, l.fees, l.gstOnFees, l.tcs, l.tds, 0, l.net);
      d.prepare('UPDATE orders SET payout_id = ? WHERE id = ?').run(payoutId, l.order.id);
    }
    for (const c of mine) {
      insLine.run(payoutId, c.order_id, c.id, 0, 0, 0, 0, 0, 0, c.amount, c.amount);
      d.prepare('UPDATE claims SET payout_id = ?, updated_at = ? WHERE id = ?').run(payoutId, now, c.id);
    }
    const contact = seller.email || (seller.user_id ? (d.prepare('SELECT email FROM users WHERE id = ?').get(seller.user_id) || {}).email : null);
    notify.send(d, { userId: seller.user_id, channel: 'email', recipient: contact,
      body: `${config.storeName} Seller Hub: payout ${no} of ₹${(net / 100).toLocaleString('en-IN')} sent to your bank account ending ${seller.bank_last4}.` });
    made.push({ id: payoutId, payoutNo: no, sellerId, net, orders: lines.length, claims: mine.length });
  }
  return made;
}

/**
 * Daily money check (blueprint stage 10, reconcile): what buyers paid, cash collected on delivery, refunds,
 * seller payouts, and what Bazaario earned and must deposit as TCS and TDS.
 */
function reconciliation(d, now = Date.now(), days = 14) {
  const dayOf = (ts) => new Date(ts + 330 * 60000).toISOString().slice(0, 10);
  const since = now - days * DAY;
  const rows = new Map();
  const row = (k) => {
    if (!rows.has(k)) rows.set(k, { day: k, online: 0, cod: 0, refunds: 0, payouts: 0, earned: 0, tcs: 0, tds: 0 });
    return rows.get(k);
  };
  for (const o of d.prepare("SELECT created_at, total, wallet_used FROM orders WHERE created_at >= ? AND payment_method IN ('card','upi','emi')").all(since)) {
    row(dayOf(o.created_at)).online += o.total - o.wallet_used;
  }
  for (const o of d.prepare("SELECT delivered_at, total, wallet_used FROM orders WHERE delivered_at >= ? AND payment_method = 'cod'").all(since)) {
    row(dayOf(o.delivered_at)).cod += o.total - o.wallet_used;
  }
  for (const o of d.prepare("SELECT updated_at, total, wallet_used FROM orders WHERE updated_at >= ? AND payment_status = 'refunded'").all(since)) {
    row(dayOf(o.updated_at)).refunds += o.total - o.wallet_used;
  }
  for (const p of d.prepare('SELECT * FROM payouts WHERE created_at >= ?').all(since)) {
    const r = row(dayOf(p.created_at));
    r.payouts += p.net;
    r.earned += p.commission + p.fees;
    r.tcs += p.tcs;
    r.tds += p.tds;
  }
  return [...rows.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

module.exports = { breakdown, eligible, upcoming, run, reconciliation, releaseAt };
