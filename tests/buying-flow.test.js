'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'AdminPass123';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');
const { seed } = require('../src/seed');
const delivery = require('../src/delivery');
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
async function customer(phone) {
  const c = client();
  const r = await c.call('POST', '/auth/register', { name: 'Asha Rao', email: `flow${++n}@example.com`, phone, password: 'secret123' });
  assert.equal(r.status, 201);
  return c;
}
async function address(c, pincode = '411001') {
  const r = await c.call('POST', '/addresses', { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode });
  assert.equal(r.status, 201);
  return r.data.id;
}
async function admin() {
  const a = client();
  assert.equal((await a.call('POST', '/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' })).status, 200);
  return a;
}
const ship = async (a, id, steps) => {
  for (const s of steps) assert.equal((await a.call('PATCH', `/admin/orders/${id}`, { status: s })).status, 200, s);
};

test('delivery promise: Express in partner cities only, slower and no COD on the islands', async () => {
  const c = client();
  // Product 1 is an Express product, product 3 is not.
  const pune = (await c.call('GET', '/delivery?pincode=411001&products=1')).data;
  assert.equal(pune.city, 'Pune');
  assert.deepEqual(pune.options.map((o) => o.speed), ['express', 'standard']);
  const mixed = (await c.call('GET', '/delivery?pincode=411001&products=1,3')).data;
  assert.deepEqual(mixed.options.map((o) => o.speed), ['standard'], 'one non-Express item means Standard only');
  const nagpur = (await c.call('GET', '/delivery?pincode=440001&products=1')).data;
  assert.deepEqual(nagpur.options.map((o) => o.speed), ['standard']);
  const island = (await c.call('GET', '/delivery?pincode=744101')).data;
  assert.equal(island.cod, false);
  assert.ok(island.options[0].promisedAt > nagpur.options[0].promisedAt);
  assert.equal((await c.call('GET', '/delivery?pincode=12345')).status, 400);

  // Express promise: 90 minutes during rider hours, 10 am next morning late at night (times in IST).
  const noonIst = Date.UTC(2026, 9, 5, 6, 30);
  assert.equal(delivery.expressPromise(noonIst), noonIst + 90 * 60_000);
  const lateIst = Date.UTC(2026, 9, 5, 17, 30); // 11 pm IST
  assert.equal(delivery.expressPromise(lateIst), Date.UTC(2026, 9, 6, 4, 30)); // 10 am IST next day
});

test('checkout: Express adds its fee, is refused where unavailable, and creates a tracked order', async () => {
  const c = await customer();
  const pune = await address(c, '411001');
  const nagpur = await address(c, '440001');
  await c.call('POST', '/cart', { productId: 1, qty: 1 });

  const q = (await c.call('POST', '/checkout/quote', { addressId: pune, speed: 'express' })).data;
  assert.equal(q.speed, 'express');
  assert.equal(q.expressFee, 4900);
  assert.equal(q.total, q.subtotal + 4900);

  const refused = await c.call('POST', '/orders', { addressId: nagpur, speed: 'express', paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } });
  assert.equal(refused.status, 409);

  const o = await c.call('POST', '/orders', { addressId: pune, speed: 'express', paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } });
  assert.equal(o.status, 201);
  const order = (await c.call('GET', `/orders/${o.data.orderId}`)).data.order;
  assert.equal(order.status, 'confirmed');
  assert.equal(order.delivery_speed, 'express');
  assert.ok(order.promised_at > Date.now());
  assert.deepEqual(order.events.map((e) => e.status), ['placed', 'confirmed']);

  const a = await admin();
  await ship(a, order.id, ['packed', 'shipped']);
  const shipped = (await c.call('GET', `/orders/${order.id}`)).data.order;
  assert.equal(shipped.courier, 'Bazaario Express rider');
  assert.match(shipped.awb, /^EXP\d+$/);
  const msgs = (await a.call('GET', '/admin/messages')).data.messages.filter((m) => m.order_no === order.order_no);
  assert.ok(msgs.some((m) => m.channel === 'sms' && /picked up/.test(m.body)), 'buyer messaged when shipped');
  assert.ok(msgs.some((m) => m.channel === 'email' && /confirmed/.test(m.body)));
});

test('EMI: card plan only on orders above the minimum', async () => {
  const c = await customer();
  const addressId = await address(c);
  await c.call('POST', '/cart', { productId: 7, qty: 1 }); // ₹1,999 watch
  const card = { cardNumber: '4111111111111111', expiry: '12/30', cvv: '123', emiMonths: 6 };
  assert.equal((await c.call('POST', '/checkout/quote', { addressId })).data.emi.ok, false);
  assert.equal((await c.call('POST', '/orders', { addressId, paymentMethod: 'emi', payment: card })).status, 400);
  await c.call('DELETE', '/cart/7');
  await c.call('POST', '/cart', { productId: 6, qty: 1 }); // ₹58,990 laptop
  const o = await c.call('POST', '/orders', { addressId, paymentMethod: 'emi', payment: card });
  assert.equal(o.status, 201);
  const order = (await c.call('GET', `/orders/${o.data.orderId}`)).data.order;
  assert.equal(order.emi_months, 6);
  assert.match(order.payment_ref, /^EMI6-xxxx1111-/);
});

test('failed delivery: buyer picks a new time; two refused COD orders pause COD', async () => {
  const c = await customer();
  const addressId = await address(c);
  const a = await admin();
  for (let i = 0; i < 2; i++) {
    await c.call('POST', '/cart', { productId: 20, qty: 1 });
    const o = (await c.call('POST', '/orders', { addressId, paymentMethod: 'cod' })).data;
    if (i === 1) {
      // After one refused COD order, the next COD order is held for a person to check (routing risk rule).
      assert.equal((await c.call('GET', `/orders/${o.orderId}`)).data.order.hold_reason, 'review');
      assert.equal((await a.call('POST', `/admin/orders/${o.orderId}/release`)).status, 200);
    }
    await ship(a, o.orderId, ['packed', 'shipped', 'out_for_delivery', 'delivery_failed']);
    if (i === 0) {
      assert.equal((await c.call('POST', `/orders/${o.orderId}/reattempt`, { when: 'someday' })).status, 400);
      const r = await c.call('POST', `/orders/${o.orderId}/reattempt`, { when: 'evening', note: 'Call before coming' });
      assert.equal(r.status, 200);
      assert.equal(r.data.order.events.at(-1).status, 'reattempt_requested');
      const board = (await a.call('GET', '/admin/orders?status=delivery_failed')).data.orders;
      assert.match(board.find((x) => x.id === o.orderId).reattempt, /evening/);
      await ship(a, o.orderId, ['out_for_delivery', 'delivery_failed']);
    }
    await ship(a, o.orderId, ['rto']);
    const done = (await c.call('GET', `/orders/${o.orderId}`)).data.order;
    assert.equal(done.status, 'rto');
    assert.equal(done.payment_status, 'pending', 'no cash was collected');
  }
  await c.call('POST', '/cart', { productId: 20, qty: 1 });
  const q = (await c.call('POST', '/checkout/quote', { addressId, paymentMethod: 'cod' })).data;
  assert.equal(q.cod.ok, false);
  const blocked = await c.call('POST', '/orders', { addressId, paymentMethod: 'cod' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /paused/);
});

test('returns: approve pickup, refund to wallet, then spend the wallet at checkout', async () => {
  const c = await customer();
  const addressId = await address(c);
  const a = await admin();
  await c.call('POST', '/cart', { productId: 11, qty: 1 }); // ₹599 shirt
  const o = (await c.call('POST', '/orders', { addressId, paymentMethod: 'upi', payment: { upiId: 'asha@okbank' } })).data;
  await ship(a, o.orderId, ['packed', 'shipped', 'out_for_delivery', 'delivered']);

  assert.equal((await c.call('POST', `/orders/${o.orderId}/return`, { reason: 'Made up reason' })).status, 400);
  const r = await c.call('POST', `/orders/${o.orderId}/return`, { reason: 'Size or fit is not right', refundTo: 'wallet' });
  assert.equal(r.data.order.return.refund_to, 'wallet');
  assert.equal((await c.call('POST', `/orders/${o.orderId}/return`, { reason: 'No longer needed' })).status, 400, 'only once');

  const ret = (await a.call('GET', '/admin/returns')).data.returns.find((x) => x.order_id === o.orderId);
  assert.equal((await a.call('PATCH', `/admin/returns/${ret.id}`, { action: 'refund' })).status, 400, 'pickup comes first');
  assert.equal((await a.call('PATCH', `/admin/returns/${ret.id}`, { action: 'approve' })).status, 200);
  assert.equal((await a.call('PATCH', `/admin/returns/${ret.id}`, { action: 'refund' })).status, 200);

  const done = (await c.call('GET', `/orders/${o.orderId}`)).data.order;
  assert.equal(done.status, 'returned');
  assert.equal(done.payment_status, 'refunded');
  const w = (await c.call('GET', '/wallet')).data;
  assert.equal(w.balance, o.total);

  // Spend the wallet: a ₹449 wallet (product 15) is fully covered, so no other payment is needed.
  await c.call('POST', '/cart', { productId: 15, qty: 1 });
  const q = (await c.call('POST', '/checkout/quote', { addressId, useWallet: true })).data;
  assert.equal(q.payable, 0);
  const paid = await c.call('POST', '/orders', { addressId, useWallet: true, paymentMethod: 'upi' });
  assert.equal(paid.status, 201);
  const order = (await c.call('GET', `/orders/${paid.data.orderId}`)).data.order;
  assert.equal(order.payment_method, 'wallet');
  assert.equal(order.wallet_used, order.total);
  assert.equal((await c.call('GET', '/wallet')).data.balance, o.total - order.total);

  // Cancelling gives the wallet money back.
  await c.call('POST', `/orders/${paid.data.orderId}/cancel`);
  assert.equal((await c.call('GET', '/wallet')).data.balance, o.total);
});

test('returns: card refund goes back to the card; rejected return goes back to delivered', async () => {
  const c = await customer();
  const addressId = await address(c);
  const a = await admin();
  const card = { cardNumber: '4111111111111111', expiry: '12/30', cvv: '123' };
  const place = async () => {
    await c.call('POST', '/cart', { productId: 13, qty: 1 });
    const o = (await c.call('POST', '/orders', { addressId, paymentMethod: 'card', payment: card })).data;
    await ship(a, o.orderId, ['packed', 'shipped', 'out_for_delivery', 'delivered']);
    return o.orderId;
  };
  const id1 = await place();
  await c.call('POST', `/orders/${id1}/return`, { reason: 'Item is damaged or defective', refundTo: 'source' });
  const r1 = (await a.call('GET', '/admin/returns')).data.returns.find((x) => x.order_id === id1);
  await a.call('PATCH', `/admin/returns/${r1.id}`, { action: 'approve' });
  await a.call('PATCH', `/admin/returns/${r1.id}`, { action: 'refund' });
  const o1 = (await c.call('GET', `/orders/${id1}`)).data.order;
  assert.equal(o1.payment_status, 'refunded');
  assert.match(o1.events.at(-1).note, /sent to your CARD account/);
  assert.equal((await c.call('GET', '/wallet')).data.balance, 0);

  const id2 = await place();
  await c.call('POST', `/orders/${id2}/return`, { reason: 'No longer needed' });
  const r2 = (await a.call('GET', '/admin/returns')).data.returns.find((x) => x.order_id === id2);
  assert.equal((await a.call('PATCH', `/admin/returns/${r2.id}`, { action: 'reject' })).status, 400, 'reason required');
  assert.equal((await a.call('PATCH', `/admin/returns/${r2.id}`, { action: 'reject', note: 'Item was used' })).status, 200);
  assert.equal((await c.call('GET', `/orders/${id2}`)).data.order.status, 'delivered');
});

test('help centre: tickets, Studio replies, grievance acknowledged with a 30-day deadline', async () => {
  const c = await customer();
  const other = await customer();
  const a = await admin();
  assert.equal((await c.call('POST', '/tickets', { category: 'delivery', subject: 'Late', message: 'short' })).status, 400);
  const t = (await c.call('POST', '/tickets', { category: 'delivery', subject: 'Where is my parcel?', message: 'It was due yesterday and has not arrived.' })).data.ticket;
  assert.equal(t.status, 'open');
  assert.equal(t.messages.length, 2, 'automatic acknowledgement');
  assert.ok(t.due_at - Date.now() <= 24 * 3600_000);
  assert.equal((await other.call('GET', `/tickets/${t.id}`)).status, 404, 'no peeking at other buyers');
  assert.equal((await c.call('GET', '/admin/tickets')).status, 403);

  const reply = await a.call('POST', `/admin/tickets/${t.id}/reply`, { message: 'It is out for delivery today.' });
  assert.equal(reply.data.ticket.status, 'answered');
  const mine = (await c.call('GET', `/tickets/${t.id}`)).data.ticket;
  assert.equal(mine.messages.at(-1).author, 'agent');
  await c.call('POST', `/tickets/${t.id}/messages`, { message: 'Thank you!' });
  assert.equal((await c.call('POST', `/tickets/${t.id}/close`)).data.ticket.status, 'closed');
  assert.equal((await c.call('POST', `/tickets/${t.id}/messages`, { message: 'One more thing' })).status, 400);

  const g = (await c.call('POST', '/tickets', { category: 'grievance', subject: 'Refund not received', message: 'My refund for last month is still missing.' })).data.ticket;
  assert.match(g.messages[1].body, /Grievance Officer/);
  assert.ok(g.due_at - Date.now() > 29 * 86400_000);
  const cfg = (await client().call('GET', '/config')).data;
  assert.ok(cfg.grievanceOfficer.email);
  assert.equal(cfg.testMode.payments, true);
});

test('OTP sign-in: code works once, wrong codes are limited, resend is throttled', async () => {
  await customer('9123456780');
  const c = client();
  assert.equal((await c.call('POST', '/auth/otp/request', { phone: '9000000001' })).status, 404);
  const r = await c.call('POST', '/auth/otp/request', { phone: '9123456780' });
  assert.equal(r.status, 200);
  assert.match(r.data.testCode, /^\d{6}$/);
  assert.equal((await c.call('POST', '/auth/otp/request', { phone: '9123456780' })).status, 429);
  const wrong = r.data.testCode === '000000' ? '111111' : '000000';
  assert.equal((await c.call('POST', '/auth/otp/verify', { phone: '9123456780', code: wrong })).status, 401);
  const ok = await c.call('POST', '/auth/otp/verify', { phone: '9123456780', code: r.data.testCode });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.phone, '9123456780');
  assert.equal((await c.call('POST', '/auth/otp/verify', { phone: '9123456780', code: r.data.testCode })).status, 401, 'single use');

  // Five wrong tries burn the code, even if the right one comes next.
  db.get().prepare('UPDATE otp_codes SET sent_at = 0').run();
  const again = (await c.call('POST', '/auth/otp/request', { phone: '9123456780' })).data.testCode;
  db.get().prepare('UPDATE otp_codes SET attempts = 5 WHERE phone = ?').run('9123456780');
  assert.equal((await c.call('POST', '/auth/otp/verify', { phone: '9123456780', code: again })).status, 401);
});

test('upgrade: an orders table from the earlier version is migrated with its rows', () => {
  const old = new DatabaseSync(':memory:');
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT, role TEXT, failed_logins INTEGER, locked_until INTEGER, created_at INTEGER);
    CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT, image TEXT NOT NULL DEFAULT '');
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('placed','packed','shipped','delivered','cancelled','return_requested','returned')),
      subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, shipping INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
      coupon_code TEXT, payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','card','upi')),
      payment_status TEXT NOT NULL CHECK (payment_status IN ('pending','paid','refunded')), payment_ref TEXT, address TEXT NOT NULL,
      idempotency_key TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, delivered_at INTEGER, UNIQUE (user_id, idempotency_key));
    INSERT INTO users (id, name, email, password_hash, role, failed_logins, locked_until, created_at) VALUES (1, 'A', 'a@b.co', 'x', 'customer', 0, 0, 1);
    INSERT INTO orders (order_no, user_id, status, subtotal, total, payment_method, payment_status, address, created_at, updated_at)
      VALUES ('BZOLD-1', 1, 'shipped', 1000, 1000, 'cod', 'pending', '{}', 1, 1);`);
  // Run the real migration against this old database.
  db.migrate(old);
  const row = old.prepare('SELECT * FROM orders').get();
  assert.equal(row.order_no, 'BZOLD-1');
  assert.equal(row.delivery_speed, 'standard');
  assert.equal(row.wallet_used, 0);
  old.prepare("UPDATE orders SET status = 'out_for_delivery' WHERE id = ?").run(row.id);
  old.close();
});
