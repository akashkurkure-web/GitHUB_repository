'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const SESSION_COOKIE = config.isProd ? '__Host-sid' : 'sid';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// ---------- Password hashing (scrypt, per-user salt, constant-time compare) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

// Used so a login attempt for an unknown email costs the same as a real one (no user enumeration by timing).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers.';
  return null;
}

// ---------- Sessions (opaque random token in HttpOnly cookie, only its SHA-256 stored) ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  db.get().prepare(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(sha256(token), userId, csrf, req.ip || '', String(req.get('user-agent') || '').slice(0, 255), now + config.sessionTtlMs, now);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  });
  return csrf;
}

/** Invalidate the caller's current session server-side (used before issuing a new one on login). */
function revokeCurrentSession(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (typeof token === 'string') db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function destroySession(req, res) {
  revokeCurrentSession(req);
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: config.isProd, sameSite: 'lax' });
}

function destroyAllSessions(userId) {
  db.get().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Attaches req.user and req.session when a valid session cookie is present. */
function loadSession(req, _res, next) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token || typeof token !== 'string' || token.length > 100) return next();
  const row = db.get().prepare(
    `SELECT s.token_hash, s.csrf_token, s.expires_at, u.id, u.name, u.email, u.phone, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(sha256(token));
  if (!row) return next();
  const now = Date.now();
  if (row.expires_at < now) {
    db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return next();
  }
  // Sliding expiry, refreshed at most once per hour.
  if (row.expires_at - now < config.sessionTtlMs - 3600_000) {
    db.get().prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + config.sessionTtlMs, row.token_hash);
  }
  req.session = { tokenHash: row.token_hash, csrf: row.csrf_token };
  req.user = { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role };
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'You do not have access to this area.'));
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth:
 *  1. Same-origin check on Origin / Referer for every state-changing request.
 *  2. Synchronizer token (X-CSRF-Token header) bound to the session for authenticated requests.
 */
function csrfProtect(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { return next(new HttpError(403, 'Invalid request origin.')); }
    // Hosted proxies (e.g. Codespaces port forwarding) may rewrite Host; the public name is then in X-Forwarded-Host.
    const allowed = [req.get('host'), req.get('x-forwarded-host')].filter(Boolean);
    if (!allowed.includes(host)) return next(new HttpError(403, 'Cross-site request blocked.'));
  }
  if (req.session) {
    const sent = String(req.get('x-csrf-token') || '');
    const a = Buffer.from(sent);
    const b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return next(new HttpError(403, 'Security token missing or invalid. Please refresh the page.'));
    }
  }
  next();
}

function audit(req, action, detail) {
  db.get().prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)')
    .run(req.user ? req.user.id : null, action, detail ? JSON.stringify(detail) : null, req.ip || '', Date.now());
}

// ---------- Input validation helpers ----------
const v = {
  str(val, field, { min = 1, max = 200, pattern, optional = false } = {}) {
    if (val === undefined || val === null || val === '') {
      if (optional) return '';
      throw new HttpError(400, `${field} is required.`);
    }
    if (typeof val !== 'string') throw new HttpError(400, `${field} must be text.`);
    const s = val.trim();
    if (s.length < min || s.length > max) throw new HttpError(400, `${field} must be ${min}-${max} characters.`);
    if (pattern && !pattern.test(s)) throw new HttpError(400, `${field} is not valid.`);
    return s;
  },
  int(val, field, { min = -Infinity, max = Infinity, optional = false, def } = {}) {
    if (val === undefined || val === null || val === '') {
      if (optional) return def;
      throw new HttpError(400, `${field} is required.`);
    }
    const n = Number(val);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}.`);
    return n;
  },
  email(val) {
    return v.str(val, 'Email', { max: 254, pattern: /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i }).toLowerCase();
  },
  phone(val, optional = false) {
    return v.str(val, 'Mobile number', { min: 10, max: 10, pattern: /^[6-9]\d{9}$/, optional });
  },
  pincode(val) {
    return v.str(val, 'PIN code', { min: 6, max: 6, pattern: /^[1-9]\d{5}$/ });
  },
};

module.exports = {
  HttpError, hashPassword, verifyPassword, DUMMY_HASH, passwordPolicyError,
  createSession, revokeCurrentSession, destroySession, destroyAllSessions, loadSession,
  requireAuth, requireAdmin, csrfProtect, audit, v, SESSION_COOKIE,
};
