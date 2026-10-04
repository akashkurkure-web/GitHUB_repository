'use strict';
const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const notify = require('../notify');
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
  if (req.body.referralCode) require('../growth').linkReferral(db.get(), user.id, req.body.referralCode);
  const csrfToken = createSession(res, req, user.id);
  req.user = user;
  audit(req, 'user.register');
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

// ---------- Sign in with a one-time code sent to the mobile number (blueprint stage 5) ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const otpHash = (phone, code) => sha(`${phone}:${code}`);

router.post('/otp/request', authLimiter, (req, res) => {
  if (!config.otpEnabled) throw new HttpError(503, 'Sign-in with a mobile code is not available yet. Please use your email and password.');
  const phone = v.phone(req.body.phone);
  const generic = { ok: true, message: `If an account uses ${phone}, we have sent it a 6-digit code.` };
  // Most recently created account with this number, so a reused number reaches its current owner.
  const user = db.get().prepare('SELECT id FROM users WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
  if (!user) {
    if (config.smsProvider === 'test') throw new HttpError(404, 'No account uses this mobile number. Create an account or sign in with email.');
    return res.json(generic);
  }
  const now = Date.now();
  const prev = db.get().prepare('SELECT sent_at FROM otp_codes WHERE phone = ?').get(phone);
  if (prev && now - prev.sent_at < config.otpResendMs) throw new HttpError(429, 'Please wait 30 seconds before asking for another code.');
  const code = String(crypto.randomInt(100000, 1000000));
  db.tx((d) => {
    d.prepare(`INSERT INTO otp_codes (phone, user_id, code_hash, attempts, expires_at, sent_at) VALUES (?,?,?,0,?,?)
      ON CONFLICT(phone) DO UPDATE SET user_id = excluded.user_id, code_hash = excluded.code_hash, attempts = 0,
      expires_at = excluded.expires_at, sent_at = excluded.sent_at`).run(phone, user.id, otpHash(phone, code), now + config.otpTtlMs, now);
    notify.send(d, { userId: user.id, channel: 'sms', recipient: phone, body: `${code} is your ${config.storeName} sign-in code. It expires in 5 minutes. Never share it.` });
  });
  audit(req, 'user.otp_sent', { userId: user.id });
  // Test mode only: with no SMS partner connected, the code is shown on screen so the flow can be tried.
  res.json(config.smsProvider === 'test' ? { ...generic, testCode: code } : generic);
});

router.post('/otp/verify', authLimiter, (req, res) => {
  if (!config.otpEnabled) throw new HttpError(503, 'Sign-in with a mobile code is not available yet.');
  const phone = v.phone(req.body.phone);
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const wrong = new HttpError(401, 'That code is not right or has expired. Please try again or ask for a new code.');
  const row = db.get().prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone);
  if (!row || row.expires_at < Date.now() || row.attempts >= config.otpMaxAttempts) throw wrong;
  const a = Buffer.from(otpHash(phone, code));
  const b = Buffer.from(row.code_hash);
  if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(a, b)) {
    db.get().prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    throw wrong;
  }
  db.get().prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) throw wrong;
  if (user.locked_until > Date.now()) throw new HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later.');
  revokeCurrentSession(req);
  const csrfToken = createSession(res, req, user.id);
  req.user = user;
  audit(req, 'user.login_otp');
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
