'use strict';
const config = require('./config');

/**
 * Marketplace rules (blueprint stages 1, 2 and 4): sellers, offers, the best offer on each product page,
 * the Assured badge and the seller performance score.
 *
 * Every product has one page and any number of offers. The best offer (the "buy box") is cached on the product
 * row (price, stock, seller, assured), so search, sorting and the product grid keep working on products alone.
 * Call syncProduct() whenever an offer, its seller or the seller's score changes.
 */

const DIRECT = 'direct';
const M = config.market;

// Defaults for the mandatory details, by category. Starting values only: sellers and Studio can change them.
const CATEGORY_DEFAULTS = {
  mobiles: { hsn: '8517', gst: 18 }, electronics: { hsn: '8518', gst: 18 }, fashion: { hsn: '6205', gst: 5 },
  'home-kitchen': { hsn: '7323', gst: 18 }, books: { hsn: '4901', gst: 0 }, beauty: { hsn: '3304', gst: 18 },
  sports: { hsn: '9506', gst: 18 }, toys: { hsn: '9503', gst: 18 }, grocery: { hsn: '1006', gst: 5 }, appliances: { hsn: '8509', gst: 18 },
};
const GST_RATES = [0, 3, 5, 12, 18, 28, 40];

// Details every listing in a category must fill in (blueprint stage 2, category attributes).
const CATEGORY_SPECS = {
  mobiles: ['Model number', 'RAM', 'Storage', 'Warranty'],
  electronics: ['Model number', 'Warranty'],
  fashion: ['Fabric', 'Sizes available', 'Wash care'],
  'home-kitchen': ['Material', 'Dimensions'],
  books: ['Author', 'Language', 'Pages'],
  beauty: ['Net quantity', 'Skin or hair type'],
  sports: ['Material', 'Suitable for'],
  toys: ['Suitable age', 'Material'],
  grocery: ['Net quantity', 'Shelf life', 'FSSAI licence number'],
  appliances: ['Model number', 'Power', 'Warranty'],
};

function direct(d) {
  let s = d.prepare('SELECT * FROM sellers WHERE code = ?').get(DIRECT);
  if (!s) {
    const now = Date.now();
    d.prepare(`INSERT INTO sellers (code, lane, display_name, legal_name, gstin, pickup_state, fulfilment, status, created_at, approved_at, updated_at)
      VALUES (?, 'direct', 'Bazaario Direct', ?, ?, ?, 'fulfilled', 'approved', ?, ?, ?)`)
      .run(DIRECT, config.companyName, config.companyGstin || null, config.companyState, now, now, now);
    s = d.prepare('SELECT * FROM sellers WHERE code = ?').get(DIRECT);
  }
  return s;
}

const isAuthenticCategory = (slug) => M.authenticCategories.includes(slug);

/** Can this seller list in this category? Beauty, electronics and mobiles are for brands and Bazaario Direct only. */
function mayList(seller, categorySlug) {
  if (!isAuthenticCategory(categorySlug)) return true;
  return seller.lane === 'direct' || seller.lane === 'brand';
}

function isAssured(offer, seller) {
  if (seller.lane === 'direct') return true;
  return seller.score !== null && seller.score !== undefined && seller.score >= 85 && offer.dispatch_days <= 1 && seller.fulfilment !== 'self';
}

/** Value sellers registered with a GST enrolment ID may only sell within their own state. */
function deliverable(offer, state) {
  return offer.lane !== 'value' || !state || offer.pickup_state === state;
}

/** Extra days on top of the courier's time for this offer: the seller's dispatch time, and economy shipping for Value. */
function extraDays(offer) {
  return Math.max(0, offer.dispatch_days - 1) + (offer.lane === 'value' ? M.valueExtraDays : 0);
}

/**
 * Best offer first. The rank weighs price, speed and seller quality:
 * each extra day of dispatch counts as 1% on price, Value shipping as 2%, Assured as 2% off,
 * and a seller with a score under 60 as 5% on price. Ties go to the higher score, then the older offer.
 */
function rankOffers(offers) {
  const eff = (o) => o.price * (1 + 0.01 * Math.max(0, o.dispatch_days - 1) + (o.lane === 'value' ? 0.02 : 0))
    * (isAssured(o, o) ? 0.98 : 1) * (o.score !== null && o.score < 60 ? 1.05 : 1);
  return offers.filter((o) => o.active && o.status === 'approved' && o.stock > 0)
    .sort((a, b) => eff(a) - eff(b) || (b.score ?? 70) - (a.score ?? 70) || a.id - b.id);
}

const OFFER_SQL = `SELECT o.*, s.code AS seller_code, s.lane, s.display_name AS seller_name, s.status, s.score, s.fulfilment,
  s.pickup_state, s.pickup_city FROM offers o JOIN sellers s ON s.id = o.seller_id`;

function offersFor(d, productId) {
  return d.prepare(`${OFFER_SQL} WHERE o.product_id = ?`).all(productId);
}

function offerById(d, offerId) {
  return d.prepare(`${OFFER_SQL} WHERE o.id = ?`).get(offerId);
}

/** Recomputes the best offer of a product and caches it on the product row. */
function syncProduct(d, productId) {
  const ranked = rankOffers(offersFor(d, productId));
  const best = ranked[0];
  if (best) {
    d.prepare('UPDATE products SET best_offer_id = ?, seller_id = ?, price = ?, stock = ?, assured = ?, offer_count = ? WHERE id = ?')
      .run(best.id, best.seller_id, best.price, best.stock, isAssured(best, best) ? 1 : 0, ranked.length, productId);
  } else {
    d.prepare('UPDATE products SET best_offer_id = NULL, seller_id = NULL, stock = 0, assured = 0, offer_count = 0 WHERE id = ?').run(productId);
  }
  return best || null;
}

function syncSellerProducts(d, sellerId) {
  for (const r of d.prepare('SELECT DISTINCT product_id FROM offers WHERE seller_id = ?').all(sellerId)) syncProduct(d, r.product_id);
}

/** Changes an offer's stock by `delta` (negative to sell). Returns false when there is not enough stock. */
function moveStock(d, offerId, delta) {
  const r = delta < 0
    ? d.prepare('UPDATE offers SET stock = stock + ?, updated_at = ? WHERE id = ? AND stock >= ?').run(delta, Date.now(), offerId, -delta)
    : d.prepare('UPDATE offers SET stock = stock + ?, updated_at = ? WHERE id = ?').run(delta, Date.now(), offerId);
  return r.changes === 1;
}

// Return reasons that count against the seller.
const SELLER_FAULT_REASONS = ['Item is damaged or defective', 'Received a different item', 'Quality is not as expected', 'Item is missing parts'];

/**
 * Seller performance over the last 90 days (blueprint stage 1). It decides the Assured badge and the best offer.
 * score = 100 - 150 x cancellation rate - 100 x late dispatch rate - 100 x seller-fault return rate.
 * A seller needs 5 decided orders before a score is given.
 */
function computeScore(d, sellerId, now = Date.now()) {
  const since = now - 90 * 86400_000;
  const routes = d.prepare(`SELECT outcome, COUNT(*) AS n FROM order_routes WHERE seller_id = ? AND created_at >= ? AND outcome != 'waiting'
    GROUP BY outcome`).all(sellerId, since);
  const count = (k) => (routes.find((r) => r.outcome === k) || { n: 0 }).n;
  const decided = routes.reduce((s, r) => s + r.n, 0);
  const faults = count('rejected') + count('expired') + count('seller_cancelled');
  const ship = d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(shipped_at > dispatch_by), 0) AS late FROM orders WHERE seller_id = ? AND shipped_at >= ?')
    .get(sellerId, since);
  const delivered = d.prepare(`SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND delivered_at >= ?`).get(sellerId, since).n;
  const returns = d.prepare(`SELECT COUNT(*) AS n FROM returns r JOIN orders o ON o.id = r.order_id
    WHERE o.seller_id = ? AND r.created_at >= ? AND r.reason IN (${SELLER_FAULT_REASONS.map(() => '?').join(',')})`)
    .get(sellerId, since, ...SELLER_FAULT_REASONS).n;
  const cancelRate = decided ? faults / decided : 0;
  const lateRate = ship.n ? ship.late / ship.n : 0;
  const returnRate = delivered ? returns / delivered : 0;
  const score = decided < 5 ? null : Math.max(0, Math.min(100, Math.round(100 - 150 * cancelRate - 100 * lateRate - 100 * returnRate)));
  return { score, decided, cancelRate, lateRate, returnRate, shipped: ship.n, delivered, returns };
}

/** Recomputes a seller's score; when it changes, their offers are re-ranked. */
function refreshScore(d, sellerId) {
  const s = d.prepare('SELECT score, lane FROM sellers WHERE id = ?').get(sellerId);
  if (!s || s.lane === 'direct') return;
  const { score } = computeScore(d, sellerId);
  if (score !== s.score) {
    d.prepare('UPDATE sellers SET score = ?, updated_at = ? WHERE id = ?').run(score, Date.now(), sellerId);
    syncSellerProducts(d, sellerId);
  }
}

function commissionPct(lane, categorySlug) {
  if (lane === 'value' || lane === 'direct') return 0;
  return M.commission[categorySlug] ?? M.defaultCommission;
}

/**
 * Upgrades a store to the marketplace: Bazaario Direct exists, every product without an offer gets a Direct offer
 * from its old price and stock, old orders belong to Direct, and every product's best offer is cached.
 */
function backfill(d) {
  const dir = direct(d);
  const now = Date.now();
  d.prepare(`INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, active, created_at, updated_at)
    SELECT p.id, ?, p.price, p.stock, 1, 1, p.created_at, ? FROM products p
     WHERE p.created_by_seller IS NULL AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id)`).run(dir.id, now);
  for (const p of d.prepare(`SELECT p.id, p.brand, c.slug FROM products p JOIN categories c ON c.id = p.category_id WHERE p.hsn = ''`).all()) {
    const def = CATEGORY_DEFAULTS[p.slug] || { hsn: '', gst: 18 };
    d.prepare("UPDATE products SET hsn = ?, gst_rate = ?, manufacturer = CASE WHEN manufacturer = '' THEN ? ELSE manufacturer END WHERE id = ?")
      .run(def.hsn, def.gst, p.brand, p.id);
  }
  d.prepare('UPDATE orders SET seller_id = ? WHERE seller_id IS NULL').run(dir.id);
  d.prepare(`UPDATE order_items SET offer_id = (SELECT o.id FROM offers o WHERE o.product_id = order_items.product_id AND o.seller_id = ?)
    WHERE offer_id IS NULL`).run(dir.id);
  for (const p of d.prepare('SELECT id FROM products WHERE best_offer_id IS NULL').all()) syncProduct(d, p.id);
}

/** What a buyer may see about a seller (Consumer Protection (E-Commerce) Rules 2020, rule 6: seller details). */
function publicSeller(s) {
  return {
    id: s.id, name: s.display_name, lane: s.lane, legalName: s.legal_name, gstin: s.gstin || null,
    city: s.pickup_city || null, state: s.pickup_state, score: s.score, since: s.approved_at || s.created_at,
  };
}

module.exports = {
  DIRECT, CATEGORY_DEFAULTS, CATEGORY_SPECS, GST_RATES, SELLER_FAULT_REASONS,
  direct, mayList, isAuthenticCategory, isAssured, deliverable, extraDays, rankOffers, offersFor, offerById,
  syncProduct, syncSellerProducts, moveStock, computeScore, refreshScore, commissionPct, backfill, publicSeller,
};
