'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { loadOrder } = require('./orders');
const { FLOW, move, event } = require('../fulfilment');
const notify = require('../notify');
const { HttpError, requireAdmin, audit, v } = require('../security');

const router = express.Router();
router.use(requireAdmin);

router.get('/stats', (_req, res) => {
  const d = db.get();
  res.json({
    revenue: d.prepare("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status NOT IN ('cancelled','returned','rto')").get().n,
    orders: d.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    pending: d.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('placed','confirmed','packed','shipped','out_for_delivery','delivery_failed')").get().n,
    returns: d.prepare("SELECT COUNT(*) AS n FROM returns WHERE status IN ('requested','pickup_scheduled')").get().n,
    tickets: d.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'").get().n,
    overdueTickets: d.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open' AND due_at < ?").get(Date.now()).n,
    failedDeliveries: d.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'delivery_failed'").get().n,
    customers: d.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    products: d.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n,
    lowStock: d.prepare('SELECT id, title, stock FROM products WHERE active = 1 AND stock < 20 ORDER BY stock LIMIT 10').all(),
  });
});

// ---------- Products ----------
// A product photo is a link to an https image, a photo uploaded below, or (demo build only) an inline image.
function readImage(val) {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val !== 'string') throw new HttpError(400, 'Photo must be a link.');
  const s = val.trim();
  if (/^\/uploads\/products\/[a-z0-9-]+\.(jpg|png|webp)$/.test(s)) return s;
  if (/^img\/products\/[a-z0-9-]+\.svg$/.test(s)) return s;
  if (config.inlineImages && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < config.maxImageBytes * 1.4) return s;
  let url;
  try { url = new URL(s); } catch { throw new HttpError(400, 'Photo link is not a valid web address.'); }
  if (url.protocol !== 'https:' || s.length > 1000) throw new HttpError(400, 'Photo link must start with https:// and be under 1,000 characters.');
  return url.href;
}

const IMAGE_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

// Upload a product photo (sent as a data URL). The file type is checked from its bytes, not its name.
router.post('/uploads', (req, res) => {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof req.body.dataUrl === 'string' ? req.body.dataUrl : '');
  if (!m) throw new HttpError(400, 'Please choose a JPG, PNG or WebP photo.');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > config.maxImageBytes) throw new HttpError(413, 'Photo is too large. Please use one under 2 MB.');
  const type = IMAGE_TYPES.find((t) => bytes.length > 12 && t.test(bytes));
  if (!type) throw new HttpError(400, 'Please choose a JPG, PNG or WebP photo.');
  let url;
  if (config.inlineImages) {
    url = `data:${type.mime};base64,${bytes.toString('base64')}`;
  } else {
    const dir = path.join(config.uploadDir, 'products');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
    fs.writeFileSync(path.join(dir, name), bytes);
    url = `/uploads/products/${name}`;
  }
  audit(req, 'admin.photo_upload', { bytes: bytes.length });
  res.status(201).json({ url });
});
function readProduct(body) {
  const price = v.int(body.price, 'Price (₹)', { min: 1, max: 10_000_000 });
  const mrp = v.int(body.mrp, 'MRP (₹)', { min: 1, max: 10_000_000 });
  if (price > mrp) throw new HttpError(400, 'Selling price cannot be higher than MRP.');
  const categoryId = v.int(body.categoryId, 'Category', { min: 1 });
  if (!db.get().prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw new HttpError(400, 'Unknown category.');
  const features = Array.isArray(body.features) ? body.features : String(body.features || '').split('\n');
  return {
    title: v.str(body.title, 'Title', { min: 3, max: 200 }),
    brand: v.str(body.brand, 'Brand', { min: 1, max: 60 }),
    category_id: categoryId,
    description: v.str(body.description, 'Description', { max: 4000, optional: true }),
    features: JSON.stringify(features.map((f) => String(f).trim()).filter(Boolean).slice(0, 15).map((f) => f.slice(0, 200))),
    price: price * 100,
    mrp: mrp * 100,
    stock: v.int(body.stock, 'Stock', { min: 0, max: 1_000_000 }),
    emoji: v.str(body.emoji, 'Icon', { max: 8, optional: true }) || '📦',
    color: v.str(body.color, 'Colour', { pattern: /^#[0-9a-fA-F]{6}$/, optional: true }) || '#e3e6e6',
    image: readImage(body.image),
    express: body.express ? 1 : 0,
    is_deal: body.isDeal ? 1 : 0,
    active: body.active === false ? 0 : 1,
  };
}

router.get('/products', (req, res) => {
  const q = typeof req.query.q === 'string' ? `%${req.query.q.slice(0, 60)}%` : '%';
  res.json({
    products: db.get().prepare(
      `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.title LIKE ? OR p.brand LIKE ? ORDER BY p.id DESC LIMIT 200`
    ).all(q, q).map((p) => ({ ...p, features: JSON.parse(p.features) })),
  });
});

router.post('/products', (req, res) => {
  const p = readProduct(req.body);
  const id = Number(db.get().prepare(`INSERT INTO products (title, brand, category_id, description, features, price, mrp, stock,
      emoji, color, image, express, is_deal, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.title, p.brand, p.category_id, p.description, p.features, p.price, p.mrp, p.stock, p.emoji, p.color, p.image, p.express,
      p.is_deal, p.active, Date.now()).lastInsertRowid);
  audit(req, 'admin.product_create', { productId: id });
  res.status(201).json({ id });
});

router.put('/products/:id', (req, res) => {
  const id = v.int(req.params.id, 'Product', { min: 1 });
  const p = readProduct(req.body);
  const r = db.get().prepare(`UPDATE products SET title=?, brand=?, category_id=?, description=?, features=?, price=?, mrp=?,
      stock=?, emoji=?, color=?, image=?, express=?, is_deal=?, active=? WHERE id = ?`)
    .run(p.title, p.brand, p.category_id, p.description, p.features, p.price, p.mrp, p.stock, p.emoji, p.color, p.image, p.express,
      p.is_deal, p.active, id);
  if (!r.changes) throw new HttpError(404, 'Product not found.');
  audit(req, 'admin.product_update', { productId: id });
  res.json({ ok: true });
});

// Soft delete: keeps order history intact.
router.delete('/products/:id', (req, res) => {
  const id = v.int(req.params.id, 'Product', { min: 1 });
  db.get().prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
  audit(req, 'admin.product_deactivate', { productId: id });
  res.json({ ok: true });
});

// ---------- Orders (fulfilment workflow, blueprint stages 6-8) ----------
router.get('/orders', (req, res) => {
  const status = typeof req.query.status === 'string' && FLOW[req.query.status] ? req.query.status : null;
  const rows = db.get().prepare(
    `SELECT o.id, o.order_no, o.status, o.total, o.payment_method, o.payment_status, o.delivery_speed, o.promised_at, o.awb,
       o.created_at, u.name AS customer, u.email,
       (SELECT note FROM order_events e WHERE e.order_id = o.id AND e.status = 'reattempt_requested' ORDER BY e.id DESC LIMIT 1) AS reattempt
       FROM orders o JOIN users u ON u.id = o.user_id ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.created_at DESC LIMIT 200`
  ).all(...(status ? [status] : []));
  res.json({ orders: rows, transitions: FLOW });
});

router.get('/orders/:id', (req, res) => {
  res.json({ order: loadOrder(null, v.int(req.params.id, 'Order', { min: 1 }), true), transitions: FLOW });
});

router.patch('/orders/:id', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const next = String(req.body.status || '');
  if (!FLOW[next]) throw new HttpError(400, 'Unknown order status.');
  const note = v.str(req.body.note, 'Note', { max: 200, optional: true });
  db.tx((d) => move(d, id, next, { actor: 'admin', note }));
  audit(req, 'admin.order_status', { orderId: id, status: next });
  res.json({ order: loadOrder(null, id, true) });
});

// ---------- Returns queue (blueprint stage 9) ----------
router.get('/returns', (_req, res) => {
  res.json({ returns: db.get().prepare(
    `SELECT r.id, r.order_id, r.reason, r.comment, r.refund_to, r.status, r.note, r.created_at, r.updated_at,
       o.order_no, o.total, o.payment_method, u.name AS customer, u.email
       FROM returns r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
      ORDER BY CASE r.status WHEN 'requested' THEN 0 WHEN 'pickup_scheduled' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 200`
  ).all() });
});

const RETURN_ACTIONS = {
  approve: { from: ['requested'], to: 'pickup_scheduled' },
  refund: { from: ['pickup_scheduled'], to: 'refunded' },
  reject: { from: ['requested', 'pickup_scheduled'], to: 'rejected' },
};

router.patch('/returns/:id', (req, res) => {
  const id = v.int(req.params.id, 'Return', { min: 1 });
  const action = RETURN_ACTIONS[req.body.action];
  if (!action) throw new HttpError(400, 'Unknown return action.');
  const note = v.str(req.body.note, 'Note', { max: 300, optional: req.body.action !== 'reject' });
  db.tx((d) => {
    const r = d.prepare('SELECT * FROM returns WHERE id = ?').get(id);
    if (!r) throw new HttpError(404, 'Return not found.');
    if (!action.from.includes(r.status)) throw new HttpError(400, 'This return has already moved on. Refresh to see its latest state.');
    const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(r.order_id);
    if (req.body.action === 'approve') {
      event(d, o.id, 'return_pickup', note || 'Pickup scheduled within 2 working days');
      notify.orderUpdate(d, o, 'Your return is approved. Our delivery partner will pick it up within 2 working days.');
    }
    if (req.body.action === 'refund') {
      // Item received and checked: close the order as returned, which restocks it and pays the refund.
      move(d, o.id, 'returned', { actor: 'admin', allowAny: true, refundToWallet: r.refund_to === 'wallet', note });
    }
    if (req.body.action === 'reject') {
      d.prepare("UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ?").run(Date.now(), o.id);
      event(d, o.id, 'return_rejected', note);
      notify.orderUpdate(d, o, `We could not accept your return: ${note}`);
    }
    d.prepare('UPDATE returns SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(action.to, note || r.note, Date.now(), id);
  });
  audit(req, 'admin.return', { returnId: id, action: req.body.action });
  res.json({ ok: true });
});

// ---------- Messages sent to buyers (test outbox) ----------
router.get('/messages', (_req, res) => {
  res.json({ messages: db.get().prepare(
    `SELECT n.id, n.channel, n.recipient, n.body, n.provider, n.created_at, o.order_no
       FROM notifications n LEFT JOIN orders o ON o.id = n.order_id ORDER BY n.id DESC LIMIT 200`
  ).all() });
});

// ---------- Customers, coupons, audit ----------
router.get('/users', (_req, res) => {
  res.json({ users: db.get().prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at, u.locked_until,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders FROM users u ORDER BY u.id DESC LIMIT 200`
  ).all() });
});

router.get('/coupons', (_req, res) => res.json({ coupons: db.get().prepare('SELECT * FROM coupons').all() }));

router.post('/coupons', (req, res) => {
  const code = v.str(req.body.code, 'Code', { min: 3, max: 20, pattern: /^[A-Za-z0-9]+$/ }).toUpperCase();
  const kind = req.body.kind === 'flat' ? 'flat' : 'percent';
  const value = kind === 'percent' ? v.int(req.body.value, 'Percent', { min: 1, max: 90 }) : v.int(req.body.value, 'Amount (₹)', { min: 1, max: 100000 }) * 100;
  const maxDiscount = v.int(req.body.maxDiscount, 'Max discount (₹)', { min: 1, max: 100000, optional: true });
  const minOrder = v.int(req.body.minOrder, 'Minimum order (₹)', { min: 0, max: 1000000, optional: true, def: 0 });
  const description = v.str(req.body.description, 'Description', { max: 200, optional: true });
  db.get().prepare(`INSERT INTO coupons (code, kind, value, max_discount, min_order, description, active) VALUES (?,?,?,?,?,?,1)
    ON CONFLICT(code) DO UPDATE SET kind=excluded.kind, value=excluded.value, max_discount=excluded.max_discount,
    min_order=excluded.min_order, description=excluded.description, active=1`)
    .run(code, kind, value, maxDiscount ? maxDiscount * 100 : null, minOrder * 100, description);
  audit(req, 'admin.coupon_upsert', { code });
  res.status(201).json({ ok: true });
});

router.delete('/coupons/:code', (req, res) => {
  db.get().prepare('UPDATE coupons SET active = 0 WHERE code = ?').run(String(req.params.code).slice(0, 20));
  audit(req, 'admin.coupon_disable', { code: req.params.code });
  res.json({ ok: true });
});

router.get('/audit', (_req, res) => {
  res.json({ entries: db.get().prepare(
    `SELECT a.id, a.action, a.detail, a.ip, a.created_at, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 200`
  ).all() });
});

module.exports = router;
