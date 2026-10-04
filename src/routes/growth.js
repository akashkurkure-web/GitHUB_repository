'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const growth = require('../growth');
const payments = require('../payments');
const winback = require('../winback');
const { HttpError, requireAuth, requireAdmin, audit, v } = require('../security');

/**
 * Growth and loyalty (blueprint stage 12): Bazaario Plus, sale events, referrals, sponsored-listing clicks,
 * win-back messages and the Studio reports.
 */
const P = config.plus;
const DAY = 86400_000;

// ---------------- Open to everyone (mounted before the routers that require sign-in) ----------------
const open = express.Router();

open.get('/plus/plans', (req, res) => {
  const m = req.user ? growth.membership(db.get(), req.user.id) : null;
  res.json({ plans: P.plans, expressFee: P.expressFee, normalExpressFee: config.expressFee, shippingFee: config.shippingFee,
    freeShippingThreshold: config.freeShippingThreshold, earlyHours: P.earlyHours, member: m ? { plan: m.plan, endsAt: m.ends_at } : null });
});

open.get('/sales', (req, res) => {
  const plus = !!(req.user && growth.membership(db.get(), req.user.id));
  res.json({ sales: growth.saleList(db.get(), { plus }), plus });
});

const COLS = `p.id, p.title, p.brand, p.price, p.mrp, p.stock, p.rating_avg, p.rating_count, p.sold_count, p.emoji, p.color, p.image, p.assured,
  (p.express AND p.seller_id = (SELECT id FROM sellers WHERE code = 'direct')) AS express, p.is_deal, c.slug AS category, c.name AS category_name`;

open.get('/sales/:slug', (req, res) => {
  const d = db.get();
  const s = d.prepare('SELECT * FROM sales WHERE slug = ? AND active = 1').get(String(req.params.slug).slice(0, 60));
  if (!s) throw new HttpError(404, 'This sale is not on.');
  const now = Date.now();
  const plus = !!(req.user && growth.membership(d, req.user.id, now));
  const live = s.starts_at <= now && s.ends_at > now;
  const early = plus && !live && s.starts_at - s.early_hours * 3600_000 <= now && s.ends_at > now;
  const rows = d.prepare(`SELECT ${COLS}, i.pct FROM sale_items i JOIN products p ON p.id = i.product_id JOIN categories c ON c.id = p.category_id
    WHERE i.sale_id = ? AND p.active = 1 ORDER BY i.pct DESC, p.sold_count DESC`).all(s.id);
  // Before the sale opens (for this buyer) the items show the discount to come, at today's price.
  const items = rows.map(({ pct, ...p }) => (live || early
    ? { ...p, sale: { name: s.name, slug: s.slug, pct, endsAt: s.ends_at, early, was: p.price }, price: p.price - growth.saleOff(p.price, pct) }
    : { ...p, upcoming: { pct } }));
  res.json({ sale: { slug: s.slug, name: s.name, tagline: s.tagline, startsAt: s.starts_at, endsAt: s.ends_at, earlyHours: s.early_hours,
    live, early, ended: s.ends_at <= now }, items, plus });
});

/** A sponsored product was clicked. Charged to the seller once per viewer per day. */
open.post('/ads/click', (req, res) => {
  const id = v.int(req.body.campaignId, 'Campaign', { min: 1 });
  // Viewers are told apart by account, or by a hash of the network address and browser when signed out.
  const viewer = req.user ? `u${req.user.id}` : `a${crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}`).digest('hex').slice(0, 24)}`;
  const r = db.tx((d) => growth.click(d, id, viewer, { userId: req.user ? req.user.id : null }));
  res.json({ ok: true, productId: r.productId });
});

// ---------------- Signed in ----------------
const mine = express.Router();


mine.get('/plus', requireAuth, (req, res) => {
  const d = db.get();
  const m = growth.membership(d, req.user.id);
  const history = d.prepare('SELECT plan, amount, starts_at, ends_at, payment_method, payment_ref, created_at FROM memberships WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(req.user.id);
  const saved = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(plus_saved), 0) AS amount FROM orders WHERE user_id = ? AND plus = 1 AND status != 'cancelled'").get(req.user.id);
  res.json({ member: m ? { plan: m.plan, startsAt: m.starts_at, endsAt: m.ends_at, autoRenew: !!m.auto_renew } : null, history,
    saved: { orders: saved.n, amount: saved.amount } });
});

mine.post('/plus/join', requireAuth, (req, res) => {
  const plan = String(req.body.plan || '');
  if (!P.plans[plan]) throw new HttpError(400, 'Please choose a plan.');
  const method = String(req.body.paymentMethod || '');
  if (!['upi', 'card'].includes(method)) throw new HttpError(400, 'Please pay for Plus by UPI or card.');
  const pay = payments.charge(method, req.body.payment, P.plans[plan].price);
  const m = db.tx((d) => {
    const row = growth.startPlus(d, req.user.id, plan, { method, ref: pay.ref });
    const u = d.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    require('../notify').send(d, { userId: req.user.id, channel: 'email', recipient: u.email,
      body: `${config.storeName}: welcome to Bazaario Plus. Free delivery on every order and early sale access until ${new Date(row.ends_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}.` });
    return row;
  });
  audit(req, 'plus.join', { plan, ref: pay.ref });
  res.status(201).json({ member: { plan: m.plan, startsAt: m.starts_at, endsAt: m.ends_at, autoRenew: true } });
});

/** Turns renewal off or on. The membership runs to its end date either way. */
mine.post('/plus/renewal', requireAuth, (req, res) => {
  const d = db.get();
  const m = growth.membership(d, req.user.id);
  if (!m) throw new HttpError(400, 'You are not a Plus member.');
  d.prepare('UPDATE memberships SET auto_renew = ? WHERE id = ?').run(req.body.autoRenew ? 1 : 0, m.id);
  audit(req, 'plus.renewal', { autoRenew: !!req.body.autoRenew });
  res.json({ autoRenew: !!req.body.autoRenew });
});

mine.get('/referrals', requireAuth, (req, res) => {
  const d = db.get();
  const code = growth.referralCode(d, req.user.id);
  const friends = d.prepare(`SELECT r.status, r.created_at, r.rewarded_at, u.name FROM referrals r JOIN users u ON u.id = r.referee_id
    WHERE r.referrer_id = ? ORDER BY r.created_at DESC LIMIT 100`).all(req.user.id).map((f) => ({ ...f, name: f.name.split(' ')[0] }));
  const R = config.referral;
  res.json({ code, friends, rewards: { referrer: R.referrerReward, friend: R.friendReward },
    earned: friends.filter((f) => f.status === 'rewarded').length * R.referrerReward });
});

mine.get('/account/preferences', requireAuth, (req, res) => {
  res.json({ marketing: !!db.get().prepare('SELECT marketing_opt_in FROM users WHERE id = ?').get(req.user.id).marketing_opt_in });
});

mine.patch('/account/preferences', requireAuth, (req, res) => {
  db.get().prepare('UPDATE users SET marketing_opt_in = ? WHERE id = ?').run(req.body.marketing ? 1 : 0, req.user.id);
  audit(req, 'user.marketing', { optIn: !!req.body.marketing });
  res.json({ marketing: !!req.body.marketing });
});

// ---------------- Studio ----------------
const admin = express.Router();
admin.use(requireAdmin);

const readSale = (b) => {
  const name = v.str(b.name, 'Sale name', { min: 3, max: 60 });
  const slug = v.str(b.slug, 'Web address', { min: 3, max: 40, pattern: /^[a-z0-9-]+$/ });
  const tagline = v.str(b.tagline, 'Tagline', { max: 120, optional: true }) || '';
  const startsAt = Number(b.startsAt);
  const endsAt = Number(b.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) throw new HttpError(400, 'The sale must end after it starts.');
  if (endsAt - startsAt > 31 * DAY) throw new HttpError(400, 'A sale can run for up to 31 days.');
  const earlyHours = v.int(b.earlyHours, 'Plus early access (hours)', { min: 0, max: 72, optional: true, def: P.earlyHours });
  const items = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  if (!items.length) throw new HttpError(400, 'Add at least one product to the sale.');
  const clean = items.map((it) => ({ productId: v.int(it.productId, 'Product', { min: 1 }), pct: v.int(it.pct, 'Discount (%)', { min: 1, max: 90 }) }));
  return { name, slug, tagline, startsAt, endsAt, earlyHours, items: clean };
};

admin.get('/sales', (_req, res) => {
  const d = db.get();
  const sales = d.prepare('SELECT * FROM sales ORDER BY starts_at DESC LIMIT 50').all();
  const items = d.prepare('SELECT i.product_id, i.pct, p.title, p.price FROM sale_items i JOIN products p ON p.id = i.product_id WHERE i.sale_id = ? ORDER BY i.pct DESC');
  // Sale revenue: what buyers paid for sale orders, and what the discount cost Bazaario.
  const perf = d.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(sale_discount), 0) AS cost FROM orders
    WHERE sale_discount > 0 AND created_at BETWEEN ? AND ? AND status != 'cancelled'`);
  res.json({ sales: sales.map((s) => ({ ...s, items: items.all(s.id), performance: perf.get(s.starts_at - s.early_hours * 3600_000, s.ends_at) })) });
});

admin.post('/sales', (req, res) => {
  const s = readSale(req.body);
  const id = db.tx((d) => {
    if (d.prepare('SELECT 1 FROM sales WHERE slug = ?').get(s.slug)) throw new HttpError(409, 'Another sale already uses this web address.');
    const sid = Number(d.prepare('INSERT INTO sales (slug, name, tagline, starts_at, ends_at, early_hours, active, created_at) VALUES (?,?,?,?,?,?,1,?)')
      .run(s.slug, s.name, s.tagline, s.startsAt, s.endsAt, s.earlyHours, Date.now()).lastInsertRowid);
    const ins = d.prepare('INSERT OR REPLACE INTO sale_items (sale_id, product_id, pct) VALUES (?,?,?)');
    for (const it of s.items) ins.run(sid, it.productId, it.pct);
    return sid;
  });
  audit(req, 'admin.sale_create', { saleId: id });
  res.status(201).json({ id });
});

admin.patch('/sales/:id', (req, res) => {
  const id = v.int(req.params.id, 'Sale', { min: 1 });
  const r = db.get().prepare('UPDATE sales SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
  if (!r.changes) throw new HttpError(404, 'Sale not found.');
  audit(req, 'admin.sale', { saleId: id, active: !!req.body.active });
  res.json({ ok: true });
});

admin.post('/winback/run', (req, res) => {
  const out = db.tx((d) => winback.run(d));
  audit(req, 'admin.winback', out);
  res.json(out);
});

admin.get('/plus', (_req, res) => {
  const d = db.get();
  const now = Date.now();
  res.json({
    members: d.prepare(`SELECT u.name, u.email, m.plan, m.starts_at, m.ends_at, m.auto_renew FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.ends_at > ? AND m.starts_at <= ? ORDER BY m.ends_at DESC LIMIT 200`).all(now, now),
    revenue: d.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM memberships').get().n,
  });
});

admin.get('/ads', (_req, res) => {
  const d = db.get();
  res.json({ campaigns: d.prepare(`SELECT a.*, s.display_name AS seller, p.title,
      (SELECT COUNT(*) FROM ad_clicks c WHERE c.campaign_id = a.id) AS clicks, (SELECT COALESCE(SUM(cost), 0) FROM ad_clicks c WHERE c.campaign_id = a.id) AS spend
      FROM ad_campaigns a JOIN sellers s ON s.id = a.seller_id JOIN products p ON p.id = a.product_id ORDER BY a.updated_at DESC LIMIT 200`).all() });
});

/**
 * Reports for the last N days (blueprint stage 12, "measure"): repeat buyers, customer value, how each delivery
 * speed and seller type contributes, Plus members against everyone else, and what growth tools brought in.
 */
admin.get('/reports', (req, res) => {
  const days = [30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 90;
  const d = db.get();
  const from = Date.now() - days * DAY;
  const KEPT = "o.status NOT IN ('cancelled','returned','rto')";
  const one = (sql, ...p) => d.prepare(sql).get(...p);
  const buyers = one(`SELECT COUNT(*) AS buyers, COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeaters, COALESCE(SUM(spent), 0) AS spent, COALESCE(SUM(n), 0) AS orders
    FROM (SELECT o.user_id, COUNT(DISTINCT COALESCE(o.checkout_ref, o.order_no)) AS n, SUM(o.total) AS spent FROM orders o WHERE ${KEPT} AND o.created_at >= ? GROUP BY o.user_id)`, from);
  const life = one(`SELECT COUNT(*) AS n, COALESCE(AVG(spent), 0) AS ltv FROM (SELECT SUM(o.total) AS spent FROM orders o WHERE ${KEPT} GROUP BY o.user_id)`);
  const bySpeed = d.prepare(`SELECT o.delivery_speed AS speed, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(AVG(o.total), 0) AS aov,
      COALESCE(AVG(CASE WHEN o.delivered_at IS NOT NULL AND o.promised_at IS NOT NULL THEN (o.delivered_at <= o.promised_at) END), 0) AS on_time
      FROM orders o WHERE ${KEPT} AND o.created_at >= ? GROUP BY o.delivery_speed`).all(from);
  const byLane = d.prepare(`SELECT COALESCE(s.lane, 'direct') AS lane, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue FROM orders o
      LEFT JOIN sellers s ON s.id = o.seller_id WHERE ${KEPT} AND o.created_at >= ? GROUP BY COALESCE(s.lane, 'direct') ORDER BY revenue DESC`).all(from);
  const plus = d.prepare(`SELECT o.plus, COUNT(*) AS orders, COALESCE(AVG(o.total), 0) AS aov, COUNT(DISTINCT o.user_id) AS buyers FROM orders o
      WHERE ${KEPT} AND o.created_at >= ? GROUP BY o.plus`).all(from);
  const memberships = one('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS revenue FROM memberships WHERE created_at >= ?', from);
  const tools = {
    sale: one(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(o.sale_discount), 0) AS cost FROM orders o WHERE ${KEPT} AND o.sale_discount > 0 AND o.created_at >= ?`, from),
    coupons: one(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.discount - o.sale_discount), 0) AS cost FROM orders o WHERE ${KEPT} AND o.coupon_code IS NOT NULL AND o.created_at >= ?`, from),
    referrals: one("SELECT COUNT(*) AS joined, COALESCE(SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END), 0) AS rewarded FROM referrals WHERE created_at >= ?", from),
    resellers: one(`SELECT COUNT(DISTINCT i.order_id) AS orders, COALESCE(SUM(i.reseller_margin * i.qty), 0) AS margin FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.share_id IS NOT NULL AND ${KEPT} AND o.created_at >= ?`, from),
    ads: one('SELECT COUNT(*) AS clicks, COALESCE(SUM(cost), 0) AS revenue FROM ad_clicks WHERE created_at >= ?', from),
    winback: d.prepare('SELECT kind, COUNT(*) AS sent FROM winback_log WHERE created_at >= ? GROUP BY kind').all(from),
  };
  const top = d.prepare(`SELECT c.name, COALESCE(SUM(i.price * i.qty), 0) AS revenue, COALESCE(SUM(i.qty), 0) AS units FROM order_items i
      JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id JOIN categories c ON c.id = p.category_id
     WHERE ${KEPT} AND o.created_at >= ? GROUP BY c.id ORDER BY revenue DESC LIMIT 10`).all(from);
  res.json({
    days,
    customers: { buyers: buyers.buyers, repeaters: buyers.repeaters, repeatRate: buyers.buyers ? buyers.repeaters / buyers.buyers : 0,
      orders: buyers.orders, aov: buyers.orders ? Math.round(buyers.spent / buyers.orders) : 0, ltv: Math.round(life.ltv), lifetimeBuyers: life.n },
    bySpeed, byLane, plus, memberships, tools, categories: top,
  });
});

module.exports = { open, mine, admin };
