'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const market = require('../market');
const routing = require('../routing');
const settlement = require('../settlement');
const crypto = require('node:crypto');
const geo = require('../geo');
const hyper = require('../hyperlocal');
const resell = require('../resell');
const notify = require('../notify');
const { invoice, label } = require('../invoice');
const { autoCheck, findDuplicates } = require('../listing');
const { HttpError, requireAdmin, audit, v } = require('../security');

/** Bazaario Studio: seller approvals, catalog quality check, claims and the settlement run (blueprint stages 1, 2, 9, 10). */
const router = express.Router();
router.use(requireAdmin);

function tellSeller(d, s, text) {
  const email = s.email || (s.user_id ? (d.prepare('SELECT email FROM users WHERE id = ?').get(s.user_id) || {}).email : null);
  notify.send(d, { userId: s.user_id, channel: 'email', recipient: email, body: `${config.storeName} Seller Hub: ${text}` });
}

// ---------- Seller approvals ----------
router.get('/sellers', (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'suspended'].includes(req.query.status) ? req.query.status : null;
  const lane = ['brand', 'standard', 'value', 'shop'].includes(req.query.lane) ? req.query.lane : null;
  const d = db.get();
  const rows = d.prepare(`SELECT s.*, u.email AS account_email,
      (SELECT COUNT(*) FROM offers o WHERE o.seller_id = s.id AND o.active = 1) AS offers,
      (SELECT COUNT(*) FROM orders o WHERE o.seller_id = s.id) AS orders
      FROM sellers s LEFT JOIN users u ON u.id = s.user_id WHERE s.lane != 'direct' ${status ? 'AND s.status = ?' : ''} ${lane ? 'AND s.lane = ?' : ''}
     ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 200`).all(...(status ? [status] : []), ...(lane ? [lane] : []));
  res.json({ sellers: rows.map((s) => ({ ...s, bank_ref: undefined, performance: market.computeScore(d, s.id) })) });
});

const SELLER_ACTIONS = {
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected', note: true },
  suspend: { from: ['approved'], to: 'suspended', note: true },
  reinstate: { from: ['suspended'], to: 'approved' },
};

router.patch('/sellers/:id', (req, res) => {
  const id = v.int(req.params.id, 'Seller', { min: 1 });
  const act = SELLER_ACTIONS[req.body.action];
  if (!act) throw new HttpError(400, 'Unknown action.');
  const note = v.str(req.body.note, 'Reason', { min: 3, max: 300, optional: !act.note });
  db.tx((d) => {
    const s = d.prepare("SELECT * FROM sellers WHERE id = ? AND lane != 'direct'").get(id);
    if (!s) throw new HttpError(404, 'Seller not found.');
    if (!act.from.includes(s.status)) throw new HttpError(400, 'This seller has already moved on. Refresh to see the latest.');
    const now = Date.now();
    d.prepare('UPDATE sellers SET status = ?, status_note = ?, approved_at = CASE WHEN ? THEN ? ELSE approved_at END, updated_at = ? WHERE id = ?')
      .run(act.to, note || '', req.body.action === 'approve' ? 1 : 0, now, now, id);
    market.syncSellerProducts(d, id);
    if (req.body.action === 'suspend') {
      // Orders waiting for this seller move to the next seller straight away.
      for (const o of d.prepare("SELECT id FROM orders WHERE seller_id = ? AND status = 'placed' AND hold_reason IS NULL").all(id)) {
        routing.reject(d, o.id, id, 'Seller account suspended');
      }
    }
    const text = {
      approve: 'Your seller account is approved. You can add your first listings now.',
      reject: `We could not approve your seller account: ${note}. You can correct your details and apply again.`,
      suspend: `Your seller account is paused: ${note}. Your listings are hidden until it is reinstated.`,
      reinstate: 'Your seller account is active again and your listings are back in the store.',
    }[req.body.action];
    tellSeller(d, s, text);
  });
  audit(req, 'admin.seller', { sellerId: id, action: req.body.action });
  res.json({ ok: true });
});

// ---------- Catalog quality check ----------
router.get('/qc', (_req, res) => {
  const d = db.get();
  const rows = d.prepare(`SELECT p.*, c.slug AS category, c.name AS category_name, s.display_name AS seller, s.lane AS seller_lane,
      o.price AS offer_price, o.stock AS offer_stock, o.dispatch_days, o.best_before
      FROM products p JOIN categories c ON c.id = p.category_id JOIN sellers s ON s.id = p.created_by_seller
      LEFT JOIN offers o ON o.product_id = p.id AND o.seller_id = p.created_by_seller
     WHERE p.qc_status = 'pending' ORDER BY p.created_at`).all();
  res.json({ products: rows.map((p) => ({ ...p, features: JSON.parse(p.features), specs: JSON.parse(p.specs),
    problems: autoCheck({ ...p, category: p.category }), matches: findDuplicates(d, p, p.id) })) });
});

router.patch('/qc/:id', (req, res) => {
  const id = v.int(req.params.id, 'Product', { min: 1 });
  const action = req.body.action;
  if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'Unknown action.');
  const note = v.str(req.body.note, 'Reason', { min: 3, max: 300, optional: action === 'approve' });
  db.tx((d) => {
    const p = d.prepare("SELECT * FROM products WHERE id = ? AND qc_status = 'pending'").get(id);
    if (!p) throw new HttpError(404, 'This listing is not waiting for a check.');
    d.prepare('UPDATE products SET qc_status = ?, qc_note = ?, active = ? WHERE id = ?')
      .run(action === 'approve' ? 'approved' : 'rejected', note || '', action === 'approve' ? 1 : 0, id);
    market.syncProduct(d, id);
    const s = d.prepare('SELECT * FROM sellers WHERE id = ?').get(p.created_by_seller);
    tellSeller(d, s, action === 'approve' ? `Your listing "${p.title}" passed the quality check and is live.`
      : `Your listing "${p.title}" needs changes: ${note}`);
  });
  audit(req, 'admin.qc', { productId: id, action });
  res.json({ ok: true });
});

// ---------- Seller claims on returns ----------
router.get('/claims', (_req, res) => {
  res.json({ claims: db.get().prepare(`SELECT c.*, o.order_no, o.subtotal, s.display_name AS seller, r.reason AS return_reason, r.comment AS return_comment
      FROM claims c JOIN orders o ON o.id = c.order_id JOIN sellers s ON s.id = c.seller_id LEFT JOIN returns r ON r.order_id = c.order_id
     ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`).all() });
});

router.patch('/claims/:id', (req, res) => {
  const id = v.int(req.params.id, 'Claim', { min: 1 });
  const action = req.body.action;
  if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'Unknown action.');
  const note = v.str(req.body.note, 'Reason', { min: 3, max: 300, optional: action === 'approve' });
  db.tx((d) => {
    const c = d.prepare("SELECT c.*, o.subtotal FROM claims c JOIN orders o ON o.id = c.order_id WHERE c.id = ? AND c.status = 'open'").get(id);
    if (!c) throw new HttpError(404, 'This claim is not open.');
    let amount = 0;
    if (action === 'approve') {
      amount = v.int(req.body.amount, 'Amount (₹)', { min: 1, max: Math.floor(c.subtotal / 100) }) * 100;
    }
    d.prepare('UPDATE claims SET status = ?, amount = ?, decision_note = ?, updated_at = ? WHERE id = ?')
      .run(action === 'approve' ? 'approved' : 'rejected', amount, note || '', Date.now(), id);
    const s = d.prepare('SELECT * FROM sellers WHERE id = ?').get(c.seller_id);
    tellSeller(d, s, action === 'approve' ? `Your claim was approved. ₹${(amount / 100).toLocaleString('en-IN')} will be added to your next payout.`
      : `Your claim was not approved: ${note}`);
  });
  audit(req, 'admin.claim', { claimId: id, action });
  res.json({ ok: true });
});

// ---------- Settlement run and reconciliation ----------
router.get('/settlement', (_req, res) => {
  const d = db.get();
  const due = settlement.eligible(d, Date.now());
  const bySeller = new Map();
  for (const o of due) {
    const s = d.prepare('SELECT * FROM sellers WHERE id = ?').get(o.seller_id);
    const b = settlement.breakdown(d, o, s);
    const row = bySeller.get(s.id) || { sellerId: s.id, seller: s.display_name, status: s.status, orders: 0, gross: 0, net: 0 };
    row.orders += 1; row.gross += b.gross; row.net += b.net;
    bySeller.set(s.id, row);
  }
  const payouts = d.prepare(`SELECT p.*, s.display_name AS seller FROM payouts p JOIN sellers s ON s.id = p.seller_id ORDER BY p.id DESC LIMIT 100`).all();
  // Resellers whose sales are past the return window.
  const resellerDue = d.prepare(`SELECT r.id, r.display_name, r.upi_id, COUNT(*) AS items, SUM(i.reseller_margin * i.qty) AS gross FROM order_items i
      JOIN orders o ON o.id = i.order_id JOIN reseller_shares sh ON sh.id = i.share_id JOIN resellers r ON r.id = sh.reseller_id
     WHERE i.reseller_margin > 0 AND i.reseller_payout_id IS NULL AND o.status = 'delivered' AND o.delivered_at <= ? AND r.status = 'active'
     GROUP BY r.id ORDER BY gross DESC`).all(Date.now() - config.returnWindowDays * 86400_000);
  const resellerPayouts = d.prepare(`SELECT p.*, r.display_name AS reseller FROM reseller_payouts p JOIN resellers r ON r.id = p.reseller_id
     ORDER BY p.id DESC LIMIT 50`).all();
  res.json({ due: [...bySeller.values()], payouts, resellerDue, resellerPayouts, reconciliation: settlement.reconciliation(d), returnWindowDays: config.returnWindowDays,
    rates: { tcsPct: config.market.tcsPct, tdsPct: config.market.tdsPct, gstOnFeesPct: config.market.gstOnFeesPct } });
});

router.post('/settlement/run', (req, res) => {
  const { made, resellers } = db.tx((d) => ({ made: settlement.run(d), resellers: resell.run(d) }));
  audit(req, 'admin.settlement_run', { payouts: made.length, total: made.reduce((s, p) => s + p.net, 0), resellerPayouts: resellers.length });
  res.json({ payouts: made, resellerPayouts: resellers });
});

// ---------- Express: riders and the live board (blueprint stages 6 to 8) ----------
const DAY = 86400_000;
const IST = 330 * 60000;
const dayStart = (ts) => { const t = new Date(ts + IST); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST; };

router.get('/riders', (req, res) => {
  const d = db.get();
  const today = dayStart(Date.now());
  const riders = d.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM orders o WHERE o.rider_id = r.id AND o.status = 'delivered' AND o.delivered_at >= ?) AS today_orders,
      (SELECT COALESCE(SUM(o.rider_fee), 0) FROM orders o WHERE o.rider_id = r.id AND o.status = 'delivered' AND o.delivered_at >= ?) AS today_earned,
      (SELECT COUNT(*) FROM orders o WHERE o.rider_id = r.id AND o.status = 'delivered' AND o.rider_payout_id IS NULL) AS unpaid_orders,
      (SELECT COALESCE(SUM(o.rider_fee), 0) FROM orders o WHERE o.rider_id = r.id AND o.status = 'delivered' AND o.rider_payout_id IS NULL) AS unpaid
      FROM riders r ORDER BY r.city, r.name`).all(today, today);
  for (const r of riders) r.load = hyper.riderLoad(d, r.id);
  res.json({ riders, cities: Object.values(geo.CITY_CENTRES).map((c) => c.city),
    payouts: d.prepare('SELECT p.*, r.name FROM rider_payouts p JOIN riders r ON r.id = p.rider_id ORDER BY p.id DESC LIMIT 30').all(),
    rules: { maxLoad: config.express.riderMaxLoad, feeBase: config.express.riderFeeBase, feePerKm: config.express.riderFeePerKm } });
});

router.post('/riders', (req, res) => {
  const name = v.str(req.body.name, 'Rider name', { min: 2, max: 60 });
  const phone = v.phone(req.body.phone);
  const c = Object.values(geo.CITY_CENTRES).find((x) => x.city === req.body.city);
  if (!c) throw new HttpError(400, 'Please choose an Express city.');
  const id = Number(db.get().prepare('INSERT INTO riders (name, phone, city, lat, lng, active, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(name, phone, c.city, c.lat, c.lng, Date.now()).lastInsertRowid);
  audit(req, 'admin.rider_add', { riderId: id });
  res.status(201).json({ id });
});

router.patch('/riders/:id', (req, res) => {
  const id = v.int(req.params.id, 'Rider', { min: 1 });
  const r = db.get().prepare('UPDATE riders SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
  if (!r.changes) throw new HttpError(404, 'Rider not found.');
  audit(req, 'admin.rider', { riderId: id, active: !!req.body.active });
  res.json({ ok: true });
});

/** Pays every rider for their delivered, unpaid Express trips. */
router.post('/riders/pay', (req, res) => {
  const made = db.tx((d) => {
    const due = d.prepare(`SELECT rider_id, COUNT(*) AS n, SUM(rider_fee) AS amount FROM orders WHERE rider_id IS NOT NULL AND status = 'delivered'
      AND rider_payout_id IS NULL GROUP BY rider_id`).all();
    const out = [];
    for (const x of due) {
      const utr = config.paymentProvider === 'test' ? `TESTUTR${crypto.randomInt(1e9, 1e10)}` : null;
      const pid = Number(d.prepare('INSERT INTO rider_payouts (rider_id, amount, orders, utr, created_at) VALUES (?,?,?,?,?)')
        .run(x.rider_id, x.amount, x.n, utr, Date.now()).lastInsertRowid);
      d.prepare("UPDATE orders SET rider_payout_id = ? WHERE rider_id = ? AND status = 'delivered' AND rider_payout_id IS NULL").run(pid, x.rider_id);
      out.push({ riderId: x.rider_id, amount: x.amount, orders: x.n });
    }
    return out;
  });
  audit(req, 'admin.rider_pay', { riders: made.length, total: made.reduce((s, x) => s + x.amount, 0) });
  res.json({ payouts: made });
});

/** Every Express order still moving: the shop or city store, the rider and the expected times. */
router.get('/express', (_req, res) => {
  routing.sweep();
  hyper.tick(db);
  const d = db.get();
  const rows = d.prepare(`SELECT o.id, o.order_no, o.status, o.address, o.created_at, o.accept_by, o.promised_at, o.rider_id, o.eta_pickup, o.eta_drop,
      o.rider_picked_at, o.route, o.rider_fee, s.display_name AS seller, s.lane, r.name AS rider
      FROM orders o LEFT JOIN sellers s ON s.id = o.seller_id LEFT JOIN riders r ON r.id = o.rider_id
     WHERE o.delivery_speed = 'express' AND o.status IN ('placed','confirmed','packed','shipped','out_for_delivery') ORDER BY o.created_at`).all();
  const now = Date.now();
  res.json({ now, orders: rows.map((o) => {
    const a = JSON.parse(o.address);
    return { id: o.id, orderNo: o.order_no, status: o.status, from: o.lane === 'shop' ? o.seller : `Bazaario city store (${o.seller})`,
      to: `${a.city} ${a.pincode}`, createdAt: o.created_at, acceptBy: o.accept_by, promisedAt: o.promised_at, rider: o.rider,
      etaPickup: o.eta_pickup, etaDrop: o.eta_drop, pickedAt: o.rider_picked_at, km: o.route ? JSON.parse(o.route).km : null, riderFee: o.rider_fee,
      late: !!o.promised_at && o.promised_at < now, position: o.route ? hyper.position(o, now) : null };
  }) });
});

/** Rider updates entered from Studio when a rider has no app: picked up, or handed over. */
router.post('/express/:id/:step', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const step = req.params.step;
  if (!['assign', 'pickup', 'deliver'].includes(step)) throw new HttpError(404, 'Not found.');
  db.tx((d) => {
    const o = d.prepare("SELECT * FROM orders WHERE id = ? AND delivery_speed = 'express'").get(id);
    if (!o) throw new HttpError(404, 'Express order not found.');
    if (step === 'assign') {
      if (o.status !== 'packed') throw new HttpError(400, 'A rider is assigned once the order is packed.');
      // Reassign: free the current rider and pick again.
      d.prepare('UPDATE orders SET rider_id = NULL, route = NULL WHERE id = ?').run(id);
      if (!hyper.dispatch(d, id)) throw new HttpError(409, 'Every rider in this city is busy. The order will get the next free rider.');
    } else if (step === 'pickup') {
      if (o.status !== 'packed' || !o.rider_id) throw new HttpError(400, 'Only a packed order with a rider can be picked up.');
      hyper.pickedUp(d, id);
    } else {
      if (o.status !== 'out_for_delivery' || !o.rider_id) throw new HttpError(400, 'Only an order out for delivery can be handed over.');
      hyper.delivered(d, id);
    }
  });
  audit(req, 'admin.express', { orderId: id, step });
  res.json({ ok: true });
});

// ---------- Resellers ----------
router.get('/resellers', (_req, res) => {
  const d = db.get();
  const rows = d.prepare(`SELECT r.*, u.email, (SELECT COUNT(*) FROM reseller_shares sh WHERE sh.reseller_id = r.id AND sh.active = 1) AS shares,
      (SELECT COALESCE(SUM(views), 0) FROM reseller_shares sh WHERE sh.reseller_id = r.id) AS views
      FROM resellers r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 200`).all();
  res.json({ resellers: rows.map((r) => {
    const sales = resell.sales(d, r.id);
    return { ...r, pan: r.pan ? `${r.pan.slice(0, 2)}XXXXX${r.pan.slice(7)}` : null, orders: new Set(sales.map((x) => x.orderId)).size,
      earned: sales.filter((x) => x.stage !== 'lost').reduce((s, x) => s + x.earn, 0) };
  }) });
});

router.patch('/resellers/:id', (req, res) => {
  const id = v.int(req.params.id, 'Reseller', { min: 1 });
  const action = req.body.action;
  if (!['suspend', 'reinstate'].includes(action)) throw new HttpError(400, 'Unknown action.');
  const note = v.str(req.body.note, 'Reason', { min: 3, max: 300, optional: action === 'reinstate' });
  const r = db.get().prepare('UPDATE resellers SET status = ?, status_note = ? WHERE id = ?')
    .run(action === 'suspend' ? 'suspended' : 'active', note || '', id);
  if (!r.changes) throw new HttpError(404, 'Reseller not found.');
  audit(req, 'admin.reseller', { resellerId: id, action });
  res.json({ ok: true });
});

router.get('/orders/:id/documents', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  if (!db.get().prepare('SELECT 1 FROM orders WHERE id = ?').get(id)) throw new HttpError(404, 'Order not found.');
  res.json({ invoice: invoice(db.get(), id), label: label(db.get(), id) });
});

module.exports = router;
