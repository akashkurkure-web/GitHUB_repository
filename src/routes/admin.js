'use strict';
const express = require('express');
const db = require('../db');
const { loadOrder } = require('./orders');
const { FLOW, move, event } = require('../fulfilment');
const notify = require('../notify');
const { saveProductPhoto } = require('../uploads');
const { readDetails } = require('../listing');
const market = require('../market');
const routing = require('../routing');
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
    held: d.prepare("SELECT COUNT(*) AS n FROM orders WHERE hold_reason IS NOT NULL AND status = 'placed'").get().n,
    sellerApplications: d.prepare("SELECT COUNT(*) AS n FROM sellers WHERE status = 'pending'").get().n,
    qcQueue: d.prepare("SELECT COUNT(*) AS n FROM products WHERE qc_status = 'pending'").get().n,
    claims: d.prepare("SELECT COUNT(*) AS n FROM claims WHERE status = 'open'").get().n,
    sellers: d.prepare("SELECT COUNT(*) AS n FROM sellers WHERE status = 'approved' AND lane != 'direct'").get().n,
  });
});

// ---------- Products ----------
// Upload a product photo (sent as a data URL).
router.post('/uploads', (req, res) => {
  const { url, bytes } = saveProductPhoto(req.body.dataUrl);
  audit(req, 'admin.photo_upload', { bytes });
  res.status(201).json({ url });
});

// Studio edits a product's page and Bazaario Direct's own offer on it (price and stock).
function readProduct(body) {
  const details = readDetails(body);
  const price = v.int(body.price, 'Price (₹)', { min: 1, max: 10_000_000 }) * 100;
  if (price > details.mrp) throw new HttpError(400, 'Selling price cannot be higher than MRP.');
  return {
    ...details,
    price,
    stock: v.int(body.stock, 'Stock', { min: 0, max: 1_000_000 }),
    emoji: v.str(body.emoji, 'Icon', { max: 8, optional: true }) || '📦',
    color: v.str(body.color, 'Colour', { pattern: /^#[0-9a-fA-F]{6}$/, optional: true }) || '#e3e6e6',
    express: body.express ? 1 : 0,
    is_deal: body.isDeal ? 1 : 0,
    active: body.active === false ? 0 : 1,
  };
}

/** Creates or updates Bazaario Direct's offer. A product only sellers stock gets one once Studio adds stock. */
function saveDirectOffer(d, productId, price, stock) {
  const dir = market.direct(d);
  const now = Date.now();
  const has = d.prepare('SELECT id FROM offers WHERE product_id = ? AND seller_id = ?').get(productId, dir.id);
  if (has) d.prepare('UPDATE offers SET price = ?, stock = ?, active = 1, updated_at = ? WHERE id = ?').run(price, stock, now, has.id);
  else if (stock > 0) {
    d.prepare('INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, active, created_at, updated_at) VALUES (?,?,?,?,1,1,?,?)')
      .run(productId, dir.id, price, stock, now, now);
  }
  market.syncProduct(d, productId);
}

router.get('/products', (req, res) => {
  const q = typeof req.query.q === 'string' ? `%${req.query.q.slice(0, 60)}%` : '%';
  const dir = market.direct(db.get());
  res.json({
    products: db.get().prepare(
      `SELECT p.*, c.name AS category_name, p.price AS best_price, s.display_name AS best_seller,
              COALESCE(o.price, p.price) AS price, COALESCE(o.stock, 0) AS stock
         FROM products p JOIN categories c ON c.id = p.category_id
         LEFT JOIN offers o ON o.product_id = p.id AND o.seller_id = ?
         LEFT JOIN sellers s ON s.id = p.seller_id
        WHERE (p.title LIKE ? OR p.brand LIKE ?) AND p.qc_status = 'approved' ORDER BY p.id DESC LIMIT 200`
    ).all(dir.id, q, q).map((p) => ({ ...p, features: JSON.parse(p.features), specs: JSON.parse(p.specs) })),
  });
});

router.post('/products', (req, res) => {
  const p = readProduct(req.body);
  const id = db.tx((d) => {
    const pid = Number(d.prepare(`INSERT INTO products (title, brand, category_id, description, features, price, mrp, stock,
        emoji, color, image, express, is_deal, active, hsn, gst_rate, origin, manufacturer, specs, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.title, p.brand, p.category_id, p.description, p.features, p.price, p.mrp, p.stock, p.emoji, p.color, p.image, p.express,
        p.is_deal, p.active, p.hsn, p.gst_rate, p.origin, p.manufacturer, p.specs, Date.now()).lastInsertRowid);
    const dir = market.direct(d);
    const now = Date.now();
    d.prepare('INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, active, created_at, updated_at) VALUES (?,?,?,?,1,1,?,?)')
      .run(pid, dir.id, p.price, p.stock, now, now);
    market.syncProduct(d, pid);
    return pid;
  });
  audit(req, 'admin.product_create', { productId: id });
  res.status(201).json({ id });
});

router.put('/products/:id', (req, res) => {
  const id = v.int(req.params.id, 'Product', { min: 1 });
  const p = readProduct(req.body);
  db.tx((d) => {
    const r = d.prepare(`UPDATE products SET title=?, brand=?, category_id=?, description=?, features=?, mrp=?,
        emoji=?, color=?, image=?, express=?, is_deal=?, active=?, hsn=?, gst_rate=?, origin=?, manufacturer=?, specs=? WHERE id = ?`)
      .run(p.title, p.brand, p.category_id, p.description, p.features, p.mrp, p.emoji, p.color, p.image, p.express,
        p.is_deal, p.active, p.hsn, p.gst_rate, p.origin, p.manufacturer, p.specs, id);
    if (!r.changes) throw new HttpError(404, 'Product not found.');
    // A seller's price may never be above MRP: offers left above a lowered MRP are paused until the seller fixes them.
    d.prepare('UPDATE offers SET active = 0, updated_at = ? WHERE product_id = ? AND price > ?').run(Date.now(), id, p.mrp);
    saveDirectOffer(d, id, p.price, p.stock);
  });
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
// The order board shows who has each order and why it went there (blueprint stage 6).
router.get('/orders', (req, res) => {
  routing.sweep();
  const held = req.query.status === 'held';
  const status = !held && typeof req.query.status === 'string' && FLOW[req.query.status] ? req.query.status : null;
  const where = held ? "WHERE o.hold_reason IS NOT NULL AND o.status = 'placed'" : status ? 'WHERE o.status = ?' : '';
  const rows = db.get().prepare(
    `SELECT o.id, o.order_no, o.status, o.total, o.payment_method, o.payment_status, o.delivery_speed, o.promised_at, o.awb,
       o.created_at, o.hold_reason, o.route_reason, o.accept_by, o.checkout_ref, u.name AS customer, u.email,
       s.display_name AS seller, s.lane AS seller_lane, s.fulfilment AS seller_fulfilment,
       (SELECT note FROM order_events e WHERE e.order_id = o.id AND e.status = 'reattempt_requested' ORDER BY e.id DESC LIMIT 1) AS reattempt
       FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN sellers s ON s.id = o.seller_id
       ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT 200`
  ).all(...(status ? [status] : []));
  res.json({ orders: rows, transitions: FLOW });
});

// A held order was checked and is fine: send it to its seller.
router.post('/orders/:id/release', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  db.tx((d) => routing.release(d, id));
  audit(req, 'admin.order_release', { orderId: id });
  res.json({ order: loadOrder(null, id, true) });
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
  // Campaign rules (blueprint stage 12): when it runs, how often it can be used, and who can use it.
  const when = (x, field) => {
    if (x === undefined || x === null || x === '') return null;
    const t = Number(x);
    if (!Number.isFinite(t) || t <= 0) throw new HttpError(400, `${field} is not a valid date.`);
    return t;
  };
  const startsAt = when(req.body.startsAt, 'Starts');
  const endsAt = when(req.body.endsAt, 'Ends');
  if (startsAt && endsAt && endsAt <= startsAt) throw new HttpError(400, 'The coupon must end after it starts.');
  const perUserLimit = v.int(req.body.perUserLimit, 'Uses per buyer', { min: 1, max: 100, optional: true }) ?? null;
  const maxUses = v.int(req.body.maxUses, 'Total uses', { min: 1, max: 1000000, optional: true }) ?? null;
  db.get().prepare(`INSERT INTO coupons (code, kind, value, max_discount, min_order, description, active, starts_at, ends_at, per_user_limit, max_uses, first_order_only, plus_only)
    VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET kind=excluded.kind, value=excluded.value, max_discount=excluded.max_discount,
    min_order=excluded.min_order, description=excluded.description, active=1, starts_at=excluded.starts_at, ends_at=excluded.ends_at,
    per_user_limit=excluded.per_user_limit, max_uses=excluded.max_uses, first_order_only=excluded.first_order_only, plus_only=excluded.plus_only`)
    .run(code, kind, value, maxDiscount ? maxDiscount * 100 : null, minOrder * 100, description, startsAt, endsAt, perUserLimit, maxUses,
      req.body.firstOrderOnly ? 1 : 0, req.body.plusOnly ? 1 : 0);
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
