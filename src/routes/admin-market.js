'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const market = require('../market');
const routing = require('../routing');
const settlement = require('../settlement');
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
  const d = db.get();
  const rows = d.prepare(`SELECT s.*, u.email AS account_email,
      (SELECT COUNT(*) FROM offers o WHERE o.seller_id = s.id AND o.active = 1) AS offers,
      (SELECT COUNT(*) FROM orders o WHERE o.seller_id = s.id) AS orders
      FROM sellers s LEFT JOIN users u ON u.id = s.user_id WHERE s.lane != 'direct' ${status ? 'AND s.status = ?' : ''}
     ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 200`).all(...(status ? [status] : []));
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
  res.json({ due: [...bySeller.values()], payouts, reconciliation: settlement.reconciliation(d), returnWindowDays: config.returnWindowDays,
    rates: { tcsPct: config.market.tcsPct, tdsPct: config.market.tdsPct, gstOnFeesPct: config.market.gstOnFeesPct } });
});

router.post('/settlement/run', (req, res) => {
  const made = db.tx((d) => settlement.run(d));
  audit(req, 'admin.settlement_run', { payouts: made.length, total: made.reduce((s, p) => s + p.net, 0) });
  res.json({ payouts: made });
});

router.get('/orders/:id/documents', (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  if (!db.get().prepare('SELECT 1 FROM orders WHERE id = ?').get(id)) throw new HttpError(404, 'Order not found.');
  res.json({ invoice: invoice(db.get(), id), label: label(db.get(), id) });
});

module.exports = router;
