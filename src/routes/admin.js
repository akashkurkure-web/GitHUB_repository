'use strict';
const express = require('express');
const db = require('../db');
const { loadOrder, restock } = require('./orders');
const { HttpError, requireAdmin, audit, v } = require('../security');

const router = express.Router();
router.use(requireAdmin);

router.get('/stats', (_req, res) => {
  const d = db.get();
  res.json({
    revenue: d.prepare("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status NOT IN ('cancelled','returned')").get().n,
    orders: d.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    pending: d.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('placed','packed','shipped','return_requested')").get().n,
    customers: d.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    products: d.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n,
    lowStock: d.prepare('SELECT id, title, stock FROM products WHERE active = 1 AND stock < 20 ORDER BY stock LIMIT 10').all(),
  });
});

// ---------- Products ----------
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
      emoji, color, express, is_deal, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.title, p.brand, p.category_id, p.description, p.features, p.price, p.mrp, p.stock, p.emoji, p.color, p.express,
      p.is_deal, p.active, Date.now()).lastInsertRowid);
  audit(req, 'admin.product_create', { productId: id });
  res.status(201).json({ id });
});

router.put('/products/:id', (req, res) => {
  const id = v.int(req.params.id, 'Product', { min: 1 });
  const p = readProduct(req.body);
  const r = db.get().prepare(`UPDATE products SET title=?, brand=?, category_id=?, description=?, features=?, price=?, mrp=?,
      stock=?, emoji=?, color=?, express=?, is_deal=?, active=? WHERE id = ?`)
    .run(p.title, p.brand, p.category_id, p.description, p.features, p.price, p.mrp, p.stock, p.emoji, p.color, p.express,
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

// ---------- Orders (fulfilment workflow) ----------
const TRANSITIONS = {
  placed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  return_requested: ['returned', 'delivered'],
  returned: [],
  cancelled: [],
};

router.get('/orders', (req, res) => {
  const status = typeof req.query.status === 'string' && TRANSITIONS[req.query.status] ? req.query.status : null;
  const rows = db.get().prepare(
    `SELECT o.id, o.order_no, o.status, o.total, o.payment_method, o.payment_status, o.created_at, u.name AS customer, u.email
       FROM orders o JOIN users u ON u.id = o.user_id ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.created_at DESC LIMIT 200`
  ).all(...(status ? [status] : []));
  res.json({ orders: rows, transitions: TRANSITIONS });
});

router.get('/orders/:id', (req, res) => {
  res.json({ order: loadOrder(null, v.int(req.params.id, 'Order', { min: 1 }), true), transitions: TRANSITIONS });
});

router.patch('/orders/:id', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const next = String(req.body.status || '');
  db.tx((d) => {
    const o = d.prepare('SELECT status, payment_method, payment_status FROM orders WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (!TRANSITIONS[o.status].includes(next)) throw new HttpError(400, `Cannot move an order from "${o.status}" to "${next}".`);
    const now = Date.now();
    let payment = o.payment_status;
    if (next === 'delivered' && o.payment_method === 'cod') payment = 'paid';
    if ((next === 'cancelled' || next === 'returned') && payment === 'paid') payment = 'refunded';
    d.prepare(`UPDATE orders SET status = ?, payment_status = ?, updated_at = ?,
      delivered_at = CASE WHEN ? = 'delivered' AND delivered_at IS NULL THEN ? ELSE delivered_at END WHERE id = ?`)
      .run(next, payment, now, next, now, id);
    if (next === 'cancelled' || next === 'returned') restock(d, id);
  });
  audit(req, 'admin.order_status', { orderId: id, status: next });
  res.json({ order: loadOrder(null, id, true) });
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
