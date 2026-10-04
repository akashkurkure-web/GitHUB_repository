'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const { quote } = require('../pricing');
const market = require('../market');
const resell = require('../resell');
const { INDIAN_STATES } = require('../states');
const { HttpError, requireAuth, v } = require('../security');

const router = express.Router();
router.use(requireAuth);

// ---------------- Cart ----------------
function cartView(userId, coupon, pincode = null) {
  const q = quote(userId, coupon, undefined, { pincode });
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

/** A specific seller's offer, picked under "Other sellers" on the product page. */
function offerForCart(productId, offerId) {
  const o = market.offerById(db.get(), offerId);
  if (!o || o.product_id !== productId || !o.active || o.status !== 'approved') throw new HttpError(404, 'This seller no longer sells this item.');
  return o;
}

/** Stock available for a bag line: from the chosen seller, or else the best offer. */
function lineStock(userId, productId) {
  const row = db.get().prepare('SELECT offer_id FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, productId);
  if (row && row.offer_id) {
    const o = market.offerById(db.get(), row.offer_id);
    if (o && o.active && o.status === 'approved') return o.stock;
  }
  return productForCart(productId).stock;
}

// ?pin= lets the bag show "Express near you" for lines a partner shop nearby can bring.
const pinOf = (req) => (typeof req.query.pin === 'string' && /^[1-9][0-9]{5}$/.test(req.query.pin) ? req.query.pin : null);

router.get('/cart', (req, res) => res.json(cartView(req.user.id, null, pinOf(req))));

router.post('/cart', (req, res) => {
  const productId = v.int(req.body.productId, 'Product', { min: 1 });
  const qty = v.int(req.body.qty, 'Quantity', { min: 1, max: config.maxQtyPerItem, optional: true, def: 1 });
  const p = productForCart(productId);
  const offerId = v.int(req.body.offerId, 'Seller offer', { min: 1, optional: true });
  // Opened from a reseller's share: the reseller's margin rides on the line until it is bought.
  let shareId = null;
  if (req.body.shareCode !== undefined) {
    const share = resell.shareByCode(db.get(), req.body.shareCode);
    if (!share || share.product_id !== productId) throw new HttpError(404, 'This shared link has ended.');
    shareId = share.id;
  }
  const stock = offerId ? offerForCart(productId, offerId).stock : p.stock;
  const existing = db.get().prepare('SELECT qty, offer_id, share_id FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  // Picking a different seller replaces the line instead of adding to it.
  const sameOffer = existing && (existing.offer_id || null) === (offerId || null);
  const newQty = (sameOffer ? existing.qty : 0) + qty;
  if (newQty > config.maxQtyPerItem) throw new HttpError(400, `You can buy at most ${config.maxQtyPerItem} units of this item.`);
  if (newQty > stock) throw new HttpError(400, stock ? `Only ${stock} left in stock.` : 'This item is currently out of stock.');
  // A share stays on the line when the same item is added again without one; picking another seller drops it.
  const keepShare = shareId || (sameOffer && existing.share_id) || null;
  db.get().prepare(`INSERT INTO cart_items (user_id, product_id, qty, saved_for_later, added_at, offer_id, share_id) VALUES (?,?,?,0,?,?,?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET qty = excluded.qty, saved_for_later = 0, offer_id = excluded.offer_id, share_id = excluded.share_id`)
    .run(req.user.id, productId, newQty, Date.now(), offerId || null, keepShare);
  res.status(201).json(cartView(req.user.id, null, pinOf(req)));
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
    const stock = lineStock(req.user.id, productId);
    if (qty > stock) throw new HttpError(400, `Only ${stock} left in stock.`);
    db.get().prepare('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?').run(qty, req.user.id, productId);
  }
  res.json(cartView(req.user.id, null, pinOf(req)));
});

router.delete('/cart/:productId', (req, res) => {
  const productId = v.int(req.params.productId, 'Product', { min: 1 });
  db.get().prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  res.json(cartView(req.user.id, null, pinOf(req)));
});

/** Merge a guest (signed-out) cart into the account after sign-in. */
router.post('/cart/merge', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  const upsert = db.get().prepare(`INSERT INTO cart_items (user_id, product_id, qty, saved_for_later, added_at, offer_id, share_id) VALUES (?,?,?,0,?,?,?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET qty = MIN(?, MAX(cart_items.qty, excluded.qty)), offer_id = COALESCE(excluded.offer_id, cart_items.offer_id),
      share_id = COALESCE(excluded.share_id, cart_items.share_id)`);
  for (const it of items) {
    const productId = Number(it && it.productId);
    const qty = Number(it && it.qty);
    if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty < 1) continue;
    const p = db.get().prepare('SELECT stock FROM products WHERE id = ? AND active = 1').get(productId);
    if (!p) continue;
    // A seller picked while signed out is kept if that seller still sells the item.
    let offerId = null;
    let stock = p.stock;
    if (Number.isInteger(Number(it.offerId)) && Number(it.offerId) > 0) {
      const o = market.offerById(db.get(), Number(it.offerId));
      if (o && o.product_id === productId && o.active && o.status === 'approved') { offerId = o.id; stock = o.stock; }
    }
    if (stock < 1) continue;
    const share = it.shareCode ? resell.shareByCode(db.get(), it.shareCode) : null;
    const capped = Math.min(qty, stock, config.maxQtyPerItem);
    upsert.run(req.user.id, productId, capped, Date.now(), offerId, share && share.product_id === productId ? share.id : null, Math.min(stock, config.maxQtyPerItem));
  }
  res.json(cartView(req.user.id));
});

router.post('/cart/coupon', (req, res) => {
  const code = v.str(req.body.code, 'Coupon code', { min: 3, max: 20, pattern: /^[A-Za-z0-9]+$/ });
  res.json(cartView(req.user.id, code, pinOf(req)));
});

// ---------------- Wishlist ----------------
router.get('/wishlist', (req, res) => {
  const items = db.get().prepare(
    `SELECT p.id, p.title, p.brand, p.price, p.mrp, p.stock, p.rating_avg, p.rating_count, p.emoji, p.color, p.image, p.express
       FROM wishlist w JOIN products p ON p.id = w.product_id WHERE w.user_id = ? AND p.active = 1 ORDER BY w.added_at DESC`
  ).all(req.user.id);
  const growth = require('../growth');
  growth.applySales(db.get(), items, { plus: !!growth.membership(db.get(), req.user.id) });
  res.json({ items });
});

router.post('/wishlist', (req, res) => {
  const productId = v.int(req.body.productId, 'Product', { min: 1 });
  productForCart(productId);
  // The price and stock when saved, so we can tell the buyer when it drops or comes back (win-back messages).
  const p = db.get().prepare('SELECT price, stock FROM products WHERE id = ?').get(productId);
  db.get().prepare('INSERT OR IGNORE INTO wishlist (user_id, product_id, added_at, price_at_add, stock_at_add) VALUES (?,?,?,?,?)')
    .run(req.user.id, productId, Date.now(), p.price, p.stock);
  res.status(201).json({ ok: true });
});

router.delete('/wishlist/:productId', (req, res) => {
  const productId = v.int(req.params.productId, 'Product', { min: 1 });
  db.get().prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  res.json({ ok: true });
});

// ---------------- Addresses ----------------
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
