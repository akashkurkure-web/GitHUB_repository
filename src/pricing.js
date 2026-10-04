'use strict';
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./security');
const delivery = require('./delivery');
const wallet = require('./wallet');

/** Server-side source of truth for cart totals. Client-sent prices are never trusted. */
function cartLines(userId) {
  return db.get().prepare(
    `SELECT c.product_id, c.qty, p.title, p.price, p.mrp, p.stock, p.emoji, p.color, p.image, p.active, p.express
       FROM cart_items c JOIN products p ON p.id = c.product_id
      WHERE c.user_id = ? AND c.saved_for_later = 0 ORDER BY c.added_at DESC`
  ).all(userId);
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
  const lines = cartLines(userId);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const mrpTotal = lines.reduce((s, l) => s + l.mrp * l.qty, 0);
  const { discount, coupon } = couponDiscount(couponCode, subtotal);
  const shipping = subtotal === 0 || subtotal >= config.freeShippingThreshold ? 0 : config.shippingFee;
  const promise = opts.pincode ? delivery.options(opts.pincode, lines) : null;
  const speeds = promise ? promise.options : [];
  const chosen = speeds.find((o) => o.speed === opts.speed) || speeds.find((o) => o.speed === 'standard') || null;
  const speed = chosen ? chosen.speed : 'standard';
  const expressFee = speed === 'express' ? config.expressFee : 0;
  const codFee = paymentMethod === 'cod' ? config.codFee : 0;
  const total = subtotal - discount + shipping + expressFee + codFee;
  const walletBalance = wallet.balance(userId);
  const walletApplied = opts.useWallet ? Math.min(walletBalance, total) : 0;
  const payable = total - walletApplied;
  return {
    lines, subtotal, mrpTotal, savings: mrpTotal - subtotal + discount, discount, coupon, shipping, expressFee, codFee, total,
    walletBalance, walletApplied, payable,
    speed, promisedAt: chosen ? chosen.promisedAt : null, speeds,
    cod: codCheck(userId, opts.pincode, payable),
    emi: { ok: payable >= config.emiMinOrder, minOrder: config.emiMinOrder, months: config.emiMonths },
  };
}

module.exports = { cartLines, quote, couponDiscount, codCheck };
