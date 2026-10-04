'use strict';
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./security');
const delivery = require('./delivery');
const wallet = require('./wallet');
const market = require('./market');

/**
 * Server-side source of truth for the bag. Client-sent prices are never trusted.
 * Each line is bought from one offer: the one the buyer picked under "Other sellers", or else the best offer that can
 * deliver to `state` (Value sellers sell only within their own state).
 */
function cartLines(userId, { state = null } = {}) {
  const d = db.get();
  const rows = d.prepare(
    `SELECT c.product_id, c.qty, c.offer_id AS chosen_offer_id, p.title, p.price AS list_price, p.mrp, p.emoji, p.color, p.image,
            p.active, p.express, p.hsn, p.gst_rate, cat.slug AS category
       FROM cart_items c JOIN products p ON p.id = c.product_id JOIN categories cat ON cat.id = p.category_id
      WHERE c.user_id = ? AND c.saved_for_later = 0 ORDER BY c.added_at DESC`
  ).all(userId);
  return rows.map((r) => {
    const offers = market.offersFor(d, r.product_id);
    const usable = (o) => o && o.active && o.status === 'approved';
    let offer = null;
    let note = '';
    if (r.chosen_offer_id) {
      offer = offers.find((o) => o.id === r.chosen_offer_id);
      if (!usable(offer)) { offer = null; note = 'The seller you chose has stopped selling this item, so the next best offer is shown.'; }
    }
    if (!offer) {
      const ranked = market.rankOffers(offers);
      offer = ranked.find((o) => market.deliverable(o, state)) || ranked[0] || null;
    }
    const blocked = offer && !market.deliverable(offer, state) ? `${offer.seller_name} delivers only within ${offer.pickup_state}.` : '';
    return {
      product_id: r.product_id, qty: r.qty, title: r.title, mrp: r.mrp, emoji: r.emoji, color: r.color, image: r.image,
      category: r.category, hsn: r.hsn, gst_rate: r.gst_rate,
      active: r.active && !!offer ? 1 : 0,
      price: offer ? offer.price : r.list_price,
      stock: offer ? offer.stock : 0,
      offer_id: offer ? offer.id : null,
      seller_id: offer ? offer.seller_id : null,
      seller_name: offer ? offer.seller_name : '',
      lane: offer ? offer.lane : null,
      pickup_state: offer ? offer.pickup_state : null,
      dispatch_days: offer ? offer.dispatch_days : 1,
      assured: offer && market.isAssured(offer, offer) ? 1 : 0,
      // Express comes from Bazaario's own stock in city stores (partner shops join in Phase C).
      express: offer && offer.lane === 'direct' ? r.express : 0,
      chosen: !!r.chosen_offer_id,
      blocked, note,
    };
  });
}

/** Lines grouped by seller: each group ships as its own package and becomes its own order. */
function packagesOf(lines) {
  const map = new Map();
  for (const l of lines) {
    const key = l.seller_id || 0;
    if (!map.has(key)) map.set(key, { sellerId: l.seller_id, sellerName: l.seller_name, lane: l.lane, lines: [], extraDays: 0 });
    const p = map.get(key);
    p.lines.push(l);
    p.extraDays = Math.max(p.extraDays, market.extraDays(l));
  }
  return [...map.values()];
}

function couponDiscount(code, subtotal) {
  if (!code) return { discount: 0, coupon: null };
  const c = db.get().prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(String(code).trim());
  if (!c) throw new HttpError(400, 'This coupon code is not valid.');
  if (subtotal < c.min_order) {
    throw new HttpError(400, `Add items worth ₹${((c.min_order - subtotal) / 100).toFixed(2)} more to use ${c.code}.`);
  }
  let discount = c.kind === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
  if (c.max_discount) discount = Math.min(discount, c.max_discount);
  return { discount: Math.min(discount, subtotal), coupon: c.code.toUpperCase() };
}

/**
 * Cash on Delivery check (blueprint stage 5): not on the islands, not above the COD limit, and paused for buyers
 * whose earlier COD deliveries were refused.
 */
function codCheck(userId, pincode, payable) {
  if (pincode && !delivery.zoneOf(pincode).cod) return { ok: false, reason: 'Cash on Delivery is not available for this PIN code.' };
  if (payable > config.codMaxOrder) return { ok: false, reason: `Cash on Delivery is available for orders up to ₹${(config.codMaxOrder / 100).toLocaleString('en-IN')}.` };
  const refused = db.get().prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'rto' AND payment_method = 'cod'").get(userId).n;
  if (refused >= config.codMaxRefusals) return { ok: false, reason: 'Cash on Delivery is paused on your account because earlier deliveries were refused. Please pay online.' };
  return { ok: true, reason: '' };
}

/**
 * Server-side price of the bag. `opts.pincode` decides which delivery speeds exist; `opts.speed` picks one;
 * `opts.useWallet` spends wallet balance first. `payable` is what the chosen payment method must cover.
 */
function quote(userId, couponCode, paymentMethod, opts = {}) {
  const lines = cartLines(userId, { state: opts.state });
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const mrpTotal = lines.reduce((s, l) => s + l.mrp * l.qty, 0);
  const { discount, coupon } = couponDiscount(couponCode, subtotal);
  const shipping = subtotal === 0 || subtotal >= config.freeShippingThreshold ? 0 : config.shippingFee;
  const packages = packagesOf(lines);
  const slowest = packages.reduce((m, p) => Math.max(m, p.extraDays), 0);
  const promise = opts.pincode ? delivery.options(opts.pincode, lines, Date.now(), slowest) : null;
  const speeds = promise ? promise.options : [];
  const chosen = speeds.find((o) => o.speed === opts.speed) || speeds.find((o) => o.speed === 'standard') || null;
  const speed = chosen ? chosen.speed : 'standard';
  if (promise) {
    for (const p of packages) {
      p.promisedAt = speed === 'express' ? chosen.promisedAt : delivery.standardPromise(delivery.zoneOf(opts.pincode).days + p.extraDays);
    }
  }
  const expressFee = speed === 'express' ? config.expressFee : 0;
  const codFee = paymentMethod === 'cod' ? config.codFee : 0;
  const total = subtotal - discount + shipping + expressFee + codFee;
  const walletBalance = wallet.balance(userId);
  const walletApplied = opts.useWallet ? Math.min(walletBalance, total) : 0;
  const payable = total - walletApplied;
  return {
    lines, packages: packages.map((p) => ({ ...p, lines: p.lines.map((l) => l.product_id) })),
    blocked: lines.filter((l) => l.blocked).map((l) => `${l.title}: ${l.blocked}`),
    subtotal, mrpTotal, savings: mrpTotal - subtotal + discount, discount, coupon, shipping, expressFee, codFee, total,
    walletBalance, walletApplied, payable,
    speed, promisedAt: chosen ? chosen.promisedAt : null, speeds,
    cod: codCheck(userId, opts.pincode, payable),
    emi: { ok: payable >= config.emiMinOrder, minOrder: config.emiMinOrder, months: config.emiMonths },
  };
}

module.exports = { cartLines, packagesOf, quote, couponDiscount, codCheck };
