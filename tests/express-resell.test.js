'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'bazaario-test-uploads');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { seed } = require('../src/seed');
const routing = require('../src/routing');
const hyper = require('../src/hyperlocal');
const geo = require('../src/geo');
const { createApp } = require('../server');

let server;
let base;

before(async () => {
  db.open(':memory:');
  seed({ log: () => {} });
  // Tests run at any hour: keep the demo partner shop open all day.
  db.get().prepare("UPDATE sellers SET open_hour = 0, close_hour = 24 WHERE lane = 'shop'").run();
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
async function user() {
  const c = client();
  assert.equal((await c.call('POST', '/auth/register', { name: 'Neha Patil', email: `xr${++n}@example.com`, password: 'secret123' })).status, 201);
  return c;
}
async function admin() {
  const a = client();
  assert.equal((await a.call('POST', '/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' })).status, 200);
  return a;
}
async function address(c, pincode = '411038') {
  const r = await c.call('POST', '/addresses', { fullName: 'Neha Patil', phone: '9876543210', line1: '7 Karve Road', city: 'Pune', state: 'Maharashtra', pincode });
  assert.equal(r.status, 201);
  return r.data.id;
}
const productId = (title) => db.get().prepare('SELECT id FROM products WHERE title = ?').get(title).id;
const pay = { paymentMethod: 'upi', payment: { upiId: 'neha@okbank' } };

let shops = 0;
async function partnerShop(over = {}) {
  const s = await user();
  shops += 1;
  const r = await s.call('POST', '/seller/apply', {
    lane: 'shop', displayName: `Corner Store ${shops}`, legalName: `Corner Store ${shops}`, phone: '9876501234', pan: `BQZPK${1000 + shops}L`,
    pickupLine1: 'Shop 2, Paud Road, Kothrud', pickupCity: 'Pune', pickupState: 'Maharashtra', pickupPincode: '411038',
    radiusKm: 5, openHour: 0, closeHour: 24, accountNumber: '50100012345678', accountConfirm: '50100012345678', ifsc: 'HDFC0001234', agree: true, ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await (await admin()).call('PATCH', `/admin/sellers/${r.data.seller.id}`, { action: 'approve' })).status, 200);
  return { c: s, id: r.data.seller.id };
}

test('partner shops: sign-up checks, shown only nearby, never as the national best offer', async () => {
  const s = await user();
  const outside = await s.call('POST', '/seller/apply', {
    lane: 'shop', displayName: 'Nagpur Store', legalName: 'Nagpur Store', phone: '9876501234', pan: 'BQZPK9999L', pickupLine1: 'Main Road, Sitabuldi',
    pickupCity: 'Nagpur', pickupState: 'Maharashtra', pickupPincode: '440012', radiusKm: 3, openHour: 8, closeHour: 22,
    accountNumber: '50100012345678', accountConfirm: '50100012345678', ifsc: 'HDFC0001234', agree: true,
  });
  assert.equal(outside.status, 400);
  assert.match(outside.data.error, /Express runs in/);
  assert.equal((await s.call('POST', '/seller/apply', { lane: 'shop', radiusKm: 9 })).status, 400);

  const rice = productId('Premium Basmati Rice 5kg');
  const anon = client();
  const near = (await anon.call('GET', `/products/${rice}?pin=411038`)).data.product;
  assert.equal(near.nearby[0].sellerName, 'Kothrud Fresh Mart');
  assert.ok(near.nearby[0].ok && near.nearby[0].mins >= 12 && near.nearby[0].km <= 5);
  assert.ok(!near.offers.some((o) => o.seller.lane === 'shop'), 'shops are not in "Other sellers"');
  assert.equal(near.offers[0].seller.name, 'Bazaario Direct');
  // Far away in the same city, or in another city, the shop does not show.
  const far = geo.locate('411057');
  if (geo.distanceKm(far, hyper.shopPoint(db.get().prepare("SELECT * FROM sellers WHERE code = 'S0004'").get())) > 5) {
    assert.equal((await anon.call('GET', `/products/${rice}?pin=411057`)).data.product.nearby.length, 0);
  }
  assert.equal((await anon.call('GET', `/products/${rice}?pin=560001`)).data.product.nearby.length, 0);
  assert.equal((await anon.call('GET', `/products/${rice}`)).data.product.nearby.length, 0);

  // A closed shop is listed with its reason and cannot be bought from.
  db.get().prepare("UPDATE sellers SET accepting = 0 WHERE code = 'S0004'").run();
  const closed = (await anon.call('GET', `/products/${rice}?pin=411038`)).data.product.nearby[0];
  assert.equal(closed.ok, false);
  assert.match(closed.reason, /not taking orders/);
  db.get().prepare("UPDATE sellers SET accepting = 1 WHERE code = 'S0004'").run();
});

test('Express from a partner shop: 2-minute accept, rider assigned on packing, live position, delivered and paid next day', async () => {
  const { c: sc, id: shopId } = await partnerShop();
  const oil = productId('Cold Pressed Groundnut Oil 1L');
  const offer = (await sc.call('POST', '/seller/offers', { productId: oil, price: 270, stock: 10, bestBefore: '2027-06' })).data.id;
  assert.ok(offer);
  assert.equal((await sc.call('POST', '/seller/products', {})).status, 400, 'shops sell from the catalogue only');

  const b = await user();
  const addressId = await address(b);
  const nearby = (await b.call('GET', `/products/${oil}?pin=411038`)).data.product.nearby;
  const mine = nearby.find((x) => x.offerId === offer);
  assert.ok(mine && mine.ok, JSON.stringify(nearby));
  assert.equal((await b.call('POST', '/cart', { productId: oil, qty: 2, offerId: offer })).status, 201);
  // A national item in the same bag goes Standard; the shop package always goes Express.
  await b.call('POST', '/cart', { productId: productId('Assam Tea 1kg'), qty: 1 });
  const q = (await b.call('POST', '/checkout/quote', { addressId, ...pay })).data;
  const shopPack = q.packages.find((p) => p.sellerId === shopId);
  assert.equal(shopPack.speed, 'express');
  assert.equal(q.packages.find((p) => p.sellerId !== shopId).speed, 'standard');
  assert.ok(q.expressFee > 0, 'Express fee once');
  assert.ok(shopPack.promisedAt - Date.now() < 60 * 60000, 'within the hour');

  const placed = await b.call('POST', '/orders', { addressId, ...pay });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const orderId = placed.data.orders.find((o) => db.get().prepare('SELECT seller_id FROM orders WHERE id = ?').get(o.id).seller_id === shopId).id;
  const inbox = (await sc.call('GET', '/shop/orders')).data;
  const waiting = inbox.waiting.find((o) => o.id === orderId);
  assert.ok(waiting.acceptBy - Date.now() <= 2 * 60000 && waiting.acceptBy > Date.now());
  assert.equal(waiting.name, null, 'buyer name hidden until accepted');
  assert.equal((await sc.call('POST', `/seller/orders/${orderId}/accept`)).status, 200);
  assert.equal((await sc.call('GET', '/shop/orders')).data.preparing[0].id, orderId);
  assert.equal((await sc.call('POST', `/seller/orders/${orderId}/pack`)).status, 200);
  assert.equal((await sc.call('POST', `/seller/orders/${orderId}/ship`)).status, 400, 'the rider collects');

  let o = (await b.call('GET', `/orders/${orderId}`)).data.order;
  assert.equal(o.status, 'packed');
  assert.ok(o.rider && o.rider.name, 'a rider is on the way');
  assert.equal(o.rider.position.phase, 'to_pickup');
  assert.ok(o.rider.route.shop && o.rider.route.home);
  assert.equal(o.rider_fee, undefined, 'buyers do not see the rider fee');
  assert.ok(o.events.some((e) => e.status === 'rider_assigned'));

  const raw = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  hyper.tick(db, raw.eta_pickup + 1000);
  o = (await b.call('GET', `/orders/${orderId}`)).data.order;
  assert.equal(o.status, 'out_for_delivery');
  assert.match(o.courier, /Bazaario Express rider/);
  const picked = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  hyper.tick(db, picked.eta_drop + 1000);
  o = (await b.call('GET', `/orders/${orderId}`)).data.order;
  assert.equal(o.status, 'delivered');
  assert.equal(o.rider.position.phase, 'delivered');

  // Shops are paid the day after delivery: ₹540 minus 10% commission and GST on it, TDS 0.1%; no TCS without a GSTIN.
  const a = await admin();
  assert.equal((await a.call('POST', '/admin/settlement/run')).data.payouts.filter((p) => p.sellerId === shopId).length, 0);
  db.get().prepare('UPDATE orders SET delivered_at = ? WHERE id = ?').run(Date.now() - 86400_000 - 1000, orderId);
  const payout = (await a.call('POST', '/admin/settlement/run')).data.payouts.find((p) => p.sellerId === shopId);
  assert.equal(payout.net, 54000 - 5400 - 972 - 54);
  const earn = (await sc.call('GET', '/shop/earnings')).data;
  assert.equal(earn.payouts.length, 1);
  const me = (await sc.call('GET', '/shop/me')).data;
  assert.equal(me.shop.open, true);
  assert.equal(me.rules.acceptMins, 2);

  // The rider is paid for the trip.
  const riders = (await a.call('GET', '/admin/riders')).data;
  assert.ok(riders.riders.some((r) => r.unpaid > 0));
  const paid = (await a.call('POST', '/admin/riders/pay')).data.payouts;
  assert.ok(paid.length >= 1 && paid.every((x) => x.amount > 0));
});

test('a shop that does not accept in 2 minutes: the order moves to the nearest other shop, or is refunded', async () => {
  const { c: sc, id: shopId } = await partnerShop();
  const tea = productId('Assam Tea 1kg');
  const offer = (await sc.call('POST', '/seller/offers', { productId: tea, price: 460, stock: 5, bestBefore: '2027-06' })).data.id;
  const b = await user();
  const addressId = await address(b);
  await b.call('POST', '/cart', { productId: tea, qty: 1, offerId: offer });
  const placed = (await b.call('POST', '/orders', { addressId, ...pay })).data;
  assert.equal(db.get().prepare('SELECT seller_id FROM orders WHERE id = ?').get(placed.orderId).seller_id, shopId);
  assert.equal(routing.sweep(Date.now() + 3 * 60000), 1);
  const o = (await b.call('GET', `/orders/${placed.orderId}`)).data.order;
  assert.equal(o.seller.name, 'Kothrud Fresh Mart', 'the nearest other shop at the same price or less');
  assert.ok(o.events.some((e) => e.status === 'rerouted'));
  assert.equal((await sc.call('GET', '/shop/me')).data.today.missed, 1);

  // Settings: closing the shop hides it from buyers straight away.
  assert.equal((await sc.call('PATCH', '/shop/settings', { accepting: false })).data.shop.open, false);
  assert.equal((await sc.call('PATCH', '/shop/settings', { openHour: 22, closeHour: 8 })).status, 400);
  const list = (await b.call('GET', `/products/${tea}?pin=411038`)).data.product.nearby;
  assert.equal(list.find((x) => x.offerId === offer).ok, false);
});

test('resellers: join, share with a margin, buyer pays the shared price, seller keeps their price, reseller paid after the return window', async () => {
  const r = await user();
  assert.equal((await r.call('GET', '/reseller/shares')).status, 403);
  assert.equal((await r.call('POST', '/reseller/join', { displayName: 'Priya Styles', phone: '9811122233', upiId: 'not-upi', agree: true })).status, 400);
  const joined = await r.call('POST', '/reseller/join', { displayName: 'Priya Styles', phone: '9811122233', upiId: 'priya@okaxis', agree: true });
  assert.equal(joined.status, 201);
  assert.equal((await r.call('POST', '/reseller/join', { displayName: 'Again', phone: '9811122233', upiId: 'priya@okaxis', agree: true })).status, 409);

  const book = productId('The Indian Kitchen: 500 Home Recipes (Hardcover)'); // ₹699, MRP ₹999
  const cat = (await r.call('GET', '/reseller/catalog?q=Indian Kitchen')).data.items[0];
  assert.equal(cat.maxMargin, 20970, 'at most 30% of the price');
  assert.equal((await r.call('POST', '/reseller/shares', { productId: book, margin: 250 })).status, 400);
  const share = (await r.call('POST', '/reseller/shares', { productId: book, margin: 50 })).data.share;
  assert.match(share.code, /^SH[0-9A-F]{8}$/);
  assert.equal(share.sharePrice, 74900);

  const page = (await client().call('GET', `/share/${share.code}`)).data;
  assert.equal(page.product.price, 74900);
  assert.equal(page.share.resellerName, 'Priya Styles');
  assert.equal((await client().call('GET', '/share/SH00000000')).status, 404);

  const b = await user();
  const addressId = await address(b, '302001');
  db.get().prepare("UPDATE addresses SET state = 'Rajasthan', city = 'Jaipur' WHERE id = ?").run(addressId);
  assert.equal((await b.call('POST', '/cart', { productId: book, qty: 2, shareCode: share.code })).status, 201);
  const cart = (await b.call('GET', '/cart')).data;
  assert.equal(cart.lines[0].price, 74900);
  assert.equal(cart.lines[0].reseller_name, 'Priya Styles');
  const placed = (await b.call('POST', '/orders', { addressId, ...pay })).data;
  const item = db.get().prepare('SELECT * FROM order_items WHERE order_id = ?').get(placed.orderId);
  assert.equal(item.price, 74900);
  assert.equal(item.reseller_margin, 5000);

  const a = await admin();
  for (const s of ['packed', 'shipped', 'out_for_delivery', 'delivered']) {
    assert.equal((await a.call('PATCH', `/admin/orders/${placed.orderId}`, { status: s })).status, 200, s);
  }
  const inv = (await b.call('GET', `/orders/${placed.orderId}/invoice`)).data.invoice;
  assert.equal(inv.reseller.name, 'Priya Styles');
  let sales = (await r.call('GET', '/reseller/sales')).data;
  assert.equal(sales.sales[0].stage, 'window');
  assert.equal(sales.totals.window, 10000);
  assert.equal(sales.customers[0].name, 'Neha');
  assert.equal(sales.sales[0].customer, 'Neha, Jaipur', 'first name and city only');

  db.get().prepare('UPDATE orders SET delivered_at = ? WHERE id = ?').run(Date.now() - 11 * 86400_000, placed.orderId);
  const run = (await a.call('POST', '/admin/settlement/run')).data.resellerPayouts;
  assert.equal(run.length, 1);
  assert.deepEqual([run[0].gross, run[0].tds, run[0].net], [10000, 0, 10000]);
  const pays = (await r.call('GET', '/reseller/payouts')).data;
  assert.match(pays.payouts[0].utr, /^TESTUTR/);
  sales = (await r.call('GET', '/reseller/sales')).data;
  assert.equal(sales.totals.paid, 10000);
  assert.equal((await a.call('POST', '/admin/settlement/run')).data.resellerPayouts.length, 0, 'paid once');

  // A suspended reseller's links stop working, and the bag falls back to the Bazaario price.
  const id = (await a.call('GET', '/admin/resellers')).data.resellers.find((x) => x.display_name === 'Priya Styles').id;
  assert.equal((await a.call('PATCH', `/admin/resellers/${id}`, { action: 'suspend', note: 'Misleading posts' })).status, 200);
  assert.equal((await client().call('GET', `/share/${share.code}`)).status, 404);
  assert.equal((await b.call('POST', '/cart', { productId: book, qty: 1, shareCode: share.code })).status, 404);
  assert.equal((await r.call('GET', '/reseller/shares')).status, 403);
});
