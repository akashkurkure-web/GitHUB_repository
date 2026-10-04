'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const geo = require('./geo');

/**
 * Bazaario Express (blueprint stages 1, 6, 7a and 8): partner shops that deliver to their neighbourhood in minutes,
 * Bazaario city stores, and the riders who carry the orders.
 *
 * A partner shop is a seller in the 'shop' lane with a location, a delivery radius (2 to 5 km) and opening hours.
 * Its offers are not part of the national "best offer"; they show up as "Express near you" when the buyer's PIN code
 * is inside the shop's radius while it is open.
 * The rider for an Express order is chosen when the order is packed: the nearest free rider in the city, counting
 * each order a rider already carries as extra distance. In test mode riders move along the route on their own.
 */
const X = config.express;
const MIN = 60_000;
const IST = 330 * MIN;

const istHour = (ts) => { const t = new Date(ts + IST); return t.getUTCHours() + t.getUTCMinutes() / 60; };
const hourText = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

/** Minutes a rider takes for `km` of straight-line distance. */
const travelMins = (km) => Math.max(3, Math.round(((km * X.roadFactor) / X.riderSpeedKmh) * 60));

function shopPoint(shop) {
  return shop.lat !== null && shop.lat !== undefined ? { lat: shop.lat, lng: shop.lng } : null;
}

/** Is the shop taking Express orders at `now`? Returns { open, reason }. */
function shopOpen(shop, now = Date.now()) {
  if (shop.status !== 'approved') return { open: false, reason: 'This shop is not taking orders.' };
  if (!shop.accepting) return { open: false, reason: `${shop.display_name || shop.seller_name} is not taking orders right now.` };
  const hour = istHour(now);
  if (hour < shop.open_hour || hour >= shop.close_hour) {
    return { open: false, reason: `${shop.display_name || shop.seller_name} is closed now. It opens at ${hourText(shop.open_hour)}.` };
  }
  return { open: true, reason: '' };
}

/** How a shop would serve a buyer at `point`: distance, minutes to the door and why not, if it cannot. */
function shopServes(shop, point, now = Date.now()) {
  const from = shopPoint(shop);
  if (!from || !point) return { ok: false, reason: 'Express from partner shops is available in Express cities only.' };
  const km = geo.distanceKm(from, point);
  if (km > shop.radius_km) {
    return { ok: false, km, reason: `${shop.display_name || shop.seller_name} delivers within ${shop.radius_km} km of the shop.` };
  }
  const o = shopOpen(shop, now);
  const mins = X.prepMins + travelMins(km) + X.handoverMins;
  return { ok: o.open, km, mins, promisedAt: now + mins * MIN, reason: o.reason };
}

/** Partner shop offers for a product that can reach `point`, nearest first. Closed shops are listed with their reason. */
function nearbyOffers(d, productId, point, now = Date.now()) {
  if (!point) return [];
  const rows = d.prepare(`SELECT o.*, s.display_name AS seller_name, s.status, s.lat, s.lng, s.radius_km, s.open_hour, s.close_hour,
      s.accepting, s.lane, s.pickup_city, s.score FROM offers o JOIN sellers s ON s.id = o.seller_id
     WHERE o.product_id = ? AND s.lane = 'shop' AND o.active = 1 AND o.stock > 0 AND s.status = 'approved'`).all(productId);
  return rows.map((o) => ({ offer: o, ...shopServes(o, point, now) }))
    .filter((r) => r.km !== undefined && r.km <= r.offer.radius_km)
    .sort((a, b) => (b.ok - a.ok) || a.mins - b.mins || a.offer.price - b.offer.price);
}

/** Where an Express order starts: the partner shop, or the Bazaario city store (a small dark store in the city centre). */
function origin(d, order) {
  const s = d.prepare('SELECT * FROM sellers WHERE id = ?').get(order.seller_id);
  if (s && s.lane === 'shop' && shopPoint(s)) return { name: s.display_name, ...shopPoint(s) };
  const a = JSON.parse(order.address);
  const c = geo.cityCentre(a.pincode);
  return c ? { name: `Bazaario city store, ${c.city}`, lat: c.lat, lng: c.lng } : null;
}

const riderFee = (km) => X.riderFeeBase + Math.round(km * X.riderFeePerKm);

const ACTIVE = "status IN ('packed','shipped','out_for_delivery')";

function riderLoad(d, riderId) {
  return d.prepare(`SELECT COUNT(*) AS n FROM orders WHERE rider_id = ? AND delivered_at IS NULL AND ${ACTIVE}`).get(riderId).n;
}

/**
 * Picks a rider for a packed Express order: the nearest active rider in the city with room for one more order;
 * each order already carried counts as 1.5 km. Returns the rider, or null when everyone is busy (tried again later).
 */
function dispatch(d, orderId, now = Date.now()) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o || o.delivery_speed !== 'express' || o.rider_id) return null;
  const from = origin(d, o);
  const to = geo.locate(JSON.parse(o.address).pincode);
  if (!from || !to) return null;
  const city = geo.cityCentre(JSON.parse(o.address).pincode).city;
  const riders = d.prepare('SELECT * FROM riders WHERE active = 1 AND city = ?').all(city)
    .map((r) => ({ r, load: riderLoad(d, r.id), km: geo.distanceKm(r, from) }))
    .filter((x) => x.load < X.riderMaxLoad)
    .sort((a, b) => (a.km + a.load * 1.5) - (b.km + b.load * 1.5));
  if (!riders.length) return null;
  const { r, km } = riders[0];
  const tripKm = geo.distanceKm(from, to);
  const etaPickup = now + travelMins(km) * MIN;
  const etaDrop = etaPickup + (X.handoverMins + travelMins(tripKm)) * MIN;
  const route = { start: { lat: r.lat, lng: r.lng }, shop: from, home: { lat: to.lat, lng: to.lng }, km: Math.round(tripKm * 10) / 10 };
  d.prepare(`UPDATE orders SET rider_id = ?, rider_assigned_at = ?, eta_pickup = ?, eta_drop = ?, route = ?, rider_fee = ?, promised_at = MAX(COALESCE(promised_at, 0), ?), updated_at = ?
    WHERE id = ?`).run(r.id, now, etaPickup, etaDrop, JSON.stringify(route), riderFee(tripKm), etaDrop, now, orderId);
  require('./fulfilment').event(d, orderId, 'rider_assigned', `${r.name} is on the way to ${from.name}`);
  return r;
}

/** Where the rider is at `now`, worked out from the route and the expected times. */
function position(o, now = Date.now()) {
  if (!o.route || !o.rider_id) return null;
  const route = JSON.parse(o.route);
  if (o.delivered_at) return { phase: 'delivered', at: route.home, progress: 1 };
  const picked = o.rider_picked_at;
  if (!picked) {
    const t = Math.min(1, Math.max(0, (now - o.rider_assigned_at) / Math.max(1, o.eta_pickup - o.rider_assigned_at)));
    return { phase: t >= 1 ? 'at_pickup' : 'to_pickup', at: geo.between(route.start, route.shop, t), progress: t };
  }
  const t = Math.min(1, Math.max(0, (now - picked) / Math.max(1, o.eta_drop - picked)));
  return { phase: t >= 1 ? 'arriving' : 'to_drop', at: geo.between(route.shop, route.home, t), progress: t };
}

/** The rider collected the parcel: the order is out for delivery and the drop time is set from now. */
function pickedUp(d, orderId, now = Date.now()) {
  const { move } = require('./fulfilment');
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const route = JSON.parse(o.route);
  const etaDrop = now + (X.handoverMins + travelMins(route.km)) * MIN;
  d.prepare('UPDATE orders SET rider_picked_at = ?, eta_drop = ? WHERE id = ?').run(now, etaDrop, orderId);
  const rider = d.prepare('SELECT name FROM riders WHERE id = ?').get(o.rider_id);
  if (o.status === 'packed') move(d, orderId, 'shipped', { actor: 'system', courier: `Bazaario Express rider ${rider.name}`, awb: `EXP${crypto.randomInt(1e7, 1e8)}` });
  move(d, orderId, 'out_for_delivery', { actor: 'system', note: `${rider.name} is bringing your order` });
}

/** The rider handed over the parcel. The rider ends up at the buyer's door. */
function delivered(d, orderId, now = Date.now()) {
  const { move } = require('./fulfilment');
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  move(d, orderId, 'delivered', { actor: 'system', note: 'Handed over by the Express rider' });
  const home = JSON.parse(o.route).home;
  d.prepare('UPDATE riders SET lat = ?, lng = ? WHERE id = ?').run(home.lat, home.lng, o.rider_id);
  return now;
}

/**
 * Keeps Express moving. Packed orders without a rider get one; in test mode riders pick up and deliver
 * when their expected times arrive. Runs every few seconds on the server and before Express screens load.
 */
function tick(db, now = Date.now()) {
  const d = db.get();
  const waiting = d.prepare("SELECT id FROM orders WHERE delivery_speed = 'express' AND status = 'packed' AND rider_id IS NULL").all();
  for (const o of waiting) db.tx((t) => dispatch(t, o.id, now));
  if (!X.simulateRiders) return;
  const toPick = d.prepare("SELECT id FROM orders WHERE rider_id IS NOT NULL AND status = 'packed' AND rider_picked_at IS NULL AND eta_pickup <= ?").all(now);
  for (const o of toPick) db.tx((t) => pickedUp(t, o.id, now));
  const toDrop = d.prepare("SELECT id FROM orders WHERE rider_id IS NOT NULL AND status = 'out_for_delivery' AND rider_picked_at IS NOT NULL AND eta_drop <= ?").all(now);
  for (const o of toDrop) db.tx((t) => delivered(t, o.id, now));
}

module.exports = {
  shopOpen, shopServes, nearbyOffers, origin, dispatch, position, pickedUp, delivered, tick, travelMins, riderFee, riderLoad, hourText, shopPoint,
};
