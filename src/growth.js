'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const wallet = require('./wallet');
const notify = require('./notify');

/**
 * Growth and loyalty (blueprint stage 12): Bazaario Plus, sale events, referrals and sponsored listings.
 * Sale discounts and Plus delivery savings are funded by Bazaario, so sellers are always paid their own price.
 */
const DAY = 86400_000;
const P = config.plus;

// ---------------- Bazaario Plus ----------------
/** The membership that covers `now`, or null. */
function membership(d, userId, now = Date.now()) {
  if (!userId) return null;
  return d.prepare('SELECT * FROM memberships WHERE user_id = ? AND starts_at <= ? AND ends_at > ? ORDER BY ends_at DESC LIMIT 1').get(userId, now, now) || null;
}

/** Adds calendar months in India time, keeping the day of the month where it exists. */
function addMonths(ts, months) {
  const t = new Date(ts);
  const out = new Date(t);
  out.setUTCMonth(t.getUTCMonth() + months);
  if (out.getUTCDate() !== t.getUTCDate()) out.setUTCDate(0);
  return out.getTime();
}

/** Starts a membership, or extends the current one from its end date. Must run inside db.tx(). */
function startPlus(d, userId, plan, { method, ref }, now = Date.now()) {
  const p = P.plans[plan];
  const cur = membership(d, userId, now);
  const from = cur ? cur.ends_at : now;
  const ends = addMonths(from, p.months);
  const id = Number(d.prepare(`INSERT INTO memberships (user_id, plan, amount, starts_at, ends_at, auto_renew, payment_method, payment_ref, created_at)
    VALUES (?,?,?,?,?,1,?,?,?)`).run(userId, plan, p.price, from, ends, method, ref, now).lastInsertRowid);
  return d.prepare('SELECT * FROM memberships WHERE id = ?').get(id);
}

// ---------------- Sale events ----------------
const SALE_SQL = `SELECT s.*, i.product_id, i.pct FROM sales s JOIN sale_items i ON i.sale_id = s.id
  WHERE s.active = 1 AND s.ends_at > ? AND (s.starts_at <= ? OR (? AND s.starts_at - s.early_hours * 3600000 <= ?))`;

/**
 * Sale prices that apply now, by product id: the deepest live discount. Plus members get in early_hours before
 * everyone else. Returns Map(productId -> { saleId, slug, name, pct, endsAt, early }).
 */
function liveSales(d, { plus = false, now = Date.now(), productIds = null } = {}) {
  const rows = d.prepare(SALE_SQL).all(now, now, plus ? 1 : 0, now);
  const map = new Map();
  for (const r of rows) {
    if (productIds && !productIds.has(r.product_id)) continue;
    const had = map.get(r.product_id);
    if (!had || r.pct > had.pct) {
      map.set(r.product_id, { saleId: r.id, slug: r.slug, name: r.name, pct: r.pct, endsAt: r.ends_at, early: r.starts_at > now });
    }
  }
  return map;
}

/** Paise off one unit at `price` in a sale of `pct` percent. The sale price is rounded down to whole rupees. */
const saleOff = (price, pct) => price - Math.floor((price * (100 - pct)) / 10000) * 100;

/** Shows sale prices on product rows from the catalogue (price becomes the sale price, the old price is kept). */
function applySales(d, rows, opts = {}) {
  if (!rows.length) return rows;
  const live = liveSales(d, { ...opts, productIds: new Set(rows.map((r) => r.id)) });
  for (const r of rows) {
    const s = live.get(r.id);
    if (!s) continue;
    r.sale = { name: s.name, slug: s.slug, pct: s.pct, endsAt: s.endsAt, early: s.early, was: r.price };
    r.price -= saleOff(r.price, s.pct);
  }
  return rows;
}

/** Sales for the store front: live now (or early for Plus) and coming soon. */
function saleList(d, { plus = false, now = Date.now() } = {}) {
  return d.prepare(`SELECT s.*, (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS items, (SELECT MAX(pct) FROM sale_items i WHERE i.sale_id = s.id) AS top_pct
    FROM sales s WHERE s.active = 1 AND s.ends_at > ? ORDER BY s.starts_at`).all(now).map((s) => ({
    id: s.id, slug: s.slug, name: s.name, tagline: s.tagline, startsAt: s.starts_at, endsAt: s.ends_at, earlyHours: s.early_hours,
    items: s.items, topPct: s.top_pct,
    live: s.starts_at <= now, earlyNow: plus && s.starts_at > now && s.starts_at - s.early_hours * 3600_000 <= now,
  }));
}

// ---------------- Referrals ----------------
/** A user's own referral code, created the first time it is asked for. */
function referralCode(d, userId) {
  const u = d.prepare('SELECT referral_code, name FROM users WHERE id = ?').get(userId);
  if (u.referral_code) return u.referral_code;
  const stem = (u.name.replace(/[^A-Za-z]/g, '').toUpperCase() + 'BAZ').slice(0, 4);
  let code;
  do code = `${stem}${crypto.randomInt(1000, 10000)}`; while (d.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code));
  d.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, userId);
  return code;
}

/** Links a new account to the friend who invited it. Unknown codes and self-referrals are ignored. */
function linkReferral(d, refereeId, code, now = Date.now()) {
  if (typeof code !== 'string' || !/^[A-Z]{4}\d{4}$/.test(code.trim().toUpperCase())) return false;
  const r = d.prepare('SELECT id FROM users WHERE referral_code = ?').get(code.trim().toUpperCase());
  if (!r || r.id === refereeId) return false;
  // A cap per month keeps one person from farming rewards with made-up accounts.
  const month = d.prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ? AND created_at > ?').get(r.id, now - 30 * DAY).n;
  if (month >= config.referral.maxPerMonth) return false;
  d.prepare("INSERT OR IGNORE INTO referrals (referrer_id, referee_id, status, created_at) VALUES (?,?,'pending',?)").run(r.id, refereeId, now);
  return true;
}

/** Called when an order is delivered: the friend's first delivered order rewards both people. */
function rewardReferral(d, order, now = Date.now()) {
  const ref = d.prepare("SELECT * FROM referrals WHERE referee_id = ? AND status = 'pending'").get(order.user_id);
  if (!ref) return;
  const R = config.referral;
  d.prepare("UPDATE referrals SET status = 'rewarded', order_id = ?, rewarded_at = ? WHERE id = ?").run(order.id, now, ref.id);
  const friend = d.prepare('SELECT name, email FROM users WHERE id = ?').get(order.user_id);
  const referrer = d.prepare('SELECT name, email FROM users WHERE id = ?').get(ref.referrer_id);
  wallet.post(d, ref.referrer_id, R.referrerReward, `Referral reward: ${friend.name.split(' ')[0]} placed their first order`);
  wallet.post(d, order.user_id, R.friendReward, `Welcome reward: you joined with ${referrer.name.split(' ')[0]}'s invite`, order.id);
  const rs = (n) => `₹${(n / 100).toLocaleString('en-IN')}`;
  notify.send(d, { userId: ref.referrer_id, channel: 'email', recipient: referrer.email,
    body: `${config.storeName}: ${friend.name.split(' ')[0]} received their first order. ${rs(R.referrerReward)} has been added to your wallet.` });
  notify.send(d, { userId: order.user_id, channel: 'email', recipient: friend.email,
    body: `${config.storeName}: thanks for joining with ${referrer.name.split(' ')[0]}'s invite. ${rs(R.friendReward)} has been added to your wallet.` });
}

// ---------------- Sponsored listings ----------------
const IST = 330 * 60000;
const dayStart = (ts) => { const t = new Date(ts + IST); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST; };

function spentToday(d, campaignId, now = Date.now()) {
  return d.prepare('SELECT COALESCE(SUM(cost), 0) AS n FROM ad_clicks WHERE campaign_id = ? AND created_at >= ?').get(campaignId, dayStart(now)).n;
}

/**
 * Up to `slots` sponsored products for a search: active campaigns on products that match, whose seller has the
 * item in stock and budget left today. Highest bid first.
 */
function sponsored(d, productIds, now = Date.now()) {
  if (!productIds.length) return [];
  const rows = d.prepare(`SELECT a.*, o.price AS offer_price, o.id AS offer_id FROM ad_campaigns a
      JOIN sellers s ON s.id = a.seller_id AND s.status = 'approved' AND s.lane != 'shop'
      JOIN offers o ON o.product_id = a.product_id AND o.seller_id = a.seller_id AND o.active = 1 AND o.stock > 0
      JOIN products p ON p.id = a.product_id AND p.active = 1
     WHERE a.status = 'active' AND a.product_id IN (${productIds.map(() => '?').join(',')}) ORDER BY a.bid DESC, a.id`).all(...productIds);
  const out = [];
  for (const r of rows) {
    if (out.some((x) => x.product_id === r.product_id)) continue;
    if (spentToday(d, r.id, now) + r.bid > r.daily_budget) continue;
    out.push(r);
    if (out.length >= config.ads.slots) break;
  }
  return out;
}

/** Charges a click: once per viewer per campaign per day, within the budget, never for the seller's own clicks. */
function click(d, campaignId, viewer, { userId = null, now = Date.now() } = {}) {
  const a = d.prepare("SELECT a.*, s.user_id AS seller_user FROM ad_campaigns a JOIN sellers s ON s.id = a.seller_id WHERE a.id = ? AND a.status = 'active'").get(campaignId);
  if (!a) return { charged: false, productId: null };
  if (userId && a.seller_user === userId) return { charged: false, productId: a.product_id };
  if (d.prepare('SELECT 1 FROM ad_clicks WHERE campaign_id = ? AND viewer = ? AND created_at >= ?').get(campaignId, viewer, dayStart(now))) {
    return { charged: false, productId: a.product_id };
  }
  if (spentToday(d, campaignId, now) + a.bid > a.daily_budget) return { charged: false, productId: a.product_id };
  d.prepare('INSERT INTO ad_clicks (campaign_id, viewer, cost, created_at) VALUES (?,?,?,?)').run(campaignId, viewer, a.bid, now);
  return { charged: true, productId: a.product_id };
}

/** Ad clicks not yet billed to a seller: they are taken from the next payout. */
function unbilledAdSpend(d, sellerId) {
  return d.prepare(`SELECT COALESCE(SUM(c.cost), 0) AS n FROM ad_clicks c JOIN ad_campaigns a ON a.id = c.campaign_id
    WHERE a.seller_id = ? AND c.payout_id IS NULL`).get(sellerId).n;
}

module.exports = {
  membership, startPlus, addMonths, liveSales, saleOff, applySales, saleList, referralCode, linkReferral, rewardReferral,
  sponsored, click, spentToday, unbilledAdSpend, dayStart,
};
