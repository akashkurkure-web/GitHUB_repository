'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const SESSION_COOKIE = config.isProd ? '__Host-sid' : 'sid';
// The admin portal has its own session cookie, sent only to /api/admin, so signing in or out of the shop never
// touches it and a shopping session can never open the portal.
const ADMIN_COOKIE = config.isProd ? '__Secure-aid' : 'aid';
const ADMIN_PATH = '/api/admin';
const isAdminRequest = (req) => req.originalUrl === ADMIN_PATH || req.originalUrl.startsWith(ADMIN_PATH + '/') || req.originalUrl.startsWith(ADMIN_PATH + '?');

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

function createSession(res, req, userId, { admin = false } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const ttl = admin ? config.adminSessionTtlMs : config.sessionTtlMs;
  db.get().prepare(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at, created_at, admin_ok, last_active) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(sha256(token), userId, csrf, req.ip || '', String(req.get('user-agent') || '').slice(0, 255), now + ttl, now, admin ? 1 : 0, now);
  res.cookie(admin ? ADMIN_COOKIE : SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: admin ? 'strict' : 'lax',
    path: admin ? ADMIN_PATH : '/',
    maxAge: ttl,
  });
  return csrf;
}

const cookieName = (req) => (isAdminRequest(req) ? ADMIN_COOKIE : SESSION_COOKIE);

/** Invalidate the caller's current session server-side (used before issuing a new one on login). */
function revokeCurrentSession(req) {
  const token = req.cookies && req.cookies[cookieName(req)];
  if (typeof token === 'string') db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function destroySession(req, res) {
  revokeCurrentSession(req);
  const admin = isAdminRequest(req);
  res.clearCookie(cookieName(req), { path: admin ? ADMIN_PATH : '/', httpOnly: true, secure: config.isProd, sameSite: admin ? 'strict' : 'lax' });
}

function destroyAllSessions(userId) {
  db.get().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/**
 * Attaches req.user and req.session when a valid session cookie is present. Requests to /api/admin use the
 * admin cookie and only admin sessions; every other request uses the shopping cookie and only shopping sessions.
 * An admin session ends after config.adminIdleMs without a request.
 */
function loadSession(req, _res, next) {
  const admin = isAdminRequest(req);
  const token = req.cookies && req.cookies[admin ? ADMIN_COOKIE : SESSION_COOKIE];
  if (!token || typeof token !== 'string' || token.length > 100) return next();
  const row = db.get().prepare(
    `SELECT s.token_hash, s.csrf_token, s.expires_at, s.admin_ok, s.last_active, u.id, u.name, u.email, u.phone, u.role, u.staff_role
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(sha256(token));
  if (!row || !!row.admin_ok !== admin) return next();
  const now = Date.now();
  const idle = admin && now - row.last_active > config.adminIdleMs;
  if (row.expires_at < now || idle || (admin && row.role !== 'admin')) {
    db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    if (admin) req.adminSessionEnded = idle ? 'idle' : 'expired';
    return next();
  }
  if (admin) {
    // Activity keeps the admin session open (written at most once a minute); its 12-hour limit never slides.
    if (now - row.last_active > 60_000) db.get().prepare('UPDATE sessions SET last_active = ? WHERE token_hash = ?').run(now, row.token_hash);
  } else if (row.expires_at - now < config.sessionTtlMs - 3600_000) {
    // Sliding expiry, refreshed at most once per hour.
    db.get().prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + config.sessionTtlMs, row.token_hash);
  }
  req.session = { tokenHash: row.token_hash, csrf: row.csrf_token, admin };
  req.user = { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role };
  if (admin) req.user.staffRole = row.staff_role || 'owner';
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}

/** Signed in to the admin portal (any staff role). */
function requireAdminSession(req, _res, next) {
  if (!req.user || !req.session.admin) {
    const msg = req.adminSessionEnded === 'idle'
      ? `You were signed out after ${Math.round(config.adminIdleMs / 60000)} minutes without activity. Please sign in again.`
      : 'Please sign in to the admin portal.';
    return next(new HttpError(401, msg));
  }
  if (req.user.role !== 'admin') return next(new HttpError(403, 'You do not have access to this area.'));
  next();
}

/** Signed in to the admin portal, and the staff role may use this part of it (see src/staff.js). */
function requireAdmin(req, res, next) {
  requireAdminSession(req, res, (err) => {
    if (err) return next(err);
    const first = req.originalUrl.slice(ADMIN_PATH.length + 1).split(/[/?]/)[0];
    if (!require('./staff').can(req.user.staffRole, req.method, first)) {
      return next(new HttpError(403, 'Your staff role does not include this. Ask the store owner if you need it.'));
    }
    next();
  });
}

/**
 * Checks an email and password with per-account lockout. Returns the user, or throws one generic error so the
 * answer never tells whether the email exists.
 */
function checkPassword(req, emailIn, passwordIn) {
  const email = typeof emailIn === 'string' ? emailIn.trim().toLowerCase() : '';
  const password = typeof passwordIn === 'string' ? passwordIn : '';
  const generic = new HttpError(401, 'Incorrect email or password.');
  if (!email || !password || password.length > 128) throw generic;
  const user = db.get().prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    verifyPassword(password, DUMMY_HASH); // equalise timing
    throw generic;
  }
  const now = Date.now();
  if (user.locked_until > now) {
    throw new HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later.');
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lock = failed >= config.maxFailedLogins ? now + config.lockoutMs : 0;
    db.get().prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .run(lock ? 0 : failed, lock, user.id);
    audit(req, lock ? 'user.locked' : 'user.login_failed', { userId: user.id });
    throw generic;
  }
  db.get().prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(user.id);
  return user;
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
  createSession, revokeCurrentSession, destroySession, destroyAllSessions, loadSession, checkPassword,
  requireAuth, requireAdmin, requireAdminSession, csrfProtect, audit, v, SESSION_COOKIE, ADMIN_COOKIE,
};
