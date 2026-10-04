'use strict';
const crypto = require('node:crypto');
const config = require('./config');

/**
 * Reseller program (blueprint stages 3, 10 and 12, from Meesho).
 * A reseller shares a product on WhatsApp with their own margin added to Bazaario's price. A buyer who opens the
 * share pays that price; the seller still gets their own price, and the reseller is paid the margin once the
 * return window closes. Cancelled and returned orders earn nothing.
 */
const R = config.reseller;

const newCode = (prefix, bytes = 4) => `${prefix}${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`;

/** A share that can still be used: active, and its reseller is active. */
function shareById(d, id) {
  if (!id) return null;
  return d.prepare(`SELECT sh.*, r.display_name AS reseller_name, r.status AS reseller_status, r.code AS reseller_code
    FROM reseller_shares sh JOIN resellers r ON r.id = sh.reseller_id WHERE sh.id = ? AND sh.active = 1 AND r.status = 'active'`).get(id) || null;
}

function shareByCode(d, code) {
  if (typeof code !== 'string' || !/^SH[0-9A-F]{8}$/.test(code)) return null;
  const row = d.prepare('SELECT id FROM reseller_shares WHERE code = ?').get(code);
  return row ? shareById(d, row.id) : null;
}

/** The margin that still fits: at most maxMarginPct of the price, and the buyer never pays more than MRP. */
function fitMargin(margin, price, mrp) {
  return Math.max(0, Math.min(margin, Math.floor((price * R.maxMarginPct) / 100), mrp - price));
}

/** Financial year (April to March, IST) that a time falls in, as its start time. */
function fyStart(ts) {
  const t = new Date(ts + 330 * 60000);
  const y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
  return Date.UTC(y, 3, 1) - 330 * 60000;
}

const DAY = 86400_000;
const releaseAt = (deliveredAt) => deliveredAt + config.returnWindowDays * DAY;

/** Every sale through a reseller's shares, with what it earns and where it is. */
function sales(d, resellerId) {
  return d.prepare(`SELECT i.id AS item_id, i.order_id, i.title, i.qty, i.price, i.reseller_margin, i.reseller_payout_id, o.order_no, o.status,
      o.created_at, o.delivered_at, o.address, o.user_id, sh.code AS share_code
      FROM order_items i JOIN orders o ON o.id = i.order_id JOIN reseller_shares sh ON sh.id = i.share_id
     WHERE sh.reseller_id = ? ORDER BY o.created_at DESC LIMIT 500`).all(resellerId).map((r) => {
    const a = JSON.parse(r.address);
    const earn = r.reseller_margin * r.qty;
    let stage = 'pending';
    if (['cancelled', 'returned', 'rto'].includes(r.status)) stage = 'lost';
    else if (r.reseller_payout_id) stage = 'paid';
    else if (r.status === 'delivered' && releaseAt(r.delivered_at) <= Date.now()) stage = 'ready';
    else if (r.status === 'delivered' || r.status === 'return_requested') stage = 'window';
    return { itemId: r.item_id, orderId: r.order_id, orderNo: r.order_no, title: r.title, qty: r.qty, price: r.price, margin: r.reseller_margin,
      earn, status: r.status, stage, createdAt: r.created_at, deliveredAt: r.delivered_at, releaseAt: r.delivered_at ? releaseAt(r.delivered_at) : null,
      customer: { name: a.fullName.split(' ')[0], city: a.city, key: r.user_id }, shareCode: r.share_code };
  });
}

/** Pays every reseller whose sales are past the return window. Must run inside db.tx(). */
function run(d, now = Date.now()) {
  const due = d.prepare(`SELECT i.id, i.reseller_margin * i.qty AS earn, sh.reseller_id FROM order_items i
      JOIN orders o ON o.id = i.order_id JOIN reseller_shares sh ON sh.id = i.share_id JOIN resellers r ON r.id = sh.reseller_id
     WHERE i.reseller_margin > 0 AND i.reseller_payout_id IS NULL AND o.status = 'delivered' AND o.delivered_at <= ? AND r.status = 'active'`)
    .all(now - config.returnWindowDays * DAY);
  const made = [];
  for (const resellerId of [...new Set(due.map((x) => x.reseller_id))]) {
    const mine = due.filter((x) => x.reseller_id === resellerId);
    const gross = mine.reduce((s, x) => s + x.earn, 0);
    const earlier = d.prepare('SELECT COALESCE(SUM(gross), 0) AS n FROM reseller_payouts WHERE reseller_id = ? AND created_at >= ?').get(resellerId, fyStart(now)).n;
    // TDS applies once the year's earnings cross the threshold.
    const tds = earlier + gross > R.tdsThreshold ? Math.round((gross * R.tdsPct) / 100) : 0;
    const ymd = new Date(now + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, '');
    const no = `RP-${ymd}-${crypto.randomInt(100000, 1000000)}`;
    const utr = config.paymentProvider === 'test' ? `TESTUTR${crypto.randomInt(1e9, 1e10)}` : null;
    const id = Number(d.prepare('INSERT INTO reseller_payouts (payout_no, reseller_id, gross, tds, net, utr, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(no, resellerId, gross, tds, gross - tds, utr, now).lastInsertRowid);
    const mark = d.prepare('UPDATE order_items SET reseller_payout_id = ? WHERE id = ?');
    for (const x of mine) mark.run(id, x.id);
    made.push({ id, payoutNo: no, resellerId, gross, tds, net: gross - tds, items: mine.length });
  }
  return made;
}

module.exports = { newCode, shareById, shareByCode, fitMargin, sales, run, fyStart, releaseAt };
