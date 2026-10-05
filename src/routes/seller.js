'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const kyc = require('../kyc');
const market = require('../market');
const routing = require('../routing');
const settlement = require('../settlement');
const { invoice, label } = require('../invoice');
const { readDetails, autoCheck, findDuplicates } = require('../listing');
const { saveProductPhoto } = require('../uploads');
const { move } = require('../fulfilment');
const { INDIAN_STATES } = require('../states');
const { HttpError, requireAuth, audit, v } = require('../security');

/**
 * Seller Hub (blueprint: brands, Standard and Value sellers).
 * Sign-up with lane and KYC, listings and bulk upload, orders with pack and ship, returns and claims, payouts.
 */
const router = express.Router();
router.use(requireAuth);
const M = config.market;

const LANES = {
  brand: { name: 'Brand', docs: 'GSTIN, PAN, bank account and trademark number', fee: 'Commission 5-15% by category' },
  standard: { name: 'Standard seller', docs: 'GSTIN, PAN and bank account', fee: 'Commission 5-15% by category' },
  value: { name: 'Value seller', docs: 'PAN, bank account and GST enrolment ID', fee: '0% commission. You sell within your own state.' },
};
const FULFILMENT = {
  fulfilled: { name: 'Bazaario Fulfilled', text: 'You send stock to our warehouse; we pack and ship every order.' },
  pickup: { name: 'Bazaario Pickup', text: 'You pack; our courier collects from your address.' },
  self: { name: 'Self Ship', text: 'You pack and ship with your own courier and enter the tracking number.' },
};

const mySeller = (userId) => db.get().prepare('SELECT * FROM sellers WHERE user_id = ?').get(userId);

function requireSeller(req, _res, next) {
  const s = mySeller(req.user.id);
  if (!s) return next(new HttpError(403, 'Please register as a seller first.'));
  if (s.status === 'pending') return next(new HttpError(403, 'Your seller application is being checked. We will email you when it is approved.'));
  if (s.status !== 'approved') return next(new HttpError(403, 'Your seller account is not active. Please contact seller support.'));
  req.seller = s;
  next();
}

/** A seller's own view of their account. Bank details stay masked. */
function ownView(s) {
  return {
    id: s.id, code: s.code, lane: s.lane, laneName: LANES[s.lane] ? LANES[s.lane].name : s.lane, displayName: s.display_name,
    legalName: s.legal_name, gstin: s.gstin, enrolmentId: s.enrolment_id, pan: s.pan, brandName: s.brand_name, trademarkNo: s.trademark_no,
    bank: s.bank_last4 ? { ifsc: s.bank_ifsc, last4: s.bank_last4, nameAtBank: s.bank_name_at_bank } : null,
    phone: s.phone, email: s.email, pickup: { line1: s.pickup_line1, city: s.pickup_city, state: s.pickup_state, pincode: s.pickup_pincode },
    fulfilment: s.fulfilment, fulfilmentName: FULFILMENT[s.fulfilment].name, status: s.status, statusNote: s.status_note, score: s.score,
    createdAt: s.created_at, approvedAt: s.approved_at,
  };
}

const plans = () => ({
  lanes: LANES, fulfilment: FULFILMENT, commission: M.commission, fulfilmentFee: M.fulfilmentFee, gstOnFeesPct: M.gstOnFeesPct,
  tcsPct: M.tcsPct, tdsPct: M.tdsPct, acceptHours: M.acceptHours, authenticCategories: M.authenticCategories,
  specs: market.CATEGORY_SPECS, gstRates: market.GST_RATES, bestBeforeCategories: M.bestBeforeCategories,
});

router.get('/me', (req, res) => {
  const s = mySeller(req.user.id);
  if (!s) return res.json({ seller: null, plans: plans(), states: INDIAN_STATES });
  const out = { seller: ownView(s), plans: plans(), states: INDIAN_STATES };
  if (s.status === 'approved') {
    routing.sweep();
    const d = db.get();
    const count = (where, ...p) => d.prepare(`SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND ${where}`).get(s.id, ...p).n;
    out.performance = market.computeScore(d, s.id);
    out.counts = {
      toAccept: count("status = 'placed' AND hold_reason IS NULL"),
      toPack: count("status = 'confirmed'"),
      toShip: count("status = 'packed'"),
      lateToShip: count("status IN ('confirmed','packed') AND dispatch_by < ?", Date.now()),
      listings: d.prepare('SELECT COUNT(*) AS n FROM offers WHERE seller_id = ? AND active = 1').get(s.id).n,
      inQc: d.prepare("SELECT COUNT(*) AS n FROM products WHERE created_by_seller = ? AND qc_status = 'pending'").get(s.id).n,
      returns: d.prepare("SELECT COUNT(*) AS n FROM returns r JOIN orders o ON o.id = r.order_id WHERE o.seller_id = ? AND r.status IN ('requested','pickup_scheduled')").get(s.id).n,
    };
    out.upcoming = settlement.upcoming(d, s.id).net;
  }
  res.json(out);
});

// ---------- Sign-up with lane choice and KYC (blueprint stage 1) ----------
router.post('/apply', (req, res) => {
  const b = req.body;
  const existing = mySeller(req.user.id);
  if (existing && existing.status !== 'rejected') throw new HttpError(409, 'You already have a seller account.');
  const lane = String(b.lane || '');
  if (!LANES[lane]) throw new HttpError(400, 'Please choose how you want to sell.');
  const fulfilment = String(b.fulfilment || '');
  if (!FULFILMENT[fulfilment]) throw new HttpError(400, 'Please choose how your orders will be shipped.');
  if (b.agree !== true) throw new HttpError(400, 'Please accept the seller terms.');
  const displayName = v.str(b.displayName, 'Shop name', { min: 3, max: 60 });
  const legalName = v.str(b.legalName, 'Legal name', { min: 3, max: 120 });
  const phone = v.phone(b.phone);
  const pickup = {
    line1: v.str(b.pickupLine1, 'Pickup address', { min: 5, max: 160 }),
    city: v.str(b.pickupCity, 'City', { min: 2, max: 60 }),
    state: v.str(b.pickupState, 'State', { max: 60 }),
    pincode: v.pincode(b.pickupPincode),
  };
  if (!INDIAN_STATES.includes(pickup.state)) throw new HttpError(400, 'Please choose a valid state.');

  let gstin = null;
  let enrolment = null;
  let pan;
  if (lane === 'value') {
    enrolment = kyc.enrolmentId(b.enrolmentId);
    pan = kyc.pan(b.pan);
  } else {
    const g = kyc.gstin(b.gstin);
    if (g.state !== pickup.state) throw new HttpError(400, `This GSTIN is registered in ${g.state}. Your pickup address must be in the same state.`);
    gstin = g.gstin;
    pan = g.pan;
    if (b.pan && kyc.pan(b.pan) !== pan) throw new HttpError(400, 'The PAN does not match the one inside your GSTIN.');
  }
  let brandName = null;
  let trademark = null;
  if (lane === 'brand') {
    brandName = v.str(b.brandName, 'Brand name', { min: 2, max: 60 });
    trademark = v.str(b.trademarkNo, 'Trademark number', { min: 5, max: 9, pattern: /^\d{5,9}$/ });
  }
  const account = kyc.accountNumber(b.accountNumber);
  if (String(b.accountConfirm || '').replace(/\s/g, '') !== account) throw new HttpError(400, 'The two bank account numbers do not match.');
  const bank = kyc.pennyDrop({ account, ifsc: kyc.ifsc(b.ifsc), legalName });

  const now = Date.now();
  const id = db.tx((d) => {
    const clash = d.prepare('SELECT id FROM sellers WHERE display_name = ? AND id != ?').get(displayName, existing ? existing.id : 0);
    if (clash) throw new HttpError(409, 'That shop name is taken. Please choose another.');
    const vals = [lane, displayName, legalName, gstin, enrolment, pan, brandName, trademark, bank.ifsc, bank.last4, bank.nameAtBank, bank.ref,
      phone, req.user.email, pickup.line1, pickup.city, pickup.state, pickup.pincode, fulfilment];
    if (existing) {
      d.prepare(`UPDATE sellers SET lane=?, display_name=?, legal_name=?, gstin=?, enrolment_id=?, pan=?, brand_name=?, trademark_no=?,
        bank_ifsc=?, bank_last4=?, bank_name_at_bank=?, bank_ref=?, phone=?, email=?, pickup_line1=?, pickup_city=?, pickup_state=?, pickup_pincode=?,
        fulfilment=?, status='pending', status_note='', updated_at=? WHERE id = ?`).run(...vals, now, existing.id);
      return existing.id;
    }
    const sid = Number(d.prepare(`INSERT INTO sellers (code, lane, display_name, legal_name, gstin, enrolment_id, pan, brand_name, trademark_no,
      bank_ifsc, bank_last4, bank_name_at_bank, bank_ref, phone, email, pickup_line1, pickup_city, pickup_state, pickup_pincode, fulfilment,
      status, user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`)
      .run(`TMP${now}${req.user.id}`, ...vals, req.user.id, now, now).lastInsertRowid);
    d.prepare('UPDATE sellers SET code = ? WHERE id = ?').run(`SL${String(sid).padStart(5, '0')}`, sid);
    return sid;
  });
  audit(req, 'seller.apply', { sellerId: id, lane });
  res.status(201).json({ seller: ownView(mySeller(req.user.id)) });
});

// ---------- Listings (blueprint stage 2) ----------
router.post('/uploads', requireSeller, (req, res) => {
  const { url, bytes } = saveProductPhoto(req.body.dataUrl);
  audit(req, 'seller.photo_upload', { bytes });
  res.status(201).json({ url });
});

/** Products already on Bazaario: sellers add their offer to one of these before creating a new page. */
router.get('/catalog', requireSeller, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (q.length < 2) return res.json({ products: [] });
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const rows = db.get().prepare(`SELECT p.id, p.title, p.brand, p.price, p.mrp, p.image, p.emoji, p.color, p.offer_count, c.slug AS category, c.name AS category_name,
      (SELECT id FROM offers o WHERE o.product_id = p.id AND o.seller_id = ?) AS my_offer
      FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.active = 1 AND p.qc_status = 'approved' AND (p.title LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\')
     ORDER BY p.sold_count DESC LIMIT 20`).all(req.seller.id, like, like);
  res.json({ products: rows.map((p) => ({ ...p, allowed: market.mayList(req.seller, p.category) })) });
});

function readOffer(body, product, { partial = false } = {}) {
  const out = {};
  if (!partial || body.price !== undefined) {
    out.price = v.int(body.price, 'Price (₹)', { min: 1, max: 10_000_000 }) * 100;
    if (out.price > product.mrp) throw new HttpError(400, `Your price cannot be higher than the MRP of ₹${(product.mrp / 100).toLocaleString('en-IN')}.`);
  }
  if (!partial || body.stock !== undefined) out.stock = v.int(body.stock, 'Stock', { min: 0, max: 100000 });
  if (!partial || body.dispatchDays !== undefined) out.dispatch_days = v.int(body.dispatchDays, 'Dispatch time (days)', { min: 1, max: 7, optional: true, def: 2 });
  if (M.bestBeforeCategories.includes(product.category) && (!partial || body.bestBefore !== undefined)) {
    const bb = v.str(body.bestBefore, 'Best before (month)', { pattern: /^20\d{2}-(0[1-9]|1[0-2])$/ });
    const nowMonth = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    if (bb <= nowMonth) throw new HttpError(400, 'Best before date must be after this month.');
    out.best_before = bb;
  }
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return out;
}

const productFor = (id) => db.get().prepare(`SELECT p.id, p.mrp, p.active, p.qc_status, p.created_by_seller, c.slug AS category
  FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(id);

function addOffer(d, seller, productId, body) {
  const p = productFor(productId);
  if (!p || !p.active || p.qc_status !== 'approved') throw new HttpError(404, 'Product not found.');
  if (!market.mayList(seller, p.category)) throw new HttpError(403, 'Only brands and Bazaario Direct can sell in this category, so buyers always get genuine products.');
  if (d.prepare('SELECT 1 FROM offers WHERE product_id = ? AND seller_id = ?').get(productId, seller.id)) {
    throw new HttpError(409, 'You already sell this product. Change your offer under Listings.');
  }
  const o = readOffer(body, p);
  const now = Date.now();
  const id = Number(d.prepare(`INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, best_before, active, created_at, updated_at)
    VALUES (?,?,?,?,?,?,1,?,?)`).run(productId, seller.id, o.price, o.stock, o.dispatch_days, o.best_before || null, now, now).lastInsertRowid);
  market.syncProduct(d, productId);
  return id;
}

router.post('/offers', requireSeller, (req, res) => {
  const productId = v.int(req.body.productId, 'Product', { min: 1 });
  const id = db.tx((d) => addOffer(d, req.seller, productId, req.body));
  audit(req, 'seller.offer_create', { offerId: id, productId });
  res.status(201).json({ id });
});

router.patch('/offers/:id', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Offer', { min: 1 });
  db.tx((d) => {
    const o = d.prepare('SELECT * FROM offers WHERE id = ? AND seller_id = ?').get(id, req.seller.id);
    if (!o) throw new HttpError(404, 'Offer not found.');
    const upd = readOffer(req.body, productFor(o.product_id), { partial: true });
    const next = { ...o, ...upd };
    d.prepare('UPDATE offers SET price = ?, stock = ?, dispatch_days = ?, best_before = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(next.price, next.stock, next.dispatch_days, next.best_before, next.active, Date.now(), id);
    market.syncProduct(d, o.product_id);
  });
  audit(req, 'seller.offer_update', { offerId: id });
  res.json({ ok: true });
});

/** Bulk price and stock update from a CSV sheet: product_id, price, stock, dispatch_days, best_before. */
router.post('/offers/bulk', requireSeller, (req, res) => {
  const text = typeof req.body.csv === 'string' ? req.body.csv : '';
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rows.length && /product/i.test(rows[0])) rows.shift();
  if (!rows.length) throw new HttpError(400, 'The sheet is empty.');
  if (rows.length > 500) throw new HttpError(400, 'Please upload at most 500 rows at a time.');
  const results = rows.map((line, i) => {
    const [pid, price, stock, days, bestBefore] = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const body = { price, stock, dispatchDays: days || undefined, bestBefore: bestBefore || undefined };
    try {
      const productId = v.int(pid, 'Product ID', { min: 1 });
      const action = db.tx((d) => {
        const o = d.prepare('SELECT * FROM offers WHERE product_id = ? AND seller_id = ?').get(productId, req.seller.id);
        if (!o) { addOffer(d, req.seller, productId, body); return 'added'; }
        const upd = readOffer({ ...body, dispatchDays: body.dispatchDays || o.dispatch_days, bestBefore: body.bestBefore || o.best_before || undefined },
          productFor(productId));
        d.prepare('UPDATE offers SET price = ?, stock = ?, dispatch_days = ?, best_before = ?, updated_at = ? WHERE id = ?')
          .run(upd.price, upd.stock, upd.dispatch_days, upd.best_before || o.best_before, Date.now(), o.id);
        market.syncProduct(d, productId);
        return 'updated';
      });
      return { row: i + 1, productId, ok: true, action };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      return { row: i + 1, productId: Number(pid) || null, ok: false, error: err.message };
    }
  });
  audit(req, 'seller.offer_bulk', { rows: results.length, ok: results.filter((r) => r.ok).length });
  res.json({ results });
});

/**
 * A new product page. It must pass the automatic checks; it must not repeat a product already on Bazaario;
 * and it goes to a person for quality check unless the seller is a brand or a trusted seller outside risky categories.
 */
function submitProduct(req, existing) {
  const details = readDetails(req.body);
  if (!market.mayList(req.seller, details.category)) throw new HttpError(403, 'Only brands and Bazaario Direct can sell in this category, so buyers always get genuine products.');
  const problems = autoCheck(details);
  if (problems.length) throw new HttpError(400, problems[0], { problems });
  const d = db.get();
  const dupes = findDuplicates(d, details, existing ? existing.id : 0);
  if (dupes.length && req.body.notDuplicate !== true) {
    throw new HttpError(409, 'This product may already be on Bazaario. Add your offer to it instead of creating a new page.', { matches: dupes });
  }
  const offer = readOffer(req.body, { mrp: details.mrp, category: details.category });
  const perf = market.computeScore(d, req.seller.id);
  const trusted = req.seller.lane === 'brand' || (perf.score !== null && perf.score >= 80 && perf.delivered >= 20);
  const auto = trusted && !M.riskyCategories.includes(details.category) && !dupes.length;
  const note = dupes.length ? `Seller says this differs from product ${dupes.map((p) => '#' + p.id).join(', ')}` : '';
  return { details, offer, auto, note };
}

router.post('/products', requireSeller, (req, res) => {
  const { details: p, offer, auto, note } = submitProduct(req);
  const id = db.tx((d) => {
    const now = Date.now();
    const pid = Number(d.prepare(`INSERT INTO products (title, brand, category_id, description, features, price, mrp, stock, image,
        hsn, gst_rate, origin, manufacturer, specs, qc_status, qc_note, created_by_seller, active, created_at)
        VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.title, p.brand, p.category_id, p.description, p.features, offer.price, p.mrp, p.image, p.hsn, p.gst_rate, p.origin,
        p.manufacturer, p.specs, auto ? 'approved' : 'pending', note, req.seller.id, auto ? 1 : 0, now).lastInsertRowid);
    d.prepare(`INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, best_before, active, created_at, updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)`).run(pid, req.seller.id, offer.price, offer.stock, offer.dispatch_days, offer.best_before || null, now, now);
    market.syncProduct(d, pid);
    return pid;
  });
  audit(req, 'seller.product_create', { productId: id, auto });
  res.status(201).json({ id, qcStatus: auto ? 'approved' : 'pending' });
});

// A rejected or waiting listing can be corrected and sent back for quality check.
router.put('/products/:id', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Product', { min: 1 });
  const cur = db.get().prepare('SELECT * FROM products WHERE id = ? AND created_by_seller = ?').get(id, req.seller.id);
  if (!cur) throw new HttpError(404, 'Product not found.');
  if (cur.qc_status === 'approved') throw new HttpError(400, 'This product is live. Ask seller support to change its details.');
  const { details: p, offer, note } = submitProduct(req, cur);
  db.tx((d) => {
    d.prepare(`UPDATE products SET title=?, brand=?, category_id=?, description=?, features=?, mrp=?, image=?, hsn=?, gst_rate=?, origin=?,
      manufacturer=?, specs=?, qc_status='pending', qc_note=? WHERE id = ?`)
      .run(p.title, p.brand, p.category_id, p.description, p.features, p.mrp, p.image, p.hsn, p.gst_rate, p.origin, p.manufacturer, p.specs, note, id);
    d.prepare('UPDATE offers SET price = ?, stock = ?, dispatch_days = ?, best_before = ?, updated_at = ? WHERE product_id = ? AND seller_id = ?')
      .run(offer.price, offer.stock, offer.dispatch_days, offer.best_before || null, Date.now(), id, req.seller.id);
  });
  audit(req, 'seller.product_resubmit', { productId: id });
  res.json({ ok: true });
});

router.get('/listings', requireSeller, (req, res) => {
  const d = db.get();
  const rows = d.prepare(`SELECT o.id, o.product_id, o.price, o.stock, o.dispatch_days, o.best_before, o.active, o.updated_at,
      p.title, p.brand, p.mrp, p.image, p.emoji, p.color, p.qc_status, p.qc_note, p.created_by_seller, p.best_offer_id, p.offer_count,
      p.hsn, p.gst_rate, p.origin, p.manufacturer, p.specs, p.description, p.features, p.category_id, c.slug AS category, c.name AS category_name
      FROM offers o JOIN products p ON p.id = o.product_id JOIN categories c ON c.id = p.category_id
     WHERE o.seller_id = ? ORDER BY o.updated_at DESC`).all(req.seller.id);
  const listings = rows.map((r) => {
    const others = market.rankOffers(market.offersFor(d, r.product_id)).filter((x) => x.seller_id !== req.seller.id);
    return { ...r, specs: JSON.parse(r.specs), features: JSON.parse(r.features), bestOffer: r.best_offer_id === r.id,
      lowestOther: others.length ? Math.min(...others.map((x) => x.price)) : null,
      assured: market.isAssured(r, req.seller) };
  });
  res.json({ listings });
});

// ---------- Orders: accept, pack and ship (blueprint stages 6 and 7) ----------
const VIEWS = {
  accept: "o.status = 'placed' AND o.hold_reason IS NULL",
  pack: "o.status = 'confirmed'",
  ship: "o.status = 'packed'",
  transit: "o.status IN ('shipped','out_for_delivery','delivery_failed')",
  done: "o.status IN ('delivered','return_requested','returned','rto','cancelled')",
  all: '1 = 1',
};

router.get('/orders', requireSeller, (req, res) => {
  routing.sweep();
  const view = VIEWS[req.query.view] ? req.query.view : 'all';
  const d = db.get();
  const orders = d.prepare(`SELECT o.id, o.order_no, o.status, o.subtotal, o.payment_method, o.payment_status, o.delivery_speed, o.promised_at,
      o.accept_by, o.dispatch_by, o.courier, o.awb, o.address, o.created_at, o.delivered_at, o.hold_reason
      FROM orders o WHERE o.seller_id = ? AND ${VIEWS[view]} ORDER BY o.created_at DESC LIMIT 200`).all(req.seller.id);
  const items = d.prepare('SELECT i.product_id, i.title, i.price, i.qty, COALESCE(p.image, \'\') AS image, p.emoji, p.color FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ?');
  for (const o of orders) {
    const a = JSON.parse(o.address);
    // Until the seller accepts, they see only where the order is going, not who it is for.
    o.address = o.status === 'placed' ? { city: a.city, state: a.state, pincode: a.pincode } : a;
    o.items = items.all(o.id);
  }
  res.json({ orders, managed: routing.handledByBazaario(req.seller) });
});

function ownOrder(req, id) {
  const o = db.get().prepare('SELECT * FROM orders WHERE id = ? AND seller_id = ?').get(id, req.seller.id);
  if (!o) throw new HttpError(404, 'Order not found.');
  return o;
}

function sellerShips(req) {
  if (routing.handledByBazaario(req.seller)) throw new HttpError(400, 'Bazaario packs and ships your orders from our warehouse.');
}

router.post('/orders/:id/accept', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  db.tx((d) => routing.accept(d, id, req.seller.id));
  audit(req, 'seller.order_accept', { orderId: id });
  res.json({ ok: true });
});

router.post('/orders/:id/reject', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const reason = v.str(req.body.reason, 'Reason', { min: 3, max: 200 });
  db.tx((d) => routing.reject(d, id, req.seller.id, reason));
  audit(req, 'seller.order_reject', { orderId: id });
  res.json({ ok: true });
});

router.post('/orders/:id/cancel', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  const reason = v.str(req.body.reason, 'Reason', { min: 3, max: 200 });
  sellerShips(req);
  db.tx((d) => routing.sellerCancel(d, id, req.seller.id, reason));
  audit(req, 'seller.order_cancel', { orderId: id });
  res.json({ ok: true });
});

// Packing. With Bazaario Pickup, the courier is booked now so the label carries its tracking number.
router.post('/orders/:id/pack', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  sellerShips(req);
  db.tx((d) => {
    const o = ownOrder(req, id);
    move(d, o.id, 'packed', { actor: 'seller' });
    if (req.seller.fulfilment === 'pickup') {
      const courier = config.courierProvider === 'test' ? 'Bazaario Logistics' : config.courierProvider;
      const awb = `BZL${crypto.randomInt(1e9, 1e10)}`;
      d.prepare('UPDATE orders SET courier = ?, awb = ? WHERE id = ?').run(courier, awb, o.id);
    }
  });
  audit(req, 'seller.order_pack', { orderId: id });
  res.json({ ok: true });
});

// Handed to the courier. Self Ship sellers enter their own courier and tracking number.
router.post('/orders/:id/ship', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  sellerShips(req);
  let courier;
  let awb;
  if (req.seller.fulfilment === 'self') {
    courier = v.str(req.body.courier, 'Courier name', { min: 2, max: 40 });
    awb = v.str(req.body.awb, 'Tracking number', { min: 6, max: 30, pattern: /^[A-Za-z0-9-]+$/ }).toUpperCase();
  }
  db.tx((d) => move(d, ownOrder(req, id).id, 'shipped', { actor: 'seller', courier, awb }));
  audit(req, 'seller.order_ship', { orderId: id });
  res.json({ ok: true });
});

// Self Ship sellers report delivery updates from their courier.
router.post('/orders/:id/status', requireSeller, (req, res) => {
  const id = v.int(req.params.id, 'Order', { min: 1 });
  if (req.seller.fulfilment !== 'self') throw new HttpError(400, 'Delivery updates for your orders come from the Bazaario courier.');
  const next = String(req.body.status || '');
  if (!['out_for_delivery', 'delivered', 'delivery_failed', 'rto'].includes(next)) throw new HttpError(400, 'Unknown delivery update.');
  db.tx((d) => move(d, ownOrder(req, id).id, next, { actor: 'seller' }));
  audit(req, 'seller.order_status', { orderId: id, status: next });
  res.json({ ok: true });
});

router.get('/orders/:id/documents', requireSeller, (req, res) => {
  const o = ownOrder(req, v.int(req.params.id, 'Order', { min: 1 }));
  if (['placed', 'cancelled'].includes(o.status)) throw new HttpError(400, 'Documents are ready once you accept the order.');
  res.json({ invoice: invoice(db.get(), o.id), label: label(db.get(), o.id) });
});

// ---------- Returns and claims (blueprint stage 9) ----------
const CLAIM_REASONS = ['Item came back used', 'Item came back damaged', 'A different item came back', 'Parts or accessories missing'];

router.get('/returns', requireSeller, (req, res) => {
  const rows = db.get().prepare(`SELECT r.order_id, r.reason, r.comment, r.status, r.note, r.created_at, r.updated_at, o.order_no, o.subtotal, o.status AS order_status,
      c.id AS claim_id, c.reason AS claim_reason, c.status AS claim_status, c.amount AS claim_amount, c.decision_note
      FROM returns r JOIN orders o ON o.id = r.order_id LEFT JOIN claims c ON c.order_id = o.id
     WHERE o.seller_id = ? ORDER BY r.created_at DESC LIMIT 200`).all(req.seller.id);
  res.json({ returns: rows, claimReasons: CLAIM_REASONS });
});

router.post('/claims', requireSeller, (req, res) => {
  const orderId = v.int(req.body.orderId, 'Order', { min: 1 });
  const reason = String(req.body.reason || '');
  if (!CLAIM_REASONS.includes(reason)) throw new HttpError(400, 'Please choose what was wrong with the returned item.');
  const note = v.str(req.body.note, 'Details', { min: 10, max: 1000 });
  const id = db.tx((d) => {
    const o = ownOrder(req, orderId);
    if (o.status !== 'returned') throw new HttpError(400, 'You can file a claim once the return has reached you.');
    if (Date.now() - o.updated_at > 15 * 86400_000) throw new HttpError(400, 'Claims must be filed within 15 days of the return.');
    if (d.prepare('SELECT 1 FROM claims WHERE order_id = ?').get(orderId)) throw new HttpError(409, 'A claim was already filed for this order.');
    const now = Date.now();
    return Number(d.prepare("INSERT INTO claims (order_id, seller_id, reason, note, status, created_at, updated_at) VALUES (?,?,?,?,'open',?,?)")
      .run(orderId, req.seller.id, reason, note, now, now).lastInsertRowid);
  });
  audit(req, 'seller.claim', { claimId: id, orderId });
  res.status(201).json({ id });
});

// ---------- Payouts (blueprint stage 10) ----------
router.get('/payouts', requireSeller, (req, res) => {
  const d = db.get();
  const payouts = d.prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY id DESC LIMIT 50').all(req.seller.id);
  const lines = d.prepare(`SELECT l.*, o.order_no FROM payout_lines l LEFT JOIN orders o ON o.id = l.order_id WHERE l.payout_id = ? ORDER BY l.id`);
  for (const p of payouts) p.lines = lines.all(p.id);
  res.json({ upcoming: settlement.upcoming(d, req.seller.id), payouts, returnWindowDays: config.returnWindowDays });
});

module.exports = router;
