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
const wallet = require('../src/wallet');
const winback = require('../src/winback');
const growth = require('../src/growth');
const { move } = require('../src/fulfilment');
const { createApp } = require('../server');

let server;
let base;
before(async () => {
  db.open(':memory:');
  seed({ log: () => {} });
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
  return { call };
}

let n = 0;
async function user(extra = {}) {
  const c = client();
  const email = `gr${++n}@example.com`;
  const r = await c.call('POST', '/auth/register', { name: 'Meera Joshi', email, password: 'secret123', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.id = db.get().prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  return c;
}
async function admin() {
  const a = client();
  assert.equal((await a.call('POST', '/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' })).status, 200);
  return a;
}
async function address(c, pincode = '411038') {
  const r = await c.call('POST', '/addresses', { fullName: 'Meera Joshi', phone: '9876543210', line1: '7 Karve Road', city: 'Pune', state: 'Maharashtra', pincode });
  assert.equal(r.status, 201);
  return r.data.id;
}
const productId = (title) => db.get().prepare('SELECT id FROM products WHERE title = ?').get(title).id;
const pay = { paymentMethod: 'upi', payment: { upiId: 'meera@okbank' } };
const deliver = (orderId) => db.tx((d) => move(d, orderId, 'delivered', { allowAny: true }));
const saleOf = (slug) => db.get().prepare('SELECT * FROM sales WHERE slug = ?').get(slug);
const saleItem = (slug, minPrice = 0) => db.get().prepare(`SELECT i.product_id, i.pct, p.price FROM sale_items i JOIN sales s ON s.id = i.sale_id
  JOIN products p ON p.id = i.product_id WHERE s.slug = ? AND p.price >= ? AND p.stock > 5
  AND i.product_id NOT IN (SELECT product_id FROM sale_items WHERE sale_id != s.id) ORDER BY i.pct DESC LIMIT 1`).get(slug, minPrice);

test('sale events: sale prices in the catalogue and bag, Bazaario pays the discount, sellers keep their price', async () => {
  const anon = client();
  const sales = (await anon.call('GET', '/sales')).data.sales;
  assert.ok(sales.find((s) => s.slug === 'utsav').live);
  assert.equal(sales.find((s) => s.slug === 'payday').live, false);

  const it = saleItem('utsav', 100000);
  const p = (await anon.call('GET', `/products/${it.product_id}`)).data.product;
  const off = growth.saleOff(it.price, it.pct);
  assert.equal(p.sale.pct, it.pct);
  assert.equal(p.sale.was, it.price);
  assert.equal(p.price, it.price - off);
  assert.equal(p.offers[0].price, p.offers[0].was - growth.saleOff(p.offers[0].was, it.pct));
  const page = (await anon.call('GET', '/sales/utsav')).data;
  assert.ok(page.sale.live && page.items.length > 5 && page.items.every((x) => x.sale && x.price < x.sale.was));

  const b = await user();
  const addressId = await address(b);
  await b.call('POST', '/cart', { productId: it.product_id, qty: 2 });
  const q = (await b.call('POST', '/checkout/quote', { addressId, ...pay })).data;
  assert.equal(q.saleDiscount, off * 2);
  assert.equal(q.total, q.subtotal - q.discount + q.shipping + q.expressFee + q.codFee);
  const placed = await b.call('POST', '/orders', { addressId, ...pay });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const o = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(placed.data.orderId);
  assert.equal(o.sale_discount, off * 2);
  assert.equal(o.discount, off * 2);
  const line = db.get().prepare('SELECT price FROM order_items WHERE order_id = ?').get(o.id);
  assert.equal(line.price, it.price, 'the seller is paid the full offer price');

  // A switched-off sale stops at once.
  const a = await admin();
  assert.equal((await a.call('PATCH', `/admin/sales/${saleOf('utsav').id}`, { active: false })).status, 200);
  assert.equal((await anon.call('GET', `/products/${it.product_id}`)).data.product.sale, undefined);
  await a.call('PATCH', `/admin/sales/${saleOf('utsav').id}`, { active: true });

  // Studio can create a sale; bad ones are refused.
  const now = Date.now();
  assert.equal((await a.call('POST', '/admin/sales', { name: 'Bad', slug: 'bad', startsAt: now, endsAt: now - 1, items: [{ productId: it.product_id, pct: 10 }] })).status, 400);
  assert.equal((await a.call('POST', '/admin/sales', { name: 'Weekend', slug: 'weekend', startsAt: now, endsAt: now + 86400_000, items: [] })).status, 400);
  const made = await a.call('POST', '/admin/sales', { name: 'Weekend Deals', slug: 'weekend', startsAt: now + 86400_000, endsAt: now + 3 * 86400_000, items: [{ productId: it.product_id, pct: 50 }] });
  assert.equal(made.status, 201);
  assert.equal((await a.call('POST', '/admin/sales', { name: 'Weekend Deals', slug: 'weekend', startsAt: now, endsAt: now + 1000, items: [{ productId: it.product_id, pct: 5 }] })).status, 409);
  assert.ok((await a.call('GET', '/admin/sales')).data.sales.some((s) => s.slug === 'utsav' && s.performance.orders >= 1));
  db.get().prepare('UPDATE sales SET active = 0 WHERE slug = ?').run('weekend');
});

test('Bazaario Plus: free delivery on small orders, lower Express fee, early sale access', async () => {
  const b = await user();
  const addressId = await address(b);
  assert.equal((await b.call('POST', '/plus/join', { plan: 'weekly', ...pay })).status, 400);
  assert.equal((await b.call('POST', '/plus/join', { plan: 'monthly', paymentMethod: 'cod' })).status, 400);

  // Before Plus: a small bag pays for delivery and the full Express fee.
  const wallet_ = productId('Leather Bi-fold Wallet for Men');
  db.get().prepare('DELETE FROM sale_items WHERE product_id = ?').run(wallet_);
  await b.call('POST', '/cart', { productId: wallet_, qty: 1 });
  let q = (await b.call('POST', '/checkout/quote', { addressId, ...pay })).data;
  assert.equal(q.shipping, 4000);
  assert.equal(q.plus, null);
  const exp = (await b.call('POST', '/checkout/quote', { addressId, ...pay, speed: 'express' })).data;
  assert.equal(exp.expressFee, 4900);

  const joined = await b.call('POST', '/plus/join', { plan: 'monthly', ...pay });
  assert.equal(joined.status, 201, JSON.stringify(joined.data));
  assert.ok(joined.data.member.endsAt - Date.now() > 27 * 86400_000);
  q = (await b.call('POST', '/checkout/quote', { addressId, ...pay })).data;
  assert.equal(q.shipping, 0);
  assert.equal(q.plus.shippingSaved, 4000);
  const exp2 = (await b.call('POST', '/checkout/quote', { addressId, ...pay, speed: 'express' })).data;
  assert.equal(exp2.expressFee, 1900);
  assert.equal(exp2.speeds.find((s) => s.speed === 'express').fee, 1900);
  assert.equal(exp2.plus.expressSaved, 3000);
  const placed = await b.call('POST', '/orders', { addressId, ...pay, speed: 'express' });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  assert.equal(db.get().prepare('SELECT plus FROM orders WHERE id = ?').get(placed.data.orderId).plus, 1);
  const mine = (await b.call('GET', '/plus')).data;
  assert.equal(mine.member.plan, 'monthly');
  assert.equal(mine.saved.amount, 3000 + 4000);

  // Joining again extends from the current end date; renewal can be turned off.
  const again = (await b.call('POST', '/plus/join', { plan: 'yearly', ...pay })).data;
  assert.equal(again.member.startsAt, joined.data.member.endsAt);
  assert.equal((await b.call('POST', '/plus/renewal', { autoRenew: false })).data.autoRenew, false);

  // Early access: the Payday Sale opens to Plus a day before everyone else.
  const pay_ = saleOf('payday');
  db.get().prepare('UPDATE sales SET starts_at = ?, ends_at = ? WHERE id = ?').run(Date.now() + 12 * 3600_000, Date.now() + 72 * 3600_000, pay_.id);
  const it = saleItem('payday');
  const other = client();
  assert.equal((await other.call('GET', `/products/${it.product_id}`)).data.product.sale, undefined);
  const early = (await b.call('GET', `/products/${it.product_id}`)).data.product;
  assert.ok(early.sale && early.sale.early);
  assert.ok((await other.call('GET', '/sales/payday')).data.items.every((x) => x.upcoming && !x.sale));
  assert.ok((await b.call('GET', '/sales/payday')).data.sale.early);
  db.get().prepare('UPDATE sales SET starts_at = ?, ends_at = ? WHERE id = ?').run(pay_.starts_at, pay_.ends_at, pay_.id);
  assert.ok((await (await admin()).call('GET', '/admin/plus')).data.members.length >= 1);
});

test('coupon campaigns: first order only, Plus only, dates and limits', async () => {
  const b = await user();
  const addressId = await address(b);
  const tv = productId('43" 4K Ultra HD Smart LED TV');
  await b.call('POST', '/cart', { productId: tv, qty: 1 });
  assert.match((await b.call('POST', '/checkout/quote', { addressId, ...pay, coupon: 'PLUS200' })).data.error, /Plus members/);
  const q = (await b.call('POST', '/checkout/quote', { addressId, ...pay, coupon: 'FIRST150' })).data;
  assert.equal(q.couponDiscount, 15000);
  assert.equal(q.discount, q.couponDiscount + q.saleDiscount);
  assert.equal((await b.call('POST', '/orders', { addressId, ...pay, coupon: 'FIRST150' })).status, 201);
  await b.call('POST', '/cart', { productId: tv, qty: 1 });
  assert.match((await b.call('POST', '/checkout/quote', { addressId, ...pay, coupon: 'FIRST150' })).data.error, /first order|already used/);

  const a = await admin();
  const now = Date.now();
  assert.equal((await a.call('POST', '/admin/coupons', { code: 'OLDSALE', kind: 'flat', value: 50, startsAt: now - 2 * 86400_000, endsAt: now - 86400_000 })).status, 201);
  assert.match((await b.call('POST', '/checkout/quote', { addressId, ...pay, coupon: 'OLDSALE' })).data.error, /has ended/);
  assert.equal((await a.call('POST', '/admin/coupons', { code: 'SOON', kind: 'flat', value: 50, startsAt: now + 86400_000 })).status, 201);
  assert.match((await b.call('POST', '/checkout/quote', { addressId, ...pay, coupon: 'SOON' })).data.error, /starts on/);
  assert.equal((await a.call('POST', '/admin/coupons', { code: 'ONCEONLY', kind: 'flat', value: 50, maxUses: 1 })).status, 201);
  assert.equal((await b.call('POST', '/orders', { addressId, ...pay, coupon: 'ONCEONLY' })).status, 201);
  const c = await user();
  const caddr = await address(c);
  await c.call('POST', '/cart', { productId: tv, qty: 1 });
  assert.match((await c.call('POST', '/checkout/quote', { addressId: caddr, ...pay, coupon: 'ONCEONLY' })).data.error, /fully used/);
  assert.equal((await a.call('POST', '/admin/coupons', { code: 'BADDATES', kind: 'flat', value: 50, startsAt: now, endsAt: now - 1 })).status, 400);
});

test('referrals: both people get ₹100 when the friend’s first order is delivered', async () => {
  const a = await user();
  const mine = (await a.call('GET', '/referrals')).data;
  assert.match(mine.code, /^[A-Z]{4}\d{4}$/);
  assert.equal((await a.call('GET', '/referrals')).data.code, mine.code, 'the code stays the same');

  const before = wallet.balance(a.id);
  const f = await user({ referralCode: mine.code.toLowerCase() });
  assert.equal(db.get().prepare('SELECT status FROM referrals WHERE referee_id = ?').get(f.id).status, 'pending');
  await user({ referralCode: 'ZZZZ0000' }); // unknown codes are ignored
  const addressId = await address(f);
  await f.call('POST', '/cart', { productId: productId('Assam Tea 1kg'), qty: 1 });
  const placed = (await f.call('POST', '/orders', { addressId, ...pay })).data;
  assert.equal(wallet.balance(a.id), before, 'nothing until delivery');
  deliver(placed.orderId);
  assert.equal(wallet.balance(a.id), before + 10000);
  assert.equal(wallet.balance(f.id), 10000);
  // A second delivery pays nothing more.
  await f.call('POST', '/cart', { productId: productId('Assam Tea 1kg'), qty: 1 });
  deliver((await f.call('POST', '/orders', { addressId, ...pay })).data.orderId);
  assert.equal(wallet.balance(a.id), before + 10000);
  const after_ = (await a.call('GET', '/referrals')).data;
  assert.equal(after_.friends[0].status, 'rewarded');
  assert.equal(after_.earned, 10000);
});

let shopN = 0;
const gstinFor = (stateCode, pan) => { const s = `${stateCode}${pan}1Z`; return s + kyc.gstinCheckChar(s); };
async function seller() {
  const s = await user();
  shopN += 1;
  const pan = `AAKCG${String(2000 + shopN)}M`;
  const r = await s.call('POST', '/seller/apply', {
    lane: 'standard', displayName: `Ad Shop ${shopN}`, legalName: `Ad Shop ${shopN} Private Limited`, phone: '9876501234',
    gstin: gstinFor('27', pan), pickupLine1: 'Unit 4, Hadapsar Industrial Estate', pickupCity: 'Pune', pickupState: 'Maharashtra',
    pickupPincode: '411013', accountNumber: '50100012345678', accountConfirm: '50100012345678', ifsc: 'HDFC0001234', fulfilment: 'pickup', agree: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await (await admin()).call('PATCH', `/admin/sellers/${r.data.seller.id}`, { action: 'approve' })).status, 200);
  return { c: s, id: r.data.seller.id };
}

test('sponsored listings: marked in search, charged per click once a day, taken from the payout', async () => {
  const { c: sc, id: sellerId } = await seller();
  const shirt = productId("Men's Cotton Slim Fit Casual Shirt");
  assert.equal((await sc.call('POST', '/seller/ads', { productId: shirt, bid: 5, dailyBudget: 100 })).status, 400, 'only products you sell');
  const offer = await sc.call('POST', '/seller/offers', { productId: shirt, price: 589, stock: 20 });
  assert.equal(offer.status, 201);
  assert.equal((await sc.call('POST', '/seller/ads', { productId: shirt, bid: 1, dailyBudget: 100 })).status, 400, 'bid too low');
  assert.equal((await sc.call('POST', '/seller/ads', { productId: shirt, bid: 40, dailyBudget: 320 })).status, 201);
  const camp = (await sc.call('GET', '/seller/ads')).data.campaigns[0];
  assert.equal(camp.bid, 4000);

  const anon = client();
  const list = (await anon.call('GET', '/products?q=shirt')).data;
  const ad = list.sponsored.find((x) => x.id === shirt);
  assert.ok(ad && ad.campaignId === camp.id);
  assert.equal((await anon.call('GET', '/products?q=shirt&page=2')).data.sponsored.length, 0);

  const b = await user();
  await b.call('POST', '/ads/click', { campaignId: camp.id });
  await b.call('POST', '/ads/click', { campaignId: camp.id });
  await sc.call('POST', '/ads/click', { campaignId: camp.id }); // the seller's own click
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM ad_clicks WHERE campaign_id = ?').get(camp.id).n, 1);
  assert.equal((await sc.call('GET', '/seller/ads')).data.unbilled, 4000);

  // Budget: ₹320 a day at ₹40 a click is 8 clicks; the ninth viewer is not charged and the ad stops showing.
  for (let k = 0; k < 9; k += 1) await (await user()).call('POST', '/ads/click', { campaignId: camp.id });
  assert.equal(growth.spentToday(db.get(), camp.id), 32000);
  assert.ok(!(await anon.call('GET', '/products?q=shirt')).data.sponsored.some((x) => x.campaignId === camp.id));
  assert.equal((await sc.call('PATCH', `/seller/ads/${camp.id}`, { status: 'paused' })).status, 200);

  // Spend comes off the next payout: an order delivered more than the return window ago.
  const addressId = await address(b);
  await b.call('POST', '/cart', { productId: shirt, qty: 2, offerId: offer.data.id });
  const placed = (await b.call('POST', '/orders', { addressId, ...pay })).data;
  const oid = placed.orders ? placed.orders.find((o) => db.get().prepare('SELECT seller_id FROM orders WHERE id = ?').get(o.id).seller_id === sellerId)?.id : placed.orderId;
  if (oid && db.get().prepare('SELECT seller_id FROM orders WHERE id = ?').get(oid).seller_id === sellerId) {
    deliver(oid);
    db.get().prepare('UPDATE orders SET delivered_at = ? WHERE id = ?').run(Date.now() - 30 * 86400_000, oid);
    const pay_ = (await (await admin()).call('POST', '/admin/settlement/run')).data.payouts.find((p) => p.sellerId === sellerId);
    assert.ok(pay_);
    assert.equal(db.get().prepare('SELECT ad_spend FROM payouts WHERE id = ?').get(pay_.id).ad_spend, 32000);
    assert.equal(growth.unbilledAdSpend(db.get(), sellerId), 0);
  } else {
    assert.fail('the seller should have the best offer on the shirt');
  }
  assert.ok((await (await admin()).call('GET', '/admin/ads')).data.campaigns.some((x) => x.id === camp.id && x.clicks === 8));
});

test('win-back messages: bag left behind, price drop and back in stock, once each, only with consent', async () => {
  const b = await user();
  const d = db.get();
  const lamp = productId('LED Desk Lamp with 3 Brightness Modes');
  const tea = productId('Assam Tea 1kg');
  await b.call('POST', '/cart', { productId: lamp, qty: 1 });
  await b.call('POST', '/wishlist', { productId: tea });
  d.prepare('UPDATE cart_items SET added_at = ? WHERE user_id = ?').run(Date.now() - 30 * 3600_000, b.id);
  const sent = () => d.prepare("SELECT body FROM notifications WHERE user_id = ? AND body LIKE '%Reply STOP%' ORDER BY id").all(b.id).map((x) => x.body);

  let out = db.tx((t) => winback.run(t));
  assert.ok(out.cart >= 1);
  assert.match(sent()[0], /your bag is waiting/);
  db.tx((t) => winback.run(t));
  assert.equal(sent().filter((s) => /bag is waiting/.test(s)).length, 1, 'not twice');

  // Price drop on a wishlist item.
  const price = d.prepare('SELECT price FROM products WHERE id = ?').get(tea).price;
  d.prepare('UPDATE products SET price = ? WHERE id = ?').run(Math.floor(price * 0.9), tea);
  out = db.tx((t) => winback.run(t));
  assert.equal(out.priceDrop, 1);
  assert.ok(sent().some((s) => /Price drop/.test(s)));

  // Turned off: nothing more is sent.
  assert.equal((await b.call('PATCH', '/account/preferences', { marketing: false })).data.marketing, false);
  d.prepare('UPDATE products SET price = ? WHERE id = ?').run(Math.floor(price * 0.7), tea);
  const count = sent().length;
  db.tx((t) => winback.run(t, Date.now() + 4 * 86400_000));
  assert.equal(sent().length, count);
  assert.equal((await b.call('GET', '/account/preferences')).data.marketing, false);
  d.prepare('UPDATE products SET price = ? WHERE id = ?').run(price, tea);
  assert.equal((await (await admin()).call('POST', '/admin/winback/run')).status, 200);
});

test('Studio reports: repeat rate, customer value, delivery speed and growth tools', async () => {
  const r = await (await admin()).call('GET', '/admin/reports?days=30');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const x = r.data;
  assert.equal(x.days, 30);
  assert.ok(x.customers.buyers >= 3 && x.customers.repeaters >= 1);
  assert.ok(x.customers.repeatRate > 0 && x.customers.repeatRate <= 1);
  assert.ok(x.customers.ltv > 0 && x.customers.aov > 0);
  assert.ok(x.bySpeed.some((s) => s.speed === 'express') && x.bySpeed.some((s) => s.speed === 'standard'));
  assert.ok(x.plus.some((p) => p.plus === 1));
  assert.ok(x.tools.sale.orders >= 1 && x.tools.ads.clicks >= 8 && x.tools.referrals.rewarded >= 1);
  assert.ok(x.categories.length >= 1);
  assert.equal((await client().call('GET', '/admin/reports')).status, 401);
});
