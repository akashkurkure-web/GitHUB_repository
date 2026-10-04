'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const routing = require('../routing');
const settlement = require('../settlement');
const hyper = require('../hyperlocal');
const { HttpError, requireAuth, audit, v } = require('../security');

/**
 * Shop Partner app (blueprint stages 1, 6 and 7a): a neighbourhood shop's day.
 * Open or close the shop, accept each order within 2 minutes, pack it for the rider, and see what the day earned.
 * Listings, stock and order actions (accept, reject, pack) use the Seller Hub endpoints.
 */
const router = express.Router();
router.use(requireAuth);
const X = config.express;
const DAY = 86400_000;
const IST = 330 * 60000;
const dayStart = (ts) => { const t = new Date(ts + IST); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST; };

function requireShop(req, _res, next) {
  const s = db.get().prepare("SELECT * FROM sellers WHERE user_id = ? AND lane = 'shop'").get(req.user.id);
  if (!s) return next(new HttpError(403, 'Please register your shop as a Bazaario partner first.'));
  if (s.status === 'pending') return next(new HttpError(403, 'Your shop application is being checked. We will email you when it is approved.'));
  if (s.status !== 'approved') return next(new HttpError(403, 'Your shop account is not active. Please contact partner support.'));
  req.shop = s;
  next();
}
router.use(requireShop);

function earned(d, shop, orders) {
  return orders.reduce((s, o) => s + settlement.breakdown(d, o, shop).net, 0);
}

function shopView(s, now = Date.now()) {
  const o = hyper.shopOpen(s, now);
  return { id: s.id, name: s.display_name, city: s.pickup_city, pincode: s.pickup_pincode, radiusKm: s.radius_km, openHour: s.open_hour,
    closeHour: s.close_hour, accepting: !!s.accepting, open: o.open, reason: o.reason, hours: `${hyper.hourText(s.open_hour)} to ${hyper.hourText(s.close_hour % 24)}`,
    score: s.score, fssai: s.fssai };
}

router.get('/me', (req, res) => {
  const d = db.get();
  const now = Date.now();
  const today = dayStart(now);
  const delivered = d.prepare("SELECT * FROM orders WHERE seller_id = ? AND status = 'delivered' AND delivered_at >= ?").all(req.shop.id, today);
  const count = (where, ...p) => d.prepare(`SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND ${where}`).get(req.shop.id, ...p).n;
  res.json({
    shop: shopView(req.shop, now),
    today: {
      orders: count('created_at >= ?', today),
      delivered: delivered.length,
      earned: earned(d, req.shop, delivered),
      // Orders that moved to another shop because this one did not accept in time or said no.
      missed: d.prepare("SELECT COUNT(*) AS n FROM order_events WHERE status = 'rerouted' AND created_at >= ? AND note LIKE ?")
        .get(today, `Moved from ${req.shop.display_name} to %`).n,
    },
    lowStock: d.prepare(`SELECT o.id, o.stock, p.title FROM offers o JOIN products p ON p.id = o.product_id
      WHERE o.seller_id = ? AND o.active = 1 AND o.stock <= 3 ORDER BY o.stock, p.title LIMIT 10`).all(req.shop.id),
    rules: { acceptMins: X.shopAcceptMs / 60000, prepMins: X.prepMins, commission: X.shopCommission, payoutDays: X.shopPayoutDays, radius: X.shopRadiusKm },
  });
});

router.patch('/settings', (req, res) => {
  const s = req.shop;
  const R = X.shopRadiusKm;
  const accepting = req.body.accepting === undefined ? s.accepting : (req.body.accepting ? 1 : 0);
  const radius = req.body.radiusKm === undefined ? s.radius_km : v.int(req.body.radiusKm, 'Delivery radius (km)', { min: R.min, max: R.max });
  const open = req.body.openHour === undefined ? s.open_hour : v.int(req.body.openHour, 'Opening time', { min: 0, max: 23 });
  const close = req.body.closeHour === undefined ? s.close_hour : v.int(req.body.closeHour, 'Closing time', { min: 1, max: 24 });
  if (close <= open) throw new HttpError(400, 'Closing time must be after opening time.');
  db.get().prepare('UPDATE sellers SET accepting = ?, radius_km = ?, open_hour = ?, close_hour = ?, updated_at = ? WHERE id = ?')
    .run(accepting, radius, open, close, Date.now(), s.id);
  audit(req, 'shop.settings', { sellerId: s.id, accepting, radius, open, close });
  res.json({ shop: shopView(db.get().prepare('SELECT * FROM sellers WHERE id = ?').get(s.id)) });
});

const BUCKETS = {
  waiting: "o.status = 'placed' AND o.hold_reason IS NULL",
  preparing: "o.status = 'confirmed'",
  rider: "o.status IN ('packed','shipped','out_for_delivery')",
  done: "o.status IN ('delivered','cancelled','returned','return_requested') AND o.updated_at >= ?",
};

router.get('/orders', (req, res) => {
  // Expired accept windows move on, and riders move along, before the shop sees its list.
  routing.sweep();
  hyper.tick(db);
  const d = db.get();
  const now = Date.now();
  const items = d.prepare(`SELECT i.title, i.qty, i.price - i.reseller_margin AS price, p.emoji, p.color, COALESCE(p.image, '') AS image
    FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ?`);
  const rider = d.prepare('SELECT name, phone FROM riders WHERE id = ?');
  const out = {};
  for (const [key, where] of Object.entries(BUCKETS)) {
    out[key] = d.prepare(`SELECT o.id, o.order_no, o.status, o.subtotal, o.accept_by, o.dispatch_by, o.address, o.created_at, o.delivered_at,
        o.rider_id, o.eta_pickup, o.eta_drop, o.rider_picked_at, o.route FROM orders o WHERE o.seller_id = ? AND ${where}
       ORDER BY o.created_at ${key === 'done' ? 'DESC' : 'ASC'} LIMIT 50`).all(req.shop.id, ...(key === 'done' ? [dayStart(now)] : [])).map((o) => {
      const a = JSON.parse(o.address);
      const r = o.rider_id ? rider.get(o.rider_id) : null;
      const km = o.route ? JSON.parse(o.route).km : null;
      return { id: o.id, orderNo: o.order_no, status: o.status, acceptBy: o.accept_by, readyBy: o.dispatch_by, createdAt: o.created_at,
        deliveredAt: o.delivered_at, area: `${a.city} ${a.pincode}`, name: o.status === 'placed' ? null : a.fullName.split(' ')[0],
        items: items.all(o.id), value: items.all(o.id).reduce((s, i) => s + i.price * i.qty, 0),
        rider: r ? { name: r.name, phone: r.phone, etaPickup: o.eta_pickup, etaDrop: o.eta_drop, pickedAt: o.rider_picked_at, km } : null };
    });
  }
  res.json({ ...out, now, acceptMins: X.shopAcceptMs / 60000 });
});

router.get('/earnings', (req, res) => {
  const d = db.get();
  const now = Date.now();
  const from = dayStart(now) - 13 * DAY;
  const delivered = d.prepare("SELECT * FROM orders WHERE seller_id = ? AND status IN ('delivered','return_requested','returned') AND delivered_at >= ? ORDER BY delivered_at")
    .all(req.shop.id, from);
  const days = [];
  for (let t = from; t <= now; t += DAY) {
    const mine = delivered.filter((o) => o.delivered_at >= t && o.delivered_at < t + DAY && o.status !== 'returned');
    const b = mine.map((o) => settlement.breakdown(d, o, req.shop));
    days.push({ day: t, orders: mine.length, sales: b.reduce((s, x) => s + x.gross, 0), commission: b.reduce((s, x) => s + x.commission + x.gstOnFees, 0),
      net: b.reduce((s, x) => s + x.net, 0) });
  }
  const payouts = d.prepare('SELECT id, payout_no, net, utr, created_at FROM payouts WHERE seller_id = ? ORDER BY id DESC LIMIT 20').all(req.shop.id);
  res.json({ days, upcoming: settlement.upcoming(d, req.shop.id).net, payouts, payoutDays: X.shopPayoutDays });
});

module.exports = router;
