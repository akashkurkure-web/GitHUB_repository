'use strict';
const express = require('express');
const db = require('../db');
const delivery = require('../delivery');
const { HttpError, requireAuth, audit, v } = require('../security');

const router = express.Router();

const PRODUCT_COLS = `p.id, p.title, p.brand, p.price, p.mrp, p.stock, p.rating_avg, p.rating_count, p.sold_count,
  p.emoji, p.color, p.image, p.express, p.is_deal, c.slug AS category, c.name AS category_name`;

const SORTS = {
  relevance: 'p.is_deal DESC, p.sold_count DESC',
  'price-asc': 'p.price ASC',
  'price-desc': 'p.price DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC',
  newest: 'p.created_at DESC',
  discount: '(p.mrp - p.price) * 1.0 / p.mrp DESC',
};

router.get('/categories', (_req, res) => {
  res.json({ categories: db.get().prepare('SELECT id, slug, name, icon FROM categories ORDER BY id').all() });
});

router.get('/products', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 50) : '';
  const brands = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand.split(',').slice(0, 20) : [];
  const sort = SORTS[req.query.sort] ? req.query.sort : 'relevance';
  const minPrice = v.int(req.query.min, 'min', { min: 0, max: 1e7, optional: true });
  const maxPrice = v.int(req.query.max, 'max', { min: 0, max: 1e7, optional: true });
  const minRating = v.int(req.query.rating, 'rating', { min: 1, max: 4, optional: true });
  const page = v.int(req.query.page, 'page', { min: 1, max: 1000, optional: true, def: 1 });
  const pageSize = v.int(req.query.limit, 'limit', { min: 1, max: 48, optional: true, def: 12 });

  // Every value is bound as a parameter - never concatenated into SQL.
  const where = ['p.active = 1'];
  const params = [];
  if (q) {
    for (const word of q.split(/\s+/).slice(0, 6)) {
      const like = `%${word.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
  }
  if (category) { where.push('c.slug = ?'); params.push(category); }
  if (brands.length) { where.push(`p.brand IN (${brands.map(() => '?').join(',')})`); params.push(...brands); }
  if (minPrice !== undefined) { where.push('p.price >= ?'); params.push(minPrice * 100); }
  if (maxPrice !== undefined) { where.push('p.price <= ?'); params.push(maxPrice * 100); }
  if (minRating !== undefined) { where.push('p.rating_avg >= ?'); params.push(minRating); }
  if (req.query.express === '1') where.push('p.express = 1');
  if (req.query.deals === '1') where.push('p.is_deal = 1');
  if (req.query.instock === '1') where.push('p.stock > 0');

  const from = `FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
  const total = db.get().prepare(`SELECT COUNT(*) AS n ${from}`).get(...params).n;
  const items = db.get().prepare(`SELECT ${PRODUCT_COLS} ${from} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  // Brand facet for the filter sidebar: same query minus the brand filter itself.
  const facetWhere = [];
  const facetParams = [];
  let i = 0;
  for (const w of where) {
    const n = (w.match(/\?/g) || []).length;
    if (!w.startsWith('p.brand IN')) { facetWhere.push(w); facetParams.push(...params.slice(i, i + n)); }
    i += n;
  }
  const brandFacet = db.get().prepare(
    `SELECT p.brand, COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id
      WHERE ${facetWhere.join(' AND ')} GROUP BY p.brand ORDER BY n DESC, p.brand LIMIT 15`
  ).all(...facetParams);

  res.json({ items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), brands: brandFacet });
});

router.get('/products/suggest', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  if (q.length < 2) return res.json({ suggestions: [] });
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const rows = db.get().prepare(
    "SELECT id, title FROM products WHERE active = 1 AND (title LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\') ORDER BY sold_count DESC LIMIT 8"
  ).all(like, like);
  res.json({ suggestions: rows });
});

// Delivery promise for a PIN code: which speeds are available, when the parcel arrives, and whether COD works.
router.get('/delivery', (req, res) => {
  const pincode = v.pincode(req.query.pincode);
  const ids = typeof req.query.products === 'string' ? req.query.products.split(',').slice(0, 50).map(Number).filter(Number.isInteger) : [];
  const products = ids.length
    ? db.get().prepare(`SELECT id, express FROM products WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  res.json(delivery.options(pincode, products));
});

router.get('/products/:id', (req, res) => {
  const id = v.int(req.params.id, 'Product id', { min: 1 });
  const p = db.get().prepare(`SELECT ${PRODUCT_COLS}, p.description, p.features FROM products p
     JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.active = 1`).get(id);
  if (!p) throw new HttpError(404, 'Product not found.');
  p.features = JSON.parse(p.features);

  const dist = db.get().prepare('SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id = ? GROUP BY rating').all(id);
  const reviews = db.get().prepare(
    `SELECT r.id, r.rating, r.title, r.body, r.verified, r.created_at, u.name AS author
       FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 20`
  ).all(id);
  const related = db.get().prepare(`SELECT ${PRODUCT_COLS} FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.category_id = (SELECT category_id FROM products WHERE id = ?) AND p.id != ? AND p.active = 1
     ORDER BY p.sold_count DESC LIMIT 6`).all(id, id);

  let canReview = false;
  if (req.user) {
    canReview = !db.get().prepare('SELECT 1 FROM reviews WHERE product_id = ? AND user_id = ?').get(id, req.user.id);
  }
  res.json({ product: p, reviews, ratingDistribution: dist, related, canReview });
});

router.post('/products/:id/reviews', requireAuth, (req, res) => {
  const id = v.int(req.params.id, 'Product id', { min: 1 });
  const rating = v.int(req.body.rating, 'Rating', { min: 1, max: 5 });
  const title = v.str(req.body.title, 'Review title', { min: 3, max: 100 });
  const body = v.str(req.body.body, 'Review', { min: 10, max: 2000 });
  if (!db.get().prepare('SELECT 1 FROM products WHERE id = ? AND active = 1').get(id)) throw new HttpError(404, 'Product not found.');

  // "Verified Purchase" badge only when the reviewer received this product.
  const verified = db.get().prepare(
    `SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.user_id = ? AND i.product_id = ? AND o.status IN ('delivered','return_requested','returned')`
  ).get(req.user.id, id) ? 1 : 0;

  try {
    db.tx((d) => {
      d.prepare('INSERT INTO reviews (product_id, user_id, rating, title, body, verified, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, req.user.id, rating, title, body, verified, Date.now());
      const p = d.prepare('SELECT rating_avg, rating_count FROM products WHERE id = ?').get(id);
      const count = p.rating_count + 1;
      const avg = Math.round(((p.rating_avg * p.rating_count + rating) / count) * 10) / 10;
      d.prepare('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?').run(avg, count, id);
    });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new HttpError(409, 'You have already reviewed this product.');
    throw err;
  }
  audit(req, 'review.create', { productId: id });
  res.status(201).json({ ok: true, verified: !!verified });
});

module.exports = router;
