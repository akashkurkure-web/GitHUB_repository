'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const { quote } = require('../pricing');
const { HttpError, requireAuth, v } = require('../security');

const router = express.Router();
router.use(requireAuth);

// ---------------- Cart ----------------
function cartView(userId, coupon) {
  const q = quote(userId, coupon);
  const saved = db.get().prepare(
    `SELECT c.product_id, c.qty, p.title, p.price, p.mrp, p.stock, p.emoji, p.color, p.image
       FROM cart_items c JOIN products p ON p.id = c.product_id
      WHERE c.user_id = ? AND c.saved_for_later = 1 ORDER BY c.added_at DESC`
  ).all(userId);
  const count = q.lines.reduce((s, l) => s + l.qty, 0);
  return { ...q, saved, count, freeShippingThreshold: config.freeShippingThreshold };
}

function productForCart(productId) {
  const p = db.get().prepare('SELECT id, stock, active FROM products WHERE id = ?').get(productId);
  if (!p || !p.active) throw new HttpError(404, 'Product not found.');
  return p;
}

router.get('/cart', (req, res) => res.json(cartView(req.user.id)));

router.post('/cart', (req, res) => {
  const productId = v.int(req.body.productId, 'Product', { min: 1 });
  const qty = v.int(req.body.qty, 'Quantity', { min: 1, max: config.maxQtyPerItem, optional: true, def: 1 });
  const p = productForCart(productId);
  const existing = db.get().prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  const newQty = ((existing && existing.qty) || 0) + qty;
  if (newQty > config.maxQtyPerItem) throw new HttpError(400, `You can buy at most ${config.maxQtyPerItem} units of this item.`);
  if (newQty > p.stock) throw new HttpError(400, p.stock ? `Only ${p.stock} left in stock.` : 'This item is currently out of stock.');
  db.get().prepare(`INSERT INTO cart_items (user_id, product_id, qty, saved_for_later, added_at) VALUES (?,?,?,0,?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET qty = excluded.qty, saved_for_later = 0`)
    .run(req.user.id, productId, newQty, Date.now());
  res.status(201).json(cartView(req.user.id));
});

router.patch('/cart/:productId', (req, res) => {
  const productId = v.int(req.params.productId, 'Product', { min: 1 });
  const row = db.get().prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  if (!row) throw new HttpError(404, 'Item is not in your cart.');
  if (req.body.savedForLater !== undefined) {
    db.get().prepare('UPDATE cart_items SET saved_for_later = ? WHERE user_id = ? AND product_id = ?')
      .run(req.body.savedForLater ? 1 : 0, req.user.id, productId);
  }
  if (req.body.qty !== undefined) {
    const qty = v.int(req.body.qty, 'Quantity', { min: 1, max: config.maxQtyPerItem });
    const p = productForCart(productId);
    if (qty > p.stock) throw new HttpError(400, `Only ${p.stock} left in stock.`);
    db.get().prepare('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?').run(qty, req.user.id, productId);
  }
  res.json(cartView(req.user.id));
});

router.delete('/cart/:productId', (req, res) => {
  const productId = v.int(req.params.productId, 'Product', { min: 1 });
  db.get().prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  res.json(cartView(req.user.id));
});

/** Merge a guest (signed-out) cart into the account after sign-in. */
router.post('/cart/merge', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  const upsert = db.get().prepare(`INSERT INTO cart_items (user_id, product_id, qty, saved_for_later, added_at) VALUES (?,?,?,0,?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET qty = MIN(?, MAX(cart_items.qty, excluded.qty))`);
  for (const it of items) {
    const productId = Number(it && it.productId);
    const qty = Number(it && it.qty);
    if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty < 1) continue;
    const p = db.get().prepare('SELECT stock FROM products WHERE id = ? AND active = 1').get(productId);
    if (!p || p.stock < 1) continue;
    const capped = Math.min(qty, p.stock, config.maxQtyPerItem);
    upsert.run(req.user.id, productId, capped, Date.now(), Math.min(p.stock, config.maxQtyPerItem));
  }
  res.json(cartView(req.user.id));
});

router.post('/cart/coupon', (req, res) => {
  const code = v.str(req.body.code, 'Coupon code', { min: 3, max: 20, pattern: /^[A-Za-z0-9]+$/ });
  res.json(cartView(req.user.id, code));
});

// ---------------- Wishlist ----------------
router.get('/wishlist', (req, res) => {
  const items = db.get().prepare(
    `SELECT p.id, p.title, p.brand, p.price, p.mrp, p.stock, p.rating_avg, p.rating_count, p.emoji, p.color, p.image, p.express
       FROM wishlist w JOIN products p ON p.id = w.product_id WHERE w.user_id = ? AND p.active = 1 ORDER BY w.added_at DESC`
  ).all(req.user.id);
  res.json({ items });
});

router.post('/wishlist', (req, res) => {
  const productId = v.int(req.body.productId, 'Product', { min: 1 });
  productForCart(productId);
  db.get().prepare('INSERT OR IGNORE INTO wishlist (user_id, product_id, added_at) VALUES (?,?,?)').run(req.user.id, productId, Date.now());
  res.status(201).json({ ok: true });
});

router.delete('/wishlist/:productId', (req, res) => {
  const productId = v.int(req.params.productId, 'Product', { min: 1 });
  db.get().prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  res.json({ ok: true });
});

// ---------------- Addresses ----------------
const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

function readAddress(body) {
  const state = v.str(body.state, 'State', { max: 60 });
  if (!INDIAN_STATES.includes(state)) throw new HttpError(400, 'Please choose a valid state.');
  return {
    full_name: v.str(body.fullName, 'Full name', { min: 2, max: 60 }),
    phone: v.phone(body.phone),
    line1: v.str(body.line1, 'Address line 1', { min: 3, max: 120 }),
    line2: v.str(body.line2, 'Address line 2', { max: 120, optional: true }),
    city: v.str(body.city, 'City', { min: 2, max: 60 }),
    state,
    pincode: v.pincode(body.pincode),
  };
}

router.get('/addresses/states', (_req, res) => res.json({ states: INDIAN_STATES }));

router.get('/addresses', (req, res) => {
  res.json({ addresses: db.get().prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id) });
});

router.post('/addresses', (req, res) => {
  const a = readAddress(req.body);
  const count = db.get().prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').get(req.user.id).n;
  if (count >= 20) throw new HttpError(400, 'You can save up to 20 addresses.');
  const makeDefault = count === 0 || !!req.body.isDefault;
  const id = db.tx((d) => {
    if (makeDefault) d.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    return Number(d.prepare(`INSERT INTO addresses (user_id, full_name, phone, line1, line2, city, state, pincode, is_default)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, a.full_name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, makeDefault ? 1 : 0).lastInsertRowid);
  });
  res.status(201).json({ id });
});

router.put('/addresses/:id', (req, res) => {
  const id = v.int(req.params.id, 'Address', { min: 1 });
  const a = readAddress(req.body);
  db.tx((d) => {
    const own = d.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!own) throw new HttpError(404, 'Address not found.');
    if (req.body.isDefault) d.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    d.prepare(`UPDATE addresses SET full_name=?, phone=?, line1=?, line2=?, city=?, state=?, pincode=?,
      is_default = CASE WHEN ? THEN 1 ELSE is_default END WHERE id = ? AND user_id = ?`)
      .run(a.full_name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, req.body.isDefault ? 1 : 0, id, req.user.id);
  });
  res.json({ ok: true });
});

router.delete('/addresses/:id', (req, res) => {
  const id = v.int(req.params.id, 'Address', { min: 1 });
  // Ownership enforced in the WHERE clause (prevents IDOR).
  db.get().prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
