'use strict';
const db = require('./db');
const market = require('./market');
const { readImage } = require('./uploads');
const { HttpError, v } = require('./security');

/**
 * Catalog and trust rules (blueprint stage 2): the details every listing must have, automatic quality checks,
 * and matching new listings to products already on Bazaario, so sellers add an offer instead of a second page.
 */

/** Product details shared by Studio and Seller Hub. Money is entered in rupees and stored in paise. */
function readDetails(body) {
  const mrp = v.int(body.mrp, 'MRP (₹)', { min: 1, max: 10_000_000 });
  const categoryId = v.int(body.categoryId, 'Category', { min: 1 });
  const cat = db.get().prepare('SELECT id, slug FROM categories WHERE id = ?').get(categoryId);
  if (!cat) throw new HttpError(400, 'Unknown category.');
  const def = market.CATEGORY_DEFAULTS[cat.slug] || { hsn: '', gst: 18 };
  const features = Array.isArray(body.features) ? body.features : String(body.features || '').split('\n');
  const brand = v.str(body.brand, 'Brand', { min: 1, max: 60 });
  const gst = body.gstRate === undefined || body.gstRate === '' ? def.gst : Number(body.gstRate);
  if (!market.GST_RATES.includes(gst)) throw new HttpError(400, `GST rate must be one of ${market.GST_RATES.join(', ')}%.`);
  const specs = {};
  if (body.specs && typeof body.specs === 'object' && !Array.isArray(body.specs)) {
    for (const [k, val] of Object.entries(body.specs).slice(0, 12)) {
      const key = String(k).trim().slice(0, 40);
      const value = String(val ?? '').trim().slice(0, 120);
      if (key && value) specs[key] = value;
    }
  }
  return {
    title: v.str(body.title, 'Title', { min: 3, max: 200 }),
    brand,
    category_id: categoryId,
    category: cat.slug,
    description: v.str(body.description, 'Description', { max: 4000, optional: true }),
    features: JSON.stringify(features.map((f) => String(f).trim()).filter(Boolean).slice(0, 15).map((f) => f.slice(0, 200))),
    mrp: mrp * 100,
    image: readImage(body.image),
    hsn: v.str(body.hsn, 'HSN code', { min: 4, max: 8, pattern: /^\d{4}(\d{2}){0,2}$/, optional: true }) || def.hsn,
    gst_rate: gst,
    origin: v.str(body.origin, 'Country of origin', { min: 2, max: 60, optional: true }) || 'India',
    manufacturer: v.str(body.manufacturer, 'Manufacturer', { min: 2, max: 200, optional: true }) || brand,
    specs: JSON.stringify(specs),
  };
}

const BANNED = /\b(best price|lowest price|cheapest|100% original|guaranteed|free gift|no\.? ?1|number one)\b/i;
const CONTACT = /(\b[6-9]\d{9}\b|[^\s@]+@[^\s@]+\.[a-z]{2,}|https?:\/\/|www\.)/i;

/** Automatic checks on a seller's new listing. Returns the problems to fix (empty when it passes). */
function autoCheck(details) {
  const problems = [];
  const t = details.title;
  if (t.length < 10 || t.length > 150) problems.push('Title must be 10 to 150 characters.');
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length > 10 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) problems.push('Title must not be in capital letters.');
  if (BANNED.test(t)) problems.push('Title must describe the product, without claims like "best price" or "100% original".');
  const text = [t, details.description, ...JSON.parse(details.features)].join(' ');
  if (CONTACT.test(text)) problems.push('Remove phone numbers, email addresses and website links from the listing.');
  if (!details.image) problems.push('Add a product photo.');
  if (details.description.length < 30) problems.push('Description must be at least 30 characters.');
  if (!details.hsn) problems.push('Add the HSN code.');
  const specs = JSON.parse(details.specs);
  const missing = (market.CATEGORY_SPECS[details.category] || []).filter((k) => !specs[k]);
  if (missing.length) problems.push(`Fill in: ${missing.join(', ')}.`);
  return problems;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'in', 'a', 'an', 'to', 'by', 'pack', 'set', 'pcs']);
const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));

/** Products already on Bazaario that look like the same item: same brand and category, and mostly the same title words. */
function findDuplicates(d, { title, brand, category_id }, exceptId = 0) {
  const mine = tokens(title);
  return d.prepare(`SELECT id, title, brand, price, image, emoji, color FROM products
      WHERE brand = ? COLLATE NOCASE AND category_id = ? AND id != ? AND qc_status != 'rejected'`).all(brand, category_id, exceptId)
    .filter((p) => {
      const theirs = tokens(p.title);
      const common = [...mine].filter((w) => theirs.has(w)).length;
      return common / Math.max(1, new Set([...mine, ...theirs]).size) >= 0.6;
    }).slice(0, 5);
}

module.exports = { readDetails, autoCheck, findDuplicates };
