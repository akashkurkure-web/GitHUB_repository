'use strict';
// Admin portal: email and password sign-in, the optional authenticator code, staff roles and accounts, idle sign-out.
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'AdminPass123';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../server');
const totp = require('../src/totp');
const config = require('../src/config');

let server;
let base;
before(async () => {
  db.open(':memory:');
  seed({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

/** Cookie-aware client that keeps every cookie by name, like a browser (paths ignored). */
function client() {
  const jar = new Map();
  let csrf = null;
  const call = async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(base + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const i = pair.indexOf('=');
      const [k, v] = [pair.slice(0, i), pair.slice(i + 1)];
      if (v) jar.set(k, v); else jar.delete(k);
    }
    const data = await res.json().catch(() => ({}));
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers };
  };
  return { call, jar, set csrf(v) { csrf = v; } };
}

const secrets = new Map();

/** Signs in to the portal: email and password, plus the new password or the app code when those are needed. */
async function signIn(c, email, password, { newPassword } = {}) {
  const r = await c.call('POST', '/admin/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (r.data.user) return r.data;
  // A code works only once; these tests sign in faster than a new code appears, so act as if 30 seconds passed.
  db.get().prepare('UPDATE users SET totp_last_step = 0 WHERE email = ?').run(email);
  const code = r.data.twoStep ? totp.codeAt(secrets.get(email), totp.stepAt()) : undefined;
  const ok = await c.call('POST', '/admin/auth/verify', { challenge: r.data.challenge, code, newPassword });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return ok.data;
}

/** Turns on the optional authenticator code from My account and returns the recovery codes. */
async function turnOnCode(c, email, password) {
  const start = await c.call('POST', '/admin/auth/authenticator', { password });
  assert.equal(start.status, 200);
  assert.match(start.data.enrol.uri, /^otpauth:\/\/totp\/Bazaario%20Admin%3A[^?]+\?secret=[A-Z2-7]+/);
  const secret = start.data.enrol.secret.replace(/\s/g, '');
  assert.equal((await c.call('POST', '/admin/auth/authenticator/confirm', { challenge: start.data.challenge, code: '000000' })).status, 400);
  const ok = await c.call('POST', '/admin/auth/authenticator/confirm', { challenge: start.data.challenge, code: totp.codeAt(secret, totp.stepAt()) });
  assert.equal(ok.status, 200);
  secrets.set(email, secret);
  return ok.data.recoveryCodes;
}

test('sign-in: email and password on one screen; a shopping session never opens the portal', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'nope12345' })).status, 401);
  const shopper = client();
  assert.equal((await shopper.call('POST', '/auth/register', { name: 'Shopper', email: 'buyer@x.in', password: 'buyer1234' })).status, 201);
  assert.equal((await shopper.call('POST', '/admin/auth/login', { email: 'buyer@x.in', password: 'buyer1234' })).status, 403);
  assert.equal((await shopper.call('GET', '/admin/stats')).status, 401);

  const ok = await c.call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.staffRole, 'owner', 'signed in straight away');
  assert.ok(c.jar.has('aid') && !c.jar.has('sid'), 'the portal has its own cookie');
  assert.match(ok.headers.get('set-cookie'), /Path=\/api\/admin;.*HttpOnly.*SameSite=Strict/i);
  assert.equal((await c.call('GET', '/admin/stats')).status, 200);
  assert.equal((await c.call('GET', '/admin/auth/me')).data.user.sections.length, 21);
  assert.equal((await c.call('GET', '/admin/auth/security')).data.twoStep, false);

  assert.equal((await c.call('POST', '/admin/auth/logout')).status, 200);
  assert.equal((await c.call('GET', '/admin/stats')).status, 401);
  const audit = db.get().prepare("SELECT action FROM audit_log WHERE action LIKE 'admin.%'").all().map((a) => a.action);
  for (const a of ['admin.login', 'admin.logout']) assert.ok(audit.includes(a), a);
});

test('optional authenticator code: on from My account, codes work once, recovery codes, off again', async () => {
  const c = client();
  await signIn(c, 'admin@bazaario.local', 'AdminPass123');
  assert.equal((await c.call('POST', '/admin/auth/authenticator', { password: 'wrong' })).status, 400);
  const recovery = await turnOnCode(c, 'admin@bazaario.local', 'AdminPass123');
  assert.equal(recovery.length, 10);
  const secret = secrets.get('admin@bazaario.local');

  // Now the password alone gives only a challenge.
  const r = await client().call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  assert.equal(r.data.twoStep, true);
  assert.equal(r.data.user, undefined);
  const w = client();
  assert.equal((await w.call('POST', '/admin/auth/verify', { challenge: r.data.challenge })).status, 401, 'code needed');
  const step = totp.stepAt() + 1;
  assert.equal((await w.call('POST', '/admin/auth/verify', { challenge: r.data.challenge, code: totp.codeAt(secret, step) })).status, 200);
  // The same code cannot be used again; a recovery code works once.
  const r2 = await client().call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  const again = client();
  assert.equal((await again.call('POST', '/admin/auth/verify', { challenge: r2.data.challenge, code: totp.codeAt(secret, step) })).status, 401);
  const viaRecovery = await again.call('POST', '/admin/auth/verify', { challenge: r2.data.challenge, code: recovery[0].toLowerCase() });
  assert.equal(viaRecovery.status, 200);
  assert.equal(viaRecovery.data.recoveryCodesLeft, 9);
  const r3 = await client().call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  assert.equal((await client().call('POST', '/admin/auth/verify', { challenge: r3.data.challenge, code: recovery[0] })).status, 401);
  // Five wrong codes end the challenge.
  const r4 = await client().call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' });
  for (let i = 0; i < 4; i++) assert.equal((await client().call('POST', '/admin/auth/verify', { challenge: r4.data.challenge, code: '111111' })).status, 401);
  assert.match((await client().call('POST', '/admin/auth/verify', { challenge: r4.data.challenge, code: '111111' })).data.error, /Too many wrong codes/);

  // Renew recovery codes, then turn the code off: sign-in is the password alone again.
  db.get().prepare("UPDATE users SET totp_last_step = 0 WHERE email = 'admin@bazaario.local'").run();
  const renew = await c.call('POST', '/admin/auth/recovery-codes', { code: totp.codeAt(secret, totp.stepAt()) });
  assert.equal(renew.data.recoveryCodes.length, 10);
  assert.equal((await c.call('POST', '/admin/auth/authenticator/off', { password: 'wrong' })).status, 400);
  assert.equal((await c.call('POST', '/admin/auth/authenticator/off', { password: 'AdminPass123' })).status, 200);
  assert.ok((await client().call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'AdminPass123' })).data.user);
  const audit = db.get().prepare("SELECT action FROM audit_log WHERE action LIKE 'admin.2fa%' OR action = 'admin.code_failed'").all().map((a) => a.action);
  for (const a of ['admin.2fa_on', 'admin.2fa_off', 'admin.code_failed']) assert.ok(audit.includes(a), a);
});

test('idle sign-out: 30 minutes without activity ends the portal session', async () => {
  const c = client();
  await signIn(c, 'admin@bazaario.local', 'AdminPass123');
  assert.equal((await c.call('GET', '/admin/stats')).status, 200);
  db.get().prepare('UPDATE sessions SET last_active = ? WHERE admin_ok = 1').run(Date.now() - config.adminIdleMs - 1000);
  const r = await c.call('GET', '/admin/stats');
  assert.equal(r.status, 401);
  assert.match(r.data.error, /signed out after 30 minutes/);
  assert.equal((await c.call('GET', '/admin/stats')).status, 401, 'the session is gone, not just paused');
});

test('staff: owner adds a manager and a support agent; roles limit what they can open', async () => {
  const owner = client();
  await signIn(owner, 'admin@bazaario.local', 'AdminPass123');
  const bad = await owner.call('POST', '/admin/staff', { name: 'Neha', email: 'neha@shop.in', staffRole: 'boss' });
  assert.equal(bad.status, 400);
  const m = await owner.call('POST', '/admin/staff', { name: 'Neha Manager', email: 'neha@shop.in', staffRole: 'manager' });
  assert.equal(m.status, 201);
  assert.ok(m.data.tempPassword.length >= 12);
  assert.equal((await owner.call('POST', '/admin/staff', { name: 'Dup', email: 'buyer@x.in', staffRole: 'support' })).status, 409);
  const s = await owner.call('POST', '/admin/staff', { name: 'Ravi Support', email: 'ravi@shop.in', staffRole: 'support' });
  assert.equal(s.status, 201);

  // First sign-in: the temporary password must be replaced.
  const mc = client();
  const r = await mc.call('POST', '/admin/auth/login', { email: 'neha@shop.in', password: m.data.tempPassword });
  assert.equal(r.data.mustChangePassword, true);
  assert.equal((await mc.call('POST', '/admin/auth/verify', { challenge: r.data.challenge })).status, 400, 'new password needed');
  assert.equal((await mc.call('POST', '/admin/auth/verify', { challenge: r.data.challenge, newPassword: m.data.tempPassword })).status, 400);
  const done = await mc.call('POST', '/admin/auth/verify', { challenge: r.data.challenge, newPassword: 'nehapass12' });
  assert.equal(done.status, 200);
  assert.equal(done.data.user.staffRole, 'manager');
  assert.ok(!done.data.user.sections.some((x) => ['staff', 'audit'].includes(x.key)));
  assert.equal((await mc.call('GET', '/admin/products')).status, 200);
  assert.equal((await mc.call('POST', '/admin/coupons', { code: 'MGR10', kind: 'percent', value: 10, minOrder: 0 })).status, 201);
  assert.equal((await mc.call('GET', '/admin/staff')).status, 403);
  assert.equal((await mc.call('GET', '/admin/audit')).status, 403);
  assert.equal((await client().call('POST', '/admin/auth/login', { email: 'neha@shop.in', password: m.data.tempPassword })).status, 401, 'temporary password no longer works');

  const sc = client();
  await signIn(sc, 'ravi@shop.in', s.data.tempPassword, { newPassword: 'ravipass12' });
  await turnOnCode(sc, 'ravi@shop.in', 'ravipass12');
  assert.equal((await sc.call('GET', '/admin/orders')).status, 200);
  assert.equal((await sc.call('GET', '/admin/tickets')).status, 200);
  assert.equal((await sc.call('GET', '/admin/returns')).status, 200);
  assert.equal((await sc.call('GET', '/admin/users')).status, 200);
  assert.equal((await sc.call('GET', '/admin/products')).status, 403);
  assert.equal((await sc.call('GET', '/admin/settlement')).status, 403);
  assert.equal((await sc.call('PATCH', '/admin/orders/1', { status: 'packed' })).status, 403, 'support reads orders but does not move them');
  assert.equal((await sc.call('POST', '/admin/coupons', { code: 'SUP10', kind: 'percent', value: 10, minOrder: 0 })).status, 403);
  assert.equal((await sc.call('GET', '/admin/staff')).status, 403);

  // Owner changes a role: it applies on the next request.
  const list = (await owner.call('GET', '/admin/staff')).data.staff;
  assert.equal(list.length, 3);
  const ravi = list.find((x) => x.email === 'ravi@shop.in');
  assert.equal(ravi.twoFactor, true);
  const me = list.find((x) => x.you);
  assert.equal((await owner.call('PATCH', `/admin/staff/${me.id}`, { staffRole: 'support' })).status, 400, 'cannot demote yourself');
  assert.equal((await owner.call('PATCH', `/admin/staff/${ravi.id}`, { staffRole: 'manager' })).status, 200);
  assert.equal((await sc.call('GET', '/admin/products')).status, 200);

  // Reset: signed out everywhere, new temporary password, authenticator code off.
  const reset = await owner.call('POST', `/admin/staff/${ravi.id}/reset`);
  assert.equal(reset.status, 200);
  assert.equal((await sc.call('GET', '/admin/orders')).status, 401);
  const rr = await client().call('POST', '/admin/auth/login', { email: 'ravi@shop.in', password: reset.data.tempPassword });
  assert.ok(rr.data.mustChangePassword && !rr.data.twoStep);

  // Remove: the account stays as a shopping account and cannot open the portal.
  assert.equal((await owner.call('DELETE', `/admin/staff/${ravi.id}`)).status, 200);
  assert.equal((await client().call('POST', '/admin/auth/login', { email: 'ravi@shop.in', password: reset.data.tempPassword })).status, 403);
  assert.equal(db.get().prepare('SELECT role FROM users WHERE id = ?').get(ravi.id).role, 'customer');
  assert.equal((await mc.call('GET', '/admin/staff')).status, 403);
});

test('my account: change password; move the code to a new phone', async () => {
  const c = client();
  await signIn(c, 'neha@shop.in', 'nehapass12');
  assert.equal((await c.call('POST', '/admin/auth/password', { currentPassword: 'wrong', newPassword: 'nehapass34' })).status, 400);
  assert.equal((await c.call('POST', '/admin/auth/password', { currentPassword: 'nehapass12', newPassword: 'nehapass34' })).status, 200);
  assert.equal((await c.call('GET', '/admin/stats')).status, 200, 'this session continues');

  await turnOnCode(c, 'neha@shop.in', 'nehapass34');
  const old = secrets.get('neha@shop.in');
  const move = await c.call('POST', '/admin/auth/authenticator', { password: 'nehapass34' });
  const fresh = move.data.enrol.secret.replace(/\s/g, '');
  const moved = await c.call('POST', '/admin/auth/authenticator/confirm', { challenge: move.data.challenge, code: totp.codeAt(fresh, totp.stepAt()) });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.recoveryCodes, undefined, 'moving keeps the recovery codes');
  secrets.set('neha@shop.in', fresh);
  const r = await client().call('POST', '/admin/auth/login', { email: 'neha@shop.in', password: 'nehapass34' });
  db.get().prepare("UPDATE users SET totp_last_step = 0 WHERE email = 'neha@shop.in'").run();
  assert.equal((await client().call('POST', '/admin/auth/verify', { challenge: r.data.challenge, code: totp.codeAt(old, totp.stepAt()) })).status, 401);
  await signIn(client(), 'neha@shop.in', 'nehapass34');
});

test('forgot password: owners use their reset key; staff cannot; a used key is replaced', async () => {
  const c = client();
  await signIn(c, 'admin@bazaario.local', 'AdminPass123');
  assert.equal((await c.call('GET', '/admin/auth/security')).data.hasResetKey, false);
  assert.equal((await c.call('POST', '/admin/auth/reset-key', { password: 'wrong' })).status, 400);
  const made = await c.call('POST', '/admin/auth/reset-key', { password: 'AdminPass123' });
  assert.match(made.data.resetKey, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  assert.equal((await c.call('GET', '/admin/auth/security')).data.hasResetKey, true);

  const f = client();
  assert.equal((await f.call('POST', '/admin/auth/forgot', { email: 'admin@bazaario.local', resetKey: 'AAAA-BBBB-CCCC-DDDD', newPassword: 'NewOwner123' })).status, 400);
  assert.equal((await f.call('POST', '/admin/auth/forgot', { email: 'admin@bazaario.local', resetKey: made.data.resetKey, newPassword: 'short' })).status, 400);
  const ok = await f.call('POST', '/admin/auth/forgot', { email: 'Admin@Bazaario.local', resetKey: made.data.resetKey.toLowerCase(), newPassword: 'NewOwner123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.staffRole, 'owner', 'signed in with the new password');
  assert.notEqual(ok.data.resetKey, made.data.resetKey, 'a new key replaces the used one');
  assert.equal((await f.call('GET', '/admin/stats')).status, 200);
  assert.equal((await c.call('GET', '/admin/stats')).status, 401, 'other sessions are signed out');
  assert.equal((await client().call('POST', '/admin/auth/forgot', { email: 'admin@bazaario.local', resetKey: made.data.resetKey, newPassword: 'Another123' })).status, 400, 'the old key no longer works');
  assert.equal((await client().call('POST', '/admin/auth/login', { email: 'admin@bazaario.local', password: 'NewOwner123' })).status, 200);

  // Staff (not owners) cannot make or use a reset key.
  const m = client();
  await signIn(m, 'neha@shop.in', 'nehapass34');
  assert.equal((await m.call('POST', '/admin/auth/reset-key', { password: 'nehapass34' })).status, 403);
  // Too many wrong keys lock the account like wrong passwords.
  for (let i = 0; i < 5; i++) await client().call('POST', '/admin/auth/forgot', { email: 'admin@bazaario.local', resetKey: 'AAAA-BBBB-CCCC-DDDD', newPassword: 'NewOwner123' });
  assert.equal((await client().call('POST', '/admin/auth/forgot', { email: 'admin@bazaario.local', resetKey: ok.data.resetKey, newPassword: 'NewOwner123' })).status, 423);
  db.get().prepare("UPDATE users SET locked_until = 0, failed_logins = 0 WHERE email = 'admin@bazaario.local'").run();
});

test('existing admins become owners when the database is upgraded', () => {
  const file = require('node:path').join(require('node:os').tmpdir(), `bz-migrate-${process.pid}.db`);
  db.close();
  db.open(file);
  db.get().prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES ('Old Admin', 'old@x.in', 'x', 'admin', ?)").run(Date.now());
  db.get().prepare("UPDATE users SET staff_role = NULL").run();
  db.close();
  db.open(file);
  assert.equal(db.get().prepare("SELECT staff_role FROM users WHERE email = 'old@x.in'").get().staff_role, 'owner');
  for (const f of [file, file + '-wal', file + '-shm']) require('node:fs').rmSync(f, { force: true });
});
