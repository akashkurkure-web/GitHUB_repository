'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'bazaario-test-uploads');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { seed } = require('../src/seed');
const kyc = require('../src/kyc');
const routing = require('../src/routing');
const { createApp } = require('../server');
const { signInAdmin } = require('./admin-signin');

let server;
let base;

before(async () => {
  db.open(':memory:');
  seed({ log: () => {} });
  // These tests check list prices, so the demo sales are switched off (sales are tested in growth.test.js).
  db.get().exec('UPDATE sales SET active = 0');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); db.close(); });

function client() {
  let cookie = '';
  let csrf = null;
  const call = async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const set of res.headers.getSetCookie()) {
      const pair = set.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const data = await res.json().catch(() => ({}));
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: res.status, data };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; }, set csrf(v) { csrf = v; } };
}

let n = 0;
async function user() {
  const c = client();
  assert.equal((await c.call('POST', '/auth/register', { name: 'Ravi Kumar', email: `mk${++n}@example.com`, password: 'secret123' })).status, 201);
  return c;
}
async function admin() {
  const a = client();
  await signInAdmin(a);
  return a;
}
async function address(c, state = 'Maharashtra', pincode = '411001') {
  const r = await c.call('POST', '/addresses', { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state, pincode });
  assert.equal(r.status, 201);
  return r.data.id;
}
const gstinFor = (stateCode, pan) => { const s = `${stateCode}${pan}1Z`; return s + kyc.gstinCheckChar(s); };

let shop = 0;
function application(over = {}) {
  shop += 1;
  const pan = `AAKCS${String(1000 + shop)}M`;
  return {
    lane: 'standard', displayName: `Test Shop ${shop}`, legalName: `Test Shop ${shop} Private Limited`, phone: '9876501234',
    gstin: gstinFor('27', pan), pickupLine1: 'Unit 4, Hadapsar Industrial Estate', pickupCity: 'Pune', pickupState: 'Maharashtra',
    pickupPincode: '411013', accountNumber: '50100012345678', accountConfirm: '50100012345678', ifsc: 'HDFC0001234',
    fulfilment: 'pickup', agree: true, ...over,
  };
}

/** A new seller, applied and approved. */
async function seller(over) {
  const s = await user();
  const r = await s.call('POST', '/seller/apply', application(over));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const a = await admin();
  assert.equal((await a.call('PATCH', `/admin/sellers/${r.data.seller.id}`, { action: 'approve' })).status, 200);
  return { c: s, id: r.data.seller.id };
}

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('KYC: GSTIN checksum and state, PAN inside GSTIN, bank check; Seller Hub stays closed until Studio approves', async () => {
  assert.equal(kyc.gstinCheckChar('27AAPFU0939F1Z'), 'V', 'public example GSTIN');
  const s = await user();
  const bad = application();
  const typo = (await s.call('POST', '/seller/apply', { ...bad, gstin: bad.gstin.slice(0, 14) + (bad.gstin[14] === 'A' ? 'B' : 'A') })).data;
  assert.match(typo.error, /typing mistakes/);
  assert.match((await s.call('POST', '/seller/apply', { ...bad, pickupState: 'Karnataka' })).data.error, /registered in Maharashtra/);
  assert.match((await s.call('POST', '/seller/apply', { ...bad, pan: 'ABCPE1234F' })).data.error, /does not match/);
  assert.match((await s.call('POST', '/seller/apply', { ...bad, accountConfirm: '123' })).data.error, /do not match/);
  assert.equal((await s.call('POST', '/seller/apply', { ...bad, agree: false })).status, 400);

  const ok = await s.call('POST', '/seller/apply', bad);
  assert.equal(ok.status, 201);
  assert.equal(ok.data.seller.status, 'pending');
  assert.equal(ok.data.seller.bank.last4, '5678', 'only the last 4 digits are kept');
  assert.equal(ok.data.seller.pan, bad.gstin.slice(2, 12));
  assert.equal((await s.call('POST', '/seller/apply', bad)).status, 409);
  assert.equal((await s.call('GET', '/seller/listings')).status, 403);

  const a = await admin();
  const queue = (await a.call('GET', '/admin/sellers?status=pending')).data.sellers;
  assert.ok(queue.some((x) => x.id === ok.data.seller.id && x.bank_name_at_bank));
  assert.equal((await a.call('PATCH', `/admin/sellers/${ok.data.seller.id}`, { action: 'reject' })).status, 400, 'a rejection needs a reason');
  assert.equal((await a.call('PATCH', `/admin/sellers/${ok.data.seller.id}`, { action: 'approve' })).status, 200);
  const me = (await s.call('GET', '/seller/me')).data;
  assert.equal(me.seller.status, 'approved');
  assert.equal(me.counts.toAccept, 0);
  assert.equal(me.performance.score, null, 'no score before 5 orders');
});

test('offers: one page per product, best offer wins, MRP cap, authentic categories, best-before for food', async () => {
  const { c } = await seller();
  // Product 16 (cookware, Bazaario Direct ₹1,299). A lower price takes the best offer.
  assert.match((await c.call('POST', '/seller/offers', { productId: 16, price: 99999, stock: 5 })).data.error, /MRP/);
  const r = await c.call('POST', '/seller/offers', { productId: 16, price: 1199, stock: 7, dispatchDays: 1 });
  assert.equal(r.status, 201);
  assert.equal((await c.call('POST', '/seller/offers', { productId: 16, price: 1100, stock: 7 })).status, 409, 'one offer per seller');
  const p = (await client().call('GET', '/products/16')).data.product;
  assert.equal(p.price, 119900);
  assert.equal(p.stock, 7);
  assert.equal(p.offers[0].id, r.data.id);
  assert.ok(p.offers.length >= 3, 'Direct and the demo seller are listed as other sellers');
  assert.equal(p.offers[0].assured, false, 'new sellers are not Assured');
  assert.equal(p.assured, 0);
  assert.equal(p.express, 0, 'Express only while Bazaario Direct has the best offer');
  // Pausing the offer gives the best offer back to Direct.
  assert.equal((await c.call('PATCH', `/seller/offers/${r.data.id}`, { active: false })).status, 200);
  assert.equal((await client().call('GET', '/products/16')).data.product.price, 129900);

  // Mobiles are for brands and Bazaario Direct only.
  assert.equal((await c.call('POST', '/seller/offers', { productId: 3, price: 7000, stock: 5 })).status, 403);
  const cat = (await c.call('GET', '/seller/catalog?q=Volt')).data.products;
  assert.equal(cat[0].allowed, false);
  // Rice needs a best-before month.
  assert.match((await c.call('POST', '/seller/offers', { productId: 33, price: 270, stock: 5 })).data.error, /Best before/);
  assert.equal((await c.call('POST', '/seller/offers', { productId: 33, price: 270, stock: 5, bestBefore: '2099-01' })).status, 201);

  // Bulk sheet: one good row, one bad row.
  const bulk = (await c.call('POST', '/seller/offers/bulk', { csv: 'product_id,price,stock,dispatch_days\n33,265,9,2\n16,999999,1,1\n' })).data.results;
  assert.deepEqual(bulk.map((x) => x.ok), [true, false]);
  assert.equal(bulk[0].action, 'updated');
  const listings = (await c.call('GET', '/seller/listings')).data.listings;
  assert.equal(listings.find((l) => l.product_id === 33).stock, 9);
});

test('new listings: automatic checks, duplicate match, then Studio quality check', async () => {
  const { c } = await seller();
  const base = { title: 'Handwoven Cotton Table Runner, 6 Seater', brand: 'LoomCraft', categoryId: 4, mrp: 1200, price: 799, stock: 10,
    description: 'Handwoven on traditional looms from soft cotton yarn. Fits a six seater table.', features: 'Cotton\n180 x 33 cm',
    specs: { Material: 'Cotton', Dimensions: '180 x 33 cm' } };
  const noPhoto = await c.call('POST', '/seller/products', { ...base, title: 'BEST PRICE TABLE RUNNER CALL 9876543210' });
  assert.equal(noPhoto.status, 400);
  assert.ok(noPhoto.data.details.problems.length >= 3);
  const { url } = (await c.call('POST', '/seller/uploads', { dataUrl: PHOTO })).data;
  const made = await c.call('POST', '/seller/products', { ...base, image: url });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.qcStatus, 'pending');
  assert.equal((await client().call('GET', `/products/${made.data.id}`)).status, 404, 'hidden until checked');

  const dupe = await c.call('POST', '/seller/products', { ...base, image: url, title: 'LoomCraft Handwoven Cotton Table Runner 6 Seater' });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.data.details.matches[0].id, made.data.id);

  const a = await admin();
  const qc = (await a.call('GET', '/admin/qc')).data.products;
  assert.ok(qc.some((p) => p.id === made.data.id && p.problems.length === 0));
  assert.equal((await a.call('PATCH', `/admin/qc/${made.data.id}`, { action: 'approve' })).status, 200);
  const live = (await client().call('GET', `/products/${made.data.id}`)).data.product;
  assert.equal(live.price, 79900);
  assert.equal(live.specs.Material, 'Cotton');
  assert.equal(live.offers[0].seller.name.startsWith('Test Shop'), true);
});

test('checkout: one order per seller, shared payment; seller accepts, packs with courier, ships; invoice and label', async () => {
  const { c: sc, id: sellerId } = await seller();
  const offer = (await sc.call('POST', '/seller/offers', { productId: 26, price: 2299, stock: 4, dispatchDays: 2 })).data.id; // cricket bat
  const b = await user();
  const addressId = await address(b, 'Karnataka', '560001');
  await b.call('POST', '/cart', { productId: 26, qty: 1 }); // best offer: the new seller
  await b.call('POST', '/cart', { productId: 21, qty: 1 }); // ₹699 cookbook from Bazaario Direct
  const q = (await b.call('POST', '/checkout/quote', { addressId, paymentMethod: 'upi', coupon: 'SAVE100' })).data;
  assert.equal(q.packages.length, 2);
  assert.ok(q.packages.find((p) => p.sellerId === sellerId).promisedAt > q.packages.find((p) => p.sellerId !== sellerId).promisedAt,
    'two-day dispatch arrives later');
  const placed = await b.call('POST', '/orders', { addressId, paymentMethod: 'upi', coupon: 'SAVE100', payment: { upiId: 'asha@okbank' } });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  assert.equal(placed.data.orders.length, 2);
  const mine = (await b.call('GET', `/orders?ref=${placed.data.checkoutRef}`)).data.orders;
  assert.equal(mine.length, 2);
  assert.equal(mine.reduce((s, o) => s + o.total, 0), q.total, 'the split adds up to what was paid');
  const sellerOrder = mine.find((o) => o.seller_name.startsWith('Test Shop'));
  const directOrder = mine.find((o) => o.seller_name === 'Bazaario Direct');
  assert.equal(directOrder.status, 'confirmed');
  assert.equal(sellerOrder.status, 'placed', 'waits for the seller to accept');
  const so = (await b.call('GET', `/orders/${sellerOrder.id}`)).data.order;
  assert.equal(so.payment_ref, (await b.call('GET', `/orders/${directOrder.id}`)).data.order.payment_ref, 'one payment');
  assert.equal(so.packages, 2);

  const inbox = (await sc.call('GET', '/seller/orders?view=accept')).data.orders;
  assert.equal(inbox[0].id, sellerOrder.id);
  assert.equal(inbox[0].address.line1, undefined, 'buyer details stay hidden until accepted');
  assert.equal((await sc.call('POST', `/seller/orders/${sellerOrder.id}/pack`)).status, 400, 'accept first');
  assert.equal((await sc.call('GET', `/seller/orders/${sellerOrder.id}/documents`)).status, 400);
  assert.equal((await sc.call('POST', `/seller/orders/${sellerOrder.id}/accept`)).status, 200);
  assert.equal((await sc.call('POST', `/seller/orders/${sellerOrder.id}/pack`)).status, 200);
  const docs = (await sc.call('GET', `/seller/orders/${sellerOrder.id}/documents`)).data;
  assert.match(docs.label.awb, /^BZL\d{10}$/, 'courier booked at packing');
  assert.equal(docs.invoice.type, 'Tax invoice');
  assert.equal(docs.invoice.intraState, false, 'Maharashtra to Karnataka');
  assert.ok(docs.invoice.totals.igst > 0 && docs.invoice.totals.cgst === 0);
  assert.equal(docs.invoice.totals.total, so.subtotal - so.discount);
  assert.equal((await sc.call('POST', `/seller/orders/${sellerOrder.id}/ship`)).status, 200);
  const shipped = (await b.call('GET', `/orders/${sellerOrder.id}`)).data.order;
  assert.equal(shipped.status, 'shipped');
  assert.equal(shipped.awb, docs.label.awb);
  assert.equal((await b.call('GET', `/orders/${sellerOrder.id}/invoice`)).data.invoice.number, docs.invoice.number);
  // Direct's cookbook invoice comes from Bazaario, once it ships.
  assert.equal((await b.call('GET', `/orders/${directOrder.id}/invoice`)).status, 400);
  // Another seller cannot see this order.
  const other = await seller();
  assert.equal((await other.c.call('POST', `/seller/orders/${sellerOrder.id}/accept`)).status, 404);
  assert.ok(offer);
});

test('routing: a rejected order moves to the next seller at the same price or less; no one left means a refund', async () => {
  const { c: sc } = await seller();
  // The seller is dearer than Direct (₹349 book), so the buyer picks them on purpose.
  const offer = (await sc.call('POST', '/seller/offers', { productId: 20, price: 399, stock: 3 })).data.id;
  const b = await user();
  const addressId = await address(b);
  assert.equal((await b.call('POST', '/cart', { productId: 20, qty: 1, offerId: offer })).status, 201);
  const o1 = (await b.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } })).data;
  assert.equal((await sc.call('POST', `/seller/orders/${o1.orderId}/reject`, { reason: 'Out of stock' })).status, 200);
  const moved = (await b.call('GET', `/orders/${o1.orderId}`)).data.order;
  assert.equal(moved.seller.name, 'Bazaario Direct');
  assert.equal(moved.status, 'confirmed');
  assert.ok(moved.events.some((e) => e.status === 'rerouted'));

  // A seller cheaper than everyone else: when they do not answer, no one else matches the price, so it is refunded.
  const { c: s2, id: s2id } = await seller();
  await s2.call('POST', '/seller/offers', { productId: 17, price: 499, stock: 3 }); // bottles: Direct ₹549, demo seller ₹579
  await b.call('POST', '/cart', { productId: 17, qty: 1 });
  const o2 = (await b.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } })).data;
  assert.equal((await b.call('GET', `/orders/${o2.orderId}`)).data.order.seller.id, s2id);
  assert.equal(routing.sweep(Date.now() + 25 * 3600_000), 1);
  const gone = (await b.call('GET', `/orders/${o2.orderId}`)).data.order;
  assert.equal(gone.status, 'cancelled');
  assert.equal(gone.payment_status, 'refunded');
  const stock = (await s2.call('GET', '/seller/listings')).data.listings.find((l) => l.product_id === 17).stock;
  assert.equal(stock, 3, 'stock went back to the seller');
});

test('Value sellers sell only within their state; risky orders are held', async () => {
  // Demo seller Jaipur Craft House (Rajasthan, Value) sells the kurta (product 12).
  const p = (await client().call('GET', '/products/12')).data.product;
  const value = p.offers.find((o) => o.seller.lane === 'value');
  assert.ok(value.extraDays >= 3, 'economy shipping adds days');
  const b = await user();
  const addressId = await address(b);
  await b.call('POST', '/cart', { productId: 12, qty: 1, offerId: value.id });
  const q = (await b.call('POST', '/checkout/quote', { addressId, paymentMethod: 'upi' })).data;
  assert.match(q.blocked[0], /only within Rajasthan/);
  assert.equal((await b.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } })).status, 409);

  await b.call('POST', '/cart', { productId: 11, qty: 6 });
  await b.call('DELETE', '/cart/12');
  const held = (await b.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } })).data;
  const a = await admin();
  const board = (await a.call('GET', '/admin/orders?status=held')).data.orders;
  assert.match(board.find((o) => o.id === held.orderId).hold_reason, /Bulk order/);
  assert.equal((await b.call('GET', `/orders/${held.orderId}`)).data.order.hold_reason, 'review', 'buyers do not see the rule');
});

test('payouts: held for the return window, then item price minus commission, fees, GST on fees, TCS and TDS', async () => {
  const { c: sc, id: sellerId } = await seller();
  const offer = (await sc.call('POST', '/seller/offers', { productId: 13, price: 1000, stock: 5, dispatchDays: 1 })).data.id; // fashion: 15%
  const b = await user();
  const addressId = await address(b);
  await b.call('POST', '/cart', { productId: 13, qty: 2, offerId: offer });
  const o = (await b.call('POST', '/orders', { addressId, paymentMethod: 'cod' })).data;
  await sc.call('POST', `/seller/orders/${o.orderId}/accept`);
  await sc.call('POST', `/seller/orders/${o.orderId}/pack`);
  await sc.call('POST', `/seller/orders/${o.orderId}/ship`);
  const a = await admin();
  for (const s of ['out_for_delivery', 'delivered']) assert.equal((await a.call('PATCH', `/admin/orders/${o.orderId}`, { status: s })).status, 200);

  let pay = (await sc.call('GET', '/seller/payouts')).data;
  const line = pay.upcoming.lines.find((l) => l.orderId === o.orderId);
  assert.equal(line.ready, false, 'inside the return window');
  // ₹2,000 of shoes: 15% commission ₹300, pickup fee ₹40, 18% GST on ₹340 = ₹61.20,
  // TCS 0.5% of the taxable value (₹2,000 / 1.05 = ₹1,904.76) = ₹9.52, TDS 0.1% of ₹2,000 = ₹2.
  assert.deepEqual([line.gross, line.commission, line.fees, line.gstOnFees, line.tcs, line.tds], [200000, 30000, 4000, 6120, 952, 200]);
  assert.equal(line.net, 200000 - 30000 - 4000 - 6120 - 952 - 200);
  assert.equal((await a.call('POST', '/admin/settlement/run')).data.payouts.filter((p) => p.sellerId === sellerId).length, 0);

  db.get().prepare('UPDATE orders SET delivered_at = ? WHERE id = ?').run(Date.now() - 11 * 86400_000, o.orderId);
  const run = (await a.call('POST', '/admin/settlement/run')).data.payouts.find((p) => p.sellerId === sellerId);
  assert.equal(run.net, line.net);
  pay = (await sc.call('GET', '/seller/payouts')).data;
  assert.equal(pay.payouts[0].lines[0].order_no, (await b.call('GET', `/orders/${o.orderId}`)).data.order.order_no);
  assert.match(pay.payouts[0].utr, /^TESTUTR/);
  assert.equal((await a.call('POST', '/admin/settlement/run')).data.payouts.filter((p) => p.sellerId === sellerId).length, 0, 'paid once');
  const rec = (await a.call('GET', '/admin/settlement')).data.reconciliation;
  assert.ok(rec.some((r) => r.payouts >= line.net && r.tds >= 200));
});

test('claims and score: a used return earns a claim credit; rejected orders lower the score; suspension hides offers', async () => {
  const { c: sc, id: sellerId } = await seller({ fulfilment: 'self' });
  const offer = (await sc.call('POST', '/seller/offers', { productId: 15, price: 449, stock: 20, dispatchDays: 1 })).data.id; // wallet
  const b = await user();
  const addressId = await address(b);
  const a = await admin();
  const buy = async () => {
    await b.call('POST', '/cart', { productId: 15, qty: 1, offerId: offer });
    return (await b.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } })).data.orderId;
  };
  // Self Ship: the seller enters their own courier and reports delivery.
  const id = await buy();
  await sc.call('POST', `/seller/orders/${id}/accept`);
  await sc.call('POST', `/seller/orders/${id}/pack`);
  assert.equal((await sc.call('POST', `/seller/orders/${id}/ship`, {})).status, 400, 'tracking number needed');
  assert.equal((await sc.call('POST', `/seller/orders/${id}/ship`, { courier: 'DTDC', awb: 'd1234567' })).status, 200);
  assert.equal((await b.call('GET', `/orders/${id}`)).data.order.awb, 'D1234567');
  for (const s of ['out_for_delivery', 'delivered']) assert.equal((await sc.call('POST', `/seller/orders/${id}/status`, { status: s })).status, 200);
  await b.call('POST', `/orders/${id}/return`, { reason: 'No longer needed' });
  const ret = (await a.call('GET', '/admin/returns')).data.returns.find((r) => r.order_id === id);
  await a.call('PATCH', `/admin/returns/${ret.id}`, { action: 'approve' });
  await a.call('PATCH', `/admin/returns/${ret.id}`, { action: 'refund' });
  assert.equal((await sc.call('POST', '/seller/claims', { orderId: id, reason: 'Item came back used', note: 'Scuffed and the tag was removed' })).status, 201);
  const claim = (await a.call('GET', '/admin/claims')).data.claims.find((c) => c.order_id === id);
  assert.equal((await a.call('PATCH', `/admin/claims/${claim.id}`, { action: 'approve', amount: 9999 })).status, 400, 'no more than the order');
  assert.equal((await a.call('PATCH', `/admin/claims/${claim.id}`, { action: 'approve', amount: 200 })).status, 200);
  const credit = (await a.call('POST', '/admin/settlement/run')).data.payouts.find((p) => p.sellerId === sellerId);
  assert.equal(credit.net, 20000);

  // Five more orders, two rejected: 2 faults out of 6 decided gives 100 - 150 x 0.33 = 50.
  for (let i = 0; i < 5; i++) {
    const oid = await buy();
    if (i < 2) await sc.call('POST', `/seller/orders/${oid}/reject`, { reason: 'Damaged in store' });
    else await sc.call('POST', `/seller/orders/${oid}/accept`);
  }
  const me = (await sc.call('GET', '/seller/me')).data;
  assert.equal(me.performance.decided, 6);
  assert.equal(me.seller.score, 50);

  assert.equal((await a.call('PATCH', `/admin/sellers/${sellerId}`, { action: 'suspend', note: 'Too many cancellations' })).status, 200);
  const p = (await client().call('GET', '/products/15')).data.product;
  assert.ok(!p.offers.some((o) => o.id === offer), 'suspended sellers are hidden');
  assert.equal((await sc.call('GET', '/seller/listings')).status, 403);
});
