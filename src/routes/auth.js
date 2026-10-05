'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const {
  HttpError, hashPassword, verifyPassword, DUMMY_HASH, passwordPolicyError,
  createSession, revokeCurrentSession, destroySession, destroyAllSessions, requireAuth, audit, v,
} = require('../security');

const router = express.Router();

// Brute-force protection: per-IP limiter on credential endpoints + per-account lockout below.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role });

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user), csrfToken: req.session.csrf });
});

router.post('/register', authLimiter, (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 60 });
  const email = v.email(req.body.email);
  const phone = v.phone(req.body.phone, true);
  const pwErr = passwordPolicyError(req.body.password);
  if (pwErr) throw new HttpError(400, pwErr);

  const exists = db.get().prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) throw new HttpError(409, 'An account with this email already exists. Please sign in.');

  const info = db.get().prepare('INSERT INTO users (name, email, phone, password_hash, created_at) VALUES (?,?,?,?,?)')
    .run(name, email, phone || null, hashPassword(req.body.password), Date.now());
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  const csrfToken = createSession(res, req, user.id);
  req.user = user;
  audit(req, 'user.register');
  res.status(201).json({ user: publicUser(user), csrfToken });
});

// First-run setup: until the store has an owner, the first person to sign in creates the owner account.
const hasOwner = () => !!db.get().prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();

router.get('/setup', (_req, res) => res.json({ needed: !hasOwner() }));

router.post('/setup', authLimiter, (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 60 });
  const email = v.email(req.body.email);
  const pwErr = passwordPolicyError(req.body.password);
  if (pwErr) throw new HttpError(400, pwErr);
  const hash = hashPassword(req.body.password);
  const user = db.tx(() => {
    if (hasOwner()) throw new HttpError(409, 'This store already has an owner. Please sign in.');
    const existing = db.get().prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      // A shopper account with this email becomes the owner only with its own password.
      const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
      if (!verifyPassword(req.body.password, u.password_hash)) throw new HttpError(409, 'An account with this email already exists. Use its password, or a different email.');
      db.get().prepare("UPDATE users SET role = 'admin', name = ? WHERE id = ?").run(name, u.id);
      return db.get().prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    }
    const info = db.get().prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?,?,?,'admin',?)")
      .run(name, email, hash, Date.now());
    return db.get().prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  });
  revokeCurrentSession(req);
  const csrfToken = createSession(res, req, user.id);
  req.user = user;
  audit(req, 'owner.setup');
  res.status(201).json({ user: publicUser(user), csrfToken });
});

router.post('/login', authLimiter, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
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
  // Fresh session on login (prevents session fixation).
  revokeCurrentSession(req);
  const csrfToken = createSession(res, req, user.id);
  req.user = user;
  audit(req, 'user.login');
  res.json({ user: publicUser(user), csrfToken });
});

router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'user.logout');
  destroySession(req, res);
  res.json({ ok: true });
});

router.patch('/profile', requireAuth, (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 60 });
  const phone = v.phone(req.body.phone, true);
  db.get().prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone || null, req.user.id);
  res.json({ user: publicUser({ ...req.user, name, phone }) });
});

router.post('/change-password', authLimiter, requireAuth, (req, res) => {
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (typeof req.body.currentPassword !== 'string' || !verifyPassword(req.body.currentPassword, user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  const pwErr = passwordPolicyError(req.body.newPassword);
  if (pwErr) throw new HttpError(400, pwErr);
  db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.newPassword), user.id);
  // Sign out every device, then issue a fresh session for this one.
  destroyAllSessions(user.id);
  const csrfToken = createSession(res, req, user.id);
  audit(req, 'user.password_changed');
  res.json({ ok: true, csrfToken });
});

module.exports = router;
