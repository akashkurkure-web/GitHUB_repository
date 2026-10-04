'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const kyc = require('../kyc');
const resell = require('../resell');
const { HttpError, requireAuth, audit, v } = require('../security');

/**
 * Reseller app (blueprint stages 3, 10 and 12, from Meesho).
 * Anyone with an account can join, pick products, add their own margin and share a link on WhatsApp.
 * Buyers who open the link see the price with the margin; the reseller sees their customers, orders and earnings.
 */
const router = express.Router();
router.use(requireAuth);
const R = config.reseller;

const mine = (userId) => db.get().prepare('SELECT * FROM resellers WHERE user_id = ?').get(userId);

function requireReseller(req, _res, next) {
  const r = mine(req.user.id);
  if (!r) return next(new HttpError(403, 'Please join the reseller program first.'));
  if (r.status !== 'active') return next(new HttpError(403, `Your reseller account is paused${r.status_note ? `: ${r.status_note}` : ''}. Please contact support.`));
  req.reseller = r;
  next();
}

const view = (r) => ({ id: r.id, code: r.code, displayName: r.display_name, phone: r.phone, upiId: r.upi_id,
  pan: r.pan ? `${r.pan.slice(0, 2)}XXXXX${r.pan.slice(7)}` : null, status: r.status, statusNote: r.status_note, createdAt: r.created_at });
const rules = () => ({ maxMarginPct: R.maxMarginPct, tdsPct: R.tdsPct, tdsThreshold: R.tdsThreshold, returnWindowDays: config.returnWindowDays });

/** Totals by stage: pending (not delivered yet), window (inside the return window), ready, paid and lost. */
function totals(rows) {
  const t = { pending: 0, window: 0, ready: 0, paid: 0, lost: 0, orders: new Set(rows.map((r) => r.orderId)).size };
  for (const r of rows) t[r.stage] += r.earn;
  return t;
}

router.get('/me', (req, res) => {
  const r = mine(req.user.id);
  if (!r) return res.json({ reseller: null, rules: rules() });
  const d = db.get();
  const s = d.prepare('SELECT COUNT(*) AS shares, COALESCE(SUM(views), 0) AS views FROM reseller_shares WHERE reseller_id = ? AND active = 1').get(r.id);
  res.json({ reseller: view(r), rules: rules(), shares: s.shares, views: s.views, earnings: totals(resell.sales(d, r.id)) });
});

const UPI = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/;

router.post('/join', (req, res) => {
  if (mine(req.user.id)) throw new HttpError(409, 'You have already joined the reseller program.');
  if (req.body.agree !== true) throw new HttpError(400, 'Please accept the reseller terms.');
  const name = v.str(req.body.displayName, 'Your name or shop name', { min: 2, max: 40 });
  const phone = v.phone(req.body.phone);
  const upi = v.str(req.body.upiId, 'UPI ID', { min: 5, max: 100 });
  if (!UPI.test(upi)) throw new HttpError(400, 'Please enter a UPI ID like name@okbank.');
  // PAN is optional to start; without it TDS is deducted at the higher rate once earnings cross the yearly limit.
  const pan = req.body.pan ? kyc.pan(req.body.pan) : null;
  const now = Date.now();
  const id = db.tx((d) => {
    let code;
    do code = resell.newCode('RS', 3); while (d.prepare('SELECT 1 FROM resellers WHERE code = ?').get(code));
    return Number(d.prepare("INSERT INTO resellers (code, user_id, display_name, phone, upi_id, pan, status, created_at) VALUES (?,?,?,?,?,?,'active',?)")
      .run(code, req.user.id, name, phone, upi.toLowerCase(), pan, now).lastInsertRowid);
  });
  audit(req, 'reseller.join', { resellerId: id });
  res.status(201).json({ reseller: view(mine(req.user.id)), rules: rules() });
});

router.use(requireReseller);

/** Products to share, with Bazaario's price and the largest margin each one allows. */
router.get('/catalog', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 50) : '';
  const where = ['p.active = 1', 'p.stock > 0'];
  const params = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (category) { where.push('c.slug = ?'); params.push(category); }
  const rows = db.get().prepare(`SELECT p.id, p.title, p.brand, p.price, p.mrp, p.emoji, p.color, p.image, p.rating_avg, p.rating_count, c.name AS category_name,
      sh.id AS share_id, sh.code AS share_code, sh.margin AS share_margin, sh.active AS share_active
      FROM products p JOIN categories c ON c.id = p.category_id
      LEFT JOIN reseller_shares sh ON sh.product_id = p.id AND sh.reseller_id = ?
     WHERE ${where.join(' AND ')} ORDER BY p.sold_count DESC LIMIT 48`).all(req.reseller.id, ...params);
  res.json({ items: rows.map((p) => ({ ...p, maxMargin: resell.fitMargin(Infinity, p.price, p.mrp),
    share: p.share_id && p.share_active ? { id: p.share_id, code: p.share_code, margin: p.share_margin } : null })) });
});

function shareList(d, resellerId) {
  return d.prepare(`SELECT sh.id, sh.code, sh.margin, sh.views, sh.created_at, sh.updated_at, p.id AS product_id, p.title, p.price, p.mrp,
      p.emoji, p.color, p.image, p.active AS product_active, p.stock,
      (SELECT COUNT(DISTINCT i.order_id) FROM order_items i WHERE i.share_id = sh.id) AS orders
      FROM reseller_shares sh JOIN products p ON p.id = sh.product_id WHERE sh.reseller_id = ? AND sh.active = 1 ORDER BY sh.updated_at DESC`)
    .all(resellerId).map((s) => ({ ...s, margin: resell.fitMargin(s.margin, s.price, s.mrp), sharePrice: s.price + resell.fitMargin(s.margin, s.price, s.mrp) }));
}

router.get('/shares', (req, res) => res.json({ shares: shareList(db.get(), req.reseller.id) }));

/** Shares a product, or changes the margin on one already shared. The margin is in rupees. */
router.post('/shares', (req, res) => {
  const productId = v.int(req.body.productId, 'Product', { min: 1 });
  const rupees = v.int(req.body.margin, 'Your margin (₹)', { min: 0, max: 100000 });
  const d = db.get();
  const p = d.prepare('SELECT id, title, price, mrp FROM products WHERE id = ? AND active = 1').get(productId);
  if (!p) throw new HttpError(404, 'Product not found.');
  const max = resell.fitMargin(Infinity, p.price, p.mrp);
  if (rupees * 100 > max) throw new HttpError(400, `Your margin on this item can be up to ₹${Math.floor(max / 100)}, so the price stays within ${R.maxMarginPct}% of ours and below the MRP.`);
  const now = Date.now();
  const share = db.tx((t) => {
    const had = t.prepare('SELECT id, code FROM reseller_shares WHERE reseller_id = ? AND product_id = ?').get(req.reseller.id, productId);
    if (had) {
      t.prepare('UPDATE reseller_shares SET margin = ?, active = 1, updated_at = ? WHERE id = ?').run(rupees * 100, now, had.id);
      return had;
    }
    let code;
    do code = resell.newCode('SH'); while (t.prepare('SELECT 1 FROM reseller_shares WHERE code = ?').get(code));
    const id = Number(t.prepare('INSERT INTO reseller_shares (code, reseller_id, product_id, margin, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(code, req.reseller.id, productId, rupees * 100, now, now).lastInsertRowid);
    return { id, code };
  });
  audit(req, 'reseller.share', { shareId: share.id, productId, margin: rupees * 100 });
  res.status(201).json({ share: shareList(d, req.reseller.id).find((s) => s.id === share.id) });
});

router.delete('/shares/:id', (req, res) => {
  const id = v.int(req.params.id, 'Share', { min: 1 });
  const r = db.get().prepare('UPDATE reseller_shares SET active = 0, updated_at = ? WHERE id = ? AND reseller_id = ?').run(Date.now(), id, req.reseller.id);
  if (!r.changes) throw new HttpError(404, 'Share not found.');
  res.json({ ok: true });
});

/** Orders through the reseller's links, and their customers (first name and city only). */
router.get('/sales', (req, res) => {
  const rows = resell.sales(db.get(), req.reseller.id);
  const customers = new Map();
  for (const r of rows) {
    const c = customers.get(r.customer.key) || { name: r.customer.name, city: r.customer.city, orders: new Set(), spent: 0, earned: 0, last: 0 };
    c.orders.add(r.orderId);
    if (r.stage !== 'lost') { c.spent += r.price * r.qty; c.earned += r.earn; }
    c.last = Math.max(c.last, r.createdAt);
    customers.set(r.customer.key, c);
  }
  res.json({
    sales: rows.map(({ customer, ...r }) => ({ ...r, customer: `${customer.name}, ${customer.city}` })),
    customers: [...customers.values()].map((c) => ({ ...c, orders: c.orders.size })).sort((a, b) => b.last - a.last),
    totals: totals(rows),
  });
});

router.get('/payouts', (req, res) => {
  const d = db.get();
  const payouts = d.prepare('SELECT * FROM reseller_payouts WHERE reseller_id = ? ORDER BY id DESC LIMIT 50').all(req.reseller.id);
  const fy = d.prepare('SELECT COALESCE(SUM(gross), 0) AS n FROM reseller_payouts WHERE reseller_id = ? AND created_at >= ?').get(req.reseller.id, resell.fyStart(Date.now())).n;
  res.json({ payouts, totals: totals(resell.sales(d, req.reseller.id)), yearToDate: fy, upiId: req.reseller.upi_id, rules: rules() });
});

// ---------- Public share page (no sign-in needed) ----------
const share = express.Router();

share.get('/:code', (req, res) => {
  const d = db.get();
  const s = resell.shareByCode(d, String(req.params.code || '').toUpperCase());
  if (!s) throw new HttpError(404, 'This shared link has ended. You can still find the item on Bazaario.');
  const p = d.prepare(`SELECT p.id, p.title, p.brand, p.price, p.mrp, p.stock, p.emoji, p.color, p.image, p.rating_avg, p.rating_count, p.description,
      p.features, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.active = 1`).get(s.product_id);
  if (!p) throw new HttpError(404, 'This item is no longer sold.');
  d.prepare('UPDATE reseller_shares SET views = views + 1 WHERE id = ?').run(s.id);
  const margin = resell.fitMargin(s.margin, p.price, p.mrp);
  res.json({ share: { code: s.code, resellerName: s.reseller_name }, product: { ...p, features: JSON.parse(p.features), price: p.price + margin } });
});

module.exports = { router, share };
