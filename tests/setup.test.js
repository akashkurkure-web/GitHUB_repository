'use strict';
// A fresh store with no ADMIN_PASSWORD: the first visit to /admin creates the owner account.
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
delete process.env.ADMIN_PASSWORD;

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
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); db.close(); });

async function call(method, path, body, session = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.cookie) headers.Cookie = session.cookie;
  if (session.csrf && method !== 'GET') headers['X-CSRF-Token'] = session.csrf;
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  for (const set of res.headers.getSetCookie()) session.cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (data.csrfToken) session.csrf = data.csrfToken;
  return { status: res.status, data };
}

test('owner setup: the first visit to /admin creates the owner, then setup closes', async () => {
  assert.equal((await call('GET', '/auth/setup')).data.needed, true);
  assert.equal((await call('GET', '/admin/auth/me')).data.setupNeeded, true);
  assert.equal((await call('POST', '/admin/auth/setup', { name: 'Akash', email: 'owner@shop.in', password: 'short' })).status, 400);

  const owner = {};
  const r = await call('POST', '/admin/auth/setup', { name: 'Akash', email: 'Owner@Shop.in', password: 'ownerpass1' }, owner);
  assert.equal(r.status, 201);
  assert.equal(r.data.user.staffRole, 'owner', 'signed in straight away');
  assert.equal((await call('GET', '/admin/products', undefined, owner)).status, 200);

  assert.equal((await call('GET', '/auth/setup')).data.needed, false);
  assert.equal((await call('POST', '/admin/auth/setup', { name: 'Intruder', email: 'x@evil.in', password: 'intruder1' })).status, 409);
  assert.notEqual((await call('POST', '/auth/setup', { name: 'Intruder', email: 'x@evil.in', password: 'intruder1' })).status, 201, 'the old shop setup is gone');

  // Signing in to the shop with the owner's password gives a shopping session only.
  const shop = {};
  assert.equal((await call('POST', '/auth/login', { email: 'owner@shop.in', password: 'ownerpass1' }, shop)).status, 200);
  assert.equal((await call('GET', '/admin/products', undefined, shop)).status, 401);
});

test('owner setup: an existing shopper email needs that account\'s own password', async () => {
  db.get().prepare("UPDATE users SET role = 'customer', staff_role = NULL").run(); // back to a store with no owner
  assert.equal((await call('POST', '/auth/register', { name: 'Shopper', email: 'shopper@shop.in', password: 'shopper12' })).status, 201);
  assert.equal((await call('POST', '/admin/auth/setup', { name: 'Thief', email: 'shopper@shop.in', password: 'guessing1' })).status, 409);
  const r = await call('POST', '/admin/auth/setup', { name: 'Shop Owner', email: 'shopper@shop.in', password: 'shopper12' });
  assert.equal(r.status, 201);
  const u = db.get().prepare('SELECT role, staff_role FROM users WHERE email = ?').get('shopper@shop.in');
  assert.deepEqual({ ...u }, { role: 'admin', staff_role: 'owner' });
});
