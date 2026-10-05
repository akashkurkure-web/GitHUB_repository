'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'bazaario-test-uploads');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../server');

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

/** Minimal cookie-aware client. */
function client() {
  let cookie = '';
  let csrf = null;
  const call = async (method, path, body, extraHeaders = {}) => {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (cookie) headers.Cookie = cookie;
    if (csrf && method !== 'GET' && !('X-CSRF-Token' in extraHeaders)) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const set of res.headers.getSetCookie()) {
      const pair = set.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const data = await res.json().catch(() => ({}));
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set csrf(v) { csrf = v; } };
}

let n = 0;
async function newCustomer() {
  const c = client();
  const r = await c.call('POST', '/auth/register', { name: 'Test User', email: `u${++n}@example.com`, password: 'secret123' });
  assert.equal(r.status, 201);
  return c;
}
async function withAddress(c) {
  const r = await c.call('POST', '/addresses', { fullName: 'Test User', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' });
  assert.equal(r.status, 201);
  return r.data.id;
}

test('catalog: categories, search, filters, product detail', async () => {
  const c = client();
  assert.equal((await c.call('GET', '/categories')).data.categories.length, 10);
  const s = await c.call('GET', '/products?q=watch');
  assert.ok(s.data.items.some((p) => /Watch/.test(p.title)));
  const cheap = await c.call('GET', '/products?max=500&sort=price-asc');
  assert.ok(cheap.data.items.every((p) => p.price <= 50000));
  const pd = await c.call('GET', '/products/1');
  assert.equal(pd.status, 200);
  assert.ok(Array.isArray(pd.data.product.features));
  assert.equal((await c.call('GET', '/products/99999')).status, 404);
});

test('security headers are set', async () => {
  const r = await client().call('GET', '/categories');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('SQL injection attempts are treated as plain text', async () => {
  const r = await client().call('GET', `/products?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 0);
});

test('auth: register validation, duplicate email, login, generic errors', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/auth/register', { name: 'A B', email: 'weak@example.com', password: 'short' })).status, 400);
  assert.equal((await c.call('POST', '/auth/register', { name: 'A B', email: 'not-an-email', password: 'secret123' })).status, 400);
  assert.equal((await c.call('POST', '/auth/register', { name: 'A B', email: 'dup@example.com', password: 'secret123' })).status, 201);
  assert.equal((await client().call('POST', '/auth/register', { name: 'A B', email: 'DUP@example.com', password: 'secret123' })).status, 409);

  const unknown = await client().call('POST', '/auth/login', { email: 'nobody@example.com', password: 'secret123' });
  const wrong = await client().call('POST', '/auth/login', { email: 'dup@example.com', password: 'wrong1234' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, wrong.data.error, 'no user enumeration');

  const ok = client();
  const r = await ok.call('POST', '/auth/login', { email: 'dup@example.com', password: 'secret123' });
  assert.equal(r.status, 200);
  assert.ok(!('password_hash' in r.data.user));
});

test('auth: session cookie is HttpOnly + SameSite', async () => {
  const res = await fetch(base + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cookie Test', email: 'cookie@example.com', password: 'secret123' }),
  });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
});

test('auth: account locks after 5 failed attempts', async () => {
  await client().call('POST', '/auth/register', { name: 'Lock Me', email: 'lock@example.com', password: 'secret123' });
  for (let i = 0; i < 5; i++) await client().call('POST', '/auth/login', { email: 'lock@example.com', password: 'badpass99' });
  const r = await client().call('POST', '/auth/login', { email: 'lock@example.com', password: 'secret123' });
  assert.equal(r.status, 423);
});

test('CSRF: missing token and cross-origin requests are rejected', async () => {
  const c = await newCustomer();
  const noToken = await c.call('POST', '/cart', { productId: 1 }, { 'X-CSRF-Token': '' });
  assert.equal(noToken.status, 403);
  const xorigin = await c.call('POST', '/cart', { productId: 1 }, { Origin: 'https://evil.example' });
  assert.equal(xorigin.status, 403);
  assert.equal((await c.call('POST', '/cart', { productId: 1 })).status, 201);
});

test('access control: auth required, admin only, no IDOR', async () => {
  assert.equal((await client().call('GET', '/cart')).status, 401);
  const a = await newCustomer();
  const b = await newCustomer();
  assert.equal((await a.call('GET', '/admin/stats')).status, 403);

  const addr = await withAddress(a);
  await a.call('POST', '/cart', { productId: 3, qty: 1 });
  const order = await a.call('POST', '/orders', { addressId: addr, paymentMethod: 'cod' });
  assert.equal(order.status, 201);
  assert.equal((await b.call('GET', `/orders/${order.data.orderId}`)).status, 404, 'B cannot read A\'s order');
  assert.equal((await b.call('POST', `/orders/${order.data.orderId}/cancel`)).status, 404);
  await b.call('DELETE', `/addresses/${addr}`);
  assert.equal((await a.call('GET', '/addresses')).data.addresses.length, 1, 'B cannot delete A\'s address');
  // B cannot ship to A's address.
  await b.call('POST', '/cart', { productId: 3 });
  assert.equal((await b.call('POST', '/orders', { addressId: addr, paymentMethod: 'cod' })).status, 400);
});

test('cart: stock and per-item limits enforced server-side', async () => {
  const c = await newCustomer();
  assert.equal((await c.call('POST', '/cart', { productId: 1, qty: 11 })).status, 400);
  const lowStock = (await c.call('GET', '/products?sort=price-desc&limit=1')).data.items[0]; // 12-20 units
  const r = await c.call('POST', '/cart', { productId: lowStock.id, qty: 10 });
  assert.equal(r.status, 201);
  assert.equal((await c.call('PATCH', `/cart/${lowStock.id}`, { qty: 0 })).status, 400);
});

test('checkout: server computes price, coupon, shipping; card data not stored', async () => {
  const c = await newCustomer();
  const addressId = await withAddress(c);
  const p = (await c.call('GET', '/products/5')).data.product; // ₹2,999 earbuds
  await c.call('POST', '/cart', { productId: p.id, qty: 1, price: 1 }); // client price ignored

  const q = await c.call('POST', '/checkout/quote', { coupon: 'WELCOME10' });
  assert.equal(q.data.subtotal, p.price);
  assert.equal(q.data.discount, 20000, '10% capped at ₹200');
  assert.equal(q.data.shipping, 0);
  assert.equal(q.data.total, p.price - 20000);

  assert.equal((await c.call('POST', '/orders', { addressId, paymentMethod: 'card', payment: { cardNumber: '4111111111111112', expiry: '12/30', cvv: '123' } })).status, 400, 'Luhn check');
  assert.equal((await c.call('POST', '/orders', { addressId, paymentMethod: 'card', payment: { cardNumber: '4111111111111111', expiry: '01/20', cvv: '123' } })).status, 400, 'expired');

  const key = 'test-key-123456';
  const order = await c.call('POST', '/orders', {
    addressId, paymentMethod: 'card', coupon: 'WELCOME10', idempotencyKey: key,
    payment: { cardNumber: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' },
  });
  assert.equal(order.status, 201);
  assert.equal(order.data.total, p.price - 20000);
  const dup = await c.call('POST', '/orders', { addressId, paymentMethod: 'card', idempotencyKey: key, payment: {} });
  assert.equal(dup.data.orderId, order.data.orderId, 'idempotent');

  const detail = (await c.call('GET', `/orders/${order.data.orderId}`)).data.order;
  assert.equal(detail.payment_status, 'paid');
  assert.match(detail.payment_ref, /^CARD-xxxx1111-/);
  assert.ok(!JSON.stringify(detail).includes('4111111111111111'));
  assert.equal((await c.call('GET', '/cart')).data.count, 0, 'cart emptied');
  assert.equal((await c.call('GET', '/products/5')).data.product.stock, p.stock - 1, 'stock decremented');
});

test('orders: cancel restocks; admin fulfilment; return window; verified review', async () => {
  const admin = client();
  assert.equal((await admin.call('POST', '/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' })).status, 200);

  const c = await newCustomer();
  const addressId = await withAddress(c);
  const before = (await c.call('GET', '/products/20')).data.product.stock;
  await c.call('POST', '/cart', { productId: 20, qty: 2 });
  const o1 = (await c.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'test@okbank' } })).data;
  assert.equal((await c.call('POST', `/orders/${o1.orderId}/cancel`)).data.order.status, 'cancelled');
  assert.equal((await c.call('GET', '/products/20')).data.product.stock, before);

  await c.call('POST', '/cart', { productId: 20, qty: 1 });
  const o2 = (await c.call('POST', '/orders', { addressId, paymentMethod: 'cod' })).data;
  assert.equal((await admin.call('PATCH', `/admin/orders/${o2.orderId}`, { status: 'delivered' })).status, 400, 'cannot skip steps');
  for (const s of ['packed', 'shipped', 'out_for_delivery', 'delivered']) {
    assert.equal((await admin.call('PATCH', `/admin/orders/${o2.orderId}`, { status: s })).status, 200);
  }
  const delivered = (await c.call('GET', `/orders/${o2.orderId}`)).data.order;
  assert.equal(delivered.payment_status, 'paid', 'COD collected on delivery');
  assert.equal((await c.call('POST', `/orders/${o2.orderId}/cancel`)).status, 400);

  const rv = await c.call('POST', '/products/20/reviews', { rating: 5, title: 'Great book', body: 'Really enjoyed reading this one.' });
  assert.equal(rv.status, 201);
  assert.equal(rv.data.verified, true);
  assert.equal((await c.call('POST', '/products/20/reviews', { rating: 4, title: 'Again', body: 'Trying to review twice.' })).status, 409);

  assert.equal((await c.call('POST', `/orders/${o2.orderId}/return`)).status, 400, 'reason required');
  assert.equal((await c.call('POST', `/orders/${o2.orderId}/return`, { reason: 'No longer needed' })).data.order.status, 'return_requested');
  const audit = (await admin.call('GET', '/admin/audit')).data.entries;
  assert.ok(audit.some((e) => e.action === 'order.return_request'));
});

test('admin: product validation and soft delete', async () => {
  const admin = client();
  await admin.call('POST', '/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  const bad = await admin.call('POST', '/admin/products', { title: 'Thing', brand: 'X', categoryId: 1, price: 200, mrp: 100, stock: 5 });
  assert.equal(bad.status, 400);
  const ok = await admin.call('POST', '/admin/products', { title: '<img src=x onerror=alert(1)>', brand: 'X', categoryId: 1, price: 100, mrp: 200, stock: 5 });
  assert.equal(ok.status, 201);
  // Stored verbatim as data; the frontend renders it via textContent, never as HTML.
  assert.equal((await admin.call('GET', `/products/${ok.data.id}`)).data.product.title, '<img src=x onerror=alert(1)>');
  await admin.call('DELETE', `/admin/products/${ok.data.id}`);
  assert.equal((await client().call('GET', `/products/${ok.data.id}`)).status, 404);
});

test('password change signs out other sessions', async () => {
  const email = 'pwchange@example.com';
  const a = client();
  await a.call('POST', '/auth/register', { name: 'Pw Change', email, password: 'secret123' });
  const b = client();
  await b.call('POST', '/auth/login', { email, password: 'secret123' });
  assert.equal((await a.call('POST', '/auth/change-password', { currentPassword: 'secret123', newPassword: 'newsecret456' })).status, 200);
  assert.equal((await b.call('GET', '/cart')).status, 401);
  assert.equal((await a.call('GET', '/cart')).status, 200);
});

test('installable app: manifest, icons and service worker are served', async () => {
  const root = base.replace(/\/api$/, '');
  const m = await fetch(`${root}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await m.json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.equal((await fetch(`${root}/${icon.src}`)).status, 200);
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  const sw = await fetch(`${root}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${root}/offline.html`)).status, 200);
});

test('admin: product photos are validated, stored and shown on the product', async () => {
  const admin = client();
  await admin.call('POST', '/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  // Smallest valid JPEG header followed by padding.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const up = await admin.call('POST', '/admin/uploads', { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
  assert.equal(up.status, 201);
  assert.match(up.data.url, /^\/uploads\/products\/[a-z0-9-]+\.jpg$/);
  // A file that only claims to be an image is refused.
  const fake = await admin.call('POST', '/admin/uploads', { dataUrl: `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}` });
  assert.equal(fake.status, 400);
  // Customers cannot upload.
  const c = client();
  await c.call('POST', '/auth/register', { name: 'Photo Test', email: 'photo@example.com', password: 'secret123' });
  assert.equal((await c.call('POST', '/admin/uploads', { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` })).status, 403);

  const product = { title: 'Photo product', brand: 'X', categoryId: 1, price: 100, mrp: 200, stock: 5 };
  assert.equal((await admin.call('POST', '/admin/products', { ...product, image: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin.call('POST', '/admin/products', { ...product, image: 'http://example.com/a.jpg' })).status, 400);
  const made = await admin.call('POST', '/admin/products', { ...product, image: up.data.url });
  assert.equal(made.status, 201);
  assert.equal((await client().call('GET', `/products/${made.data.id}`)).data.product.image, up.data.url);
});
