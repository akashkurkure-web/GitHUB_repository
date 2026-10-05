'use strict';
/**
 * Test helper: signs a test client in to the admin portal (password, then the authenticator code).
 * The authenticator secret is remembered per account, as a phone would keep it, and a code works only once per
 * 30-second window, so later sign-ins in the same window reuse the first portal session.
 */
const assert = require('node:assert/strict');
const totp = require('../src/totp');

const secrets = new Map();
const sessions = new Map();

async function signInAdmin(c, email = 'admin@bazaario.local', password = 'AdminPass123') {
  const known = sessions.get(email);
  if (known) { c.cookie = known.cookie; c.csrf = known.csrf; return c; }
  const r = await c.call('POST', '/admin/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (r.data.enrol) secrets.set(email, r.data.enrol.secret.replace(/\s/g, ''));
  const code = totp.codeAt(secrets.get(email), totp.stepAt());
  const ok = await c.call('POST', '/admin/auth/verify', { challenge: r.data.challenge, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  sessions.set(email, { cookie: c.cookie, csrf: ok.data.csrfToken });
  return c;
}

module.exports = { signInAdmin, secrets, sessions };
