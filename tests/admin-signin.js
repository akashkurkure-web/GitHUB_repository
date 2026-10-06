'use strict';
/**
 * Test helper: signs a test client in to the admin portal with the email and password. Later sign-ins for the
 * same account reuse the first portal session.
 */
const assert = require('node:assert/strict');

const sessions = new Map();

async function signInAdmin(c, email = 'admin@bazaario.local', password = 'AdminPass123') {
  const known = sessions.get(email);
  if (known) { c.cookie = known.cookie; c.csrf = known.csrf; return c; }
  const r = await c.call('POST', '/admin/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  sessions.set(email, { cookie: c.cookie, csrf: r.data.csrfToken });
  return c;
}

module.exports = { signInAdmin, sessions };
