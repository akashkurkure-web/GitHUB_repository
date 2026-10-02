'use strict';
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./security');

/** Server-side source of truth for cart totals. Client-sent prices are never trusted. */
function cartLines(userId) {
  return db.get().prepare(
    `SELECT c.product_id, c.qty, p.title, p.price, p.mrp, p.stock, p.emoji, p.color, p.active, p.express
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

function quote(userId, couponCode, paymentMethod) {
  const lines = cartLines(userId);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const mrpTotal = lines.reduce((s, l) => s + l.mrp * l.qty, 0);
  const { discount, coupon } = couponDiscount(couponCode, subtotal);
  const shipping = subtotal === 0 || subtotal >= config.freeShippingThreshold ? 0 : config.shippingFee;
  const codFee = paymentMethod === 'cod' ? config.codFee : 0;
  const total = subtotal - discount + shipping + codFee;
  return { lines, subtotal, mrpTotal, savings: mrpTotal - subtotal + discount, discount, coupon, shipping, codFee, total };
}

module.exports = { cartLines, quote, couponDiscount };
