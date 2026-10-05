'use strict';
/**
 * Admin portal sign-in and staff accounts.
 *
 * Signing in takes two steps. The email and password give a short-lived challenge; the 6-digit code from the
 * person's authenticator app (or one of their recovery codes) turns it into an admin session. The first time,
 * the challenge carries a QR code to add Bazaario to the app, and new staff choose their own password.
 */
const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../db');
const totp = require('../totp');
const staff = require('../staff');
const {
  HttpError, hashPassword, verifyPassword, passwordPolicyError, checkPassword, createSession, revokeCurrentSession,
  destroySession, destroyAllSessions, requireAdmin, requireAdminSession, audit, v,
} = require('../security');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RECOVERY_CODES = 10;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hasOwner = () => !!db.get().prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();

const portalUser = (u) => {
  const role = u.staffRole || u.staff_role || 'owner';
  return {
    id: u.id, name: u.name, email: u.email, staffRole: role, roleLabel: staff.ROLE_LABEL[role],
    sections: staff.sectionsFor(role).map(({ key, label, group }) => ({ key, label, group })),
  };
};

/** Recovery codes look like K7QM-2XPA. Only their hashes are kept. */
function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODES }, () => totp.base32Encode(crypto.randomBytes(5)).replace(/(.{4})(.{4})/, '$1-$2'));
  return { codes, hashes: codes.map((c) => sha256(c.replace('-', ''))) };
}

/** A temporary password for new staff: 12 letters and numbers, changed at first sign-in. */
const tempPassword = () => `${totp.base32Encode(crypto.randomBytes(6)).slice(0, 4)}-${crypto.randomInt(1000, 10000)}-${totp.base32Encode(crypto.randomBytes(6)).slice(0, 4).toLowerCase()}`;

/** Starts step 2 of signing in. A person without an authenticator app yet gets a new secret and its QR code. */
async function challengeFor(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const pending = user.totp_secret ? null : totp.newSecret();
  db.tx((d) => {
    d.prepare('DELETE FROM admin_challenges WHERE user_id = ? OR expires_at < ?').run(user.id, Date.now());
    d.prepare('INSERT INTO admin_challenges (token_hash, user_id, pending_secret, attempts, expires_at) VALUES (?,?,?,0,?)')
      .run(sha256(token), user.id, pending, Date.now() + CHALLENGE_TTL_MS);
  });
  let enrol = null;
  if (pending) {
    const uri = totp.otpauthUri(pending, user.email, `${config.storeName} Admin`);
    const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14211f', light: '#ffffff' } });
    enrol = { secret: pending.replace(/(.{4})/g, '$1 ').trim(), qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, uri };
  }
  return { challenge: token, enrol, mustChangePassword: !!user.must_change_password, name: user.name };
}

router.get('/me', (req, res) => {
  if (req.user && req.session.admin) {
    return res.json({ user: portalUser(req.user), csrfToken: req.session.csrf, idleMinutes: config.adminIdleMs / 60000 });
  }
  res.json({ user: null, setupNeeded: !hasOwner(), ended: req.adminSessionEnded || null });
});

// First run: the store has no owner yet, so the first person here creates the owner account.
router.post('/setup', limiter, async (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 60 });
  const email = v.email(req.body.email);
  const pwErr = passwordPolicyError(req.body.password);
  if (pwErr) throw new HttpError(400, pwErr);
  const hash = hashPassword(req.body.password);
  const user = db.tx((d) => {
    if (hasOwner()) throw new HttpError(409, 'This store already has an owner. Please sign in.');
    const existing = d.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existing) {
      // A shopper account with this email becomes the owner only with its own password.
      if (!verifyPassword(req.body.password, existing.password_hash)) throw new HttpError(409, 'An account with this email already exists. Use its password, or a different email.');
      d.prepare("UPDATE users SET role = 'admin', staff_role = 'owner', name = ? WHERE id = ?").run(name, existing.id);
      return d.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    }
    const info = d.prepare("INSERT INTO users (name, email, password_hash, role, staff_role, created_at) VALUES (?,?,?,'admin','owner',?)")
      .run(name, email, hash, Date.now());
    return d.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  });
  req.user = user;
  audit(req, 'owner.setup');
  res.status(201).json(await challengeFor(user));
});

router.post('/login', limiter, async (req, res) => {
  const user = checkPassword(req, req.body.email, req.body.password);
  if (user.role !== 'admin') {
    throw new HttpError(403, 'This is a shopping account, not a staff account. Shoppers sign in on the store.');
  }
  res.json(await challengeFor(user));
});

router.post('/verify', limiter, (req, res) => {
  const token = typeof req.body.challenge === 'string' ? req.body.challenge : '';
  const code = typeof req.body.code === 'string' ? req.body.code.trim().replace(/\s/g, '') : '';
  const restart = new HttpError(401, 'Your sign-in has timed out. Please enter your email and password again.');
  const ch = token && token.length < 100 ? db.get().prepare('SELECT * FROM admin_challenges WHERE token_hash = ?').get(sha256(token)) : null;
  if (!ch || ch.expires_at < Date.now()) throw restart;
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(ch.user_id);
  if (!user || user.role !== 'admin') throw restart;
  if (user.locked_until > Date.now()) throw new HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later.');

  // New staff replace their temporary password here, checked before the code so a good code is not used up.
  let newHash = null;
  if (user.must_change_password) {
    const pwErr = passwordPolicyError(req.body.newPassword);
    if (pwErr) throw new HttpError(400, pwErr);
    if (verifyPassword(req.body.newPassword, user.password_hash)) throw new HttpError(400, 'Choose a new password, not the temporary one.');
    newHash = hashPassword(req.body.newPassword);
  }

  const enrolling = !!ch.pending_secret;
  let step = -1;
  let usedRecovery = null;
  if (/^\d{6}$/.test(code)) {
    step = totp.verify(enrolling ? ch.pending_secret : user.totp_secret, code, enrolling ? 0 : user.totp_last_step);
  } else if (!enrolling && /^[a-z2-7]{4}-?[a-z2-7]{4}$/i.test(code)) {
    const h = sha256(code.toUpperCase().replace('-', ''));
    const hashes = JSON.parse(user.recovery_codes || '[]');
    usedRecovery = hashes.find((x) => crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h))) || null;
  }
  if (step < 0 && !usedRecovery) {
    const attempts = ch.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      db.get().prepare('DELETE FROM admin_challenges WHERE token_hash = ?').run(ch.token_hash);
      audit(req, 'admin.code_failed', { userId: user.id, final: true });
      throw new HttpError(401, 'Too many wrong codes. Please enter your email and password again.');
    }
    db.get().prepare('UPDATE admin_challenges SET attempts = ? WHERE token_hash = ?').run(attempts, ch.token_hash);
    audit(req, 'admin.code_failed', { userId: user.id });
    throw new HttpError(401, enrolling
      ? 'That code is not right. Scan the QR code again, then enter the 6-digit code your app shows now.'
      : 'That code is not right. Enter the 6-digit code your authenticator app shows now, or a recovery code.');
  }

  const recovery = enrolling ? newRecoveryCodes() : null;
  db.tx((d) => {
    d.prepare('DELETE FROM admin_challenges WHERE token_hash = ?').run(ch.token_hash);
    if (enrolling) d.prepare('UPDATE users SET totp_secret = ?, recovery_codes = ? WHERE id = ?').run(ch.pending_secret, JSON.stringify(recovery.hashes), user.id);
    if (step > 0) d.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
    if (usedRecovery) {
      const left = JSON.parse(user.recovery_codes || '[]').filter((x) => x !== usedRecovery);
      d.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(left), user.id);
    }
    if (newHash) d.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, user.id);
    d.prepare('UPDATE users SET last_admin_login = ? WHERE id = ?').run(Date.now(), user.id);
  });
  if (newHash) destroyAllSessions(user.id);
  revokeCurrentSession(req);
  const csrfToken = createSession(res, req, user.id, { admin: true });
  req.user = user;
  if (enrolling) audit(req, 'admin.2fa_enrolled');
  audit(req, 'admin.login', { with: usedRecovery ? 'recovery code' : 'authenticator app' });
  const left = usedRecovery ? JSON.parse(user.recovery_codes || '[]').length - 1 : null;
  res.json({
    user: portalUser(user), csrfToken, idleMinutes: config.adminIdleMs / 60000,
    recoveryCodes: recovery ? recovery.codes : undefined,
    recoveryCodesLeft: left === null ? undefined : left,
  });
});

router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'admin.logout');
  destroySession(req, res);
  res.json({ ok: true });
});

router.post('/password', limiter, requireAdminSession, (req, res) => {
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (typeof req.body.currentPassword !== 'string' || !verifyPassword(req.body.currentPassword, user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  const pwErr = passwordPolicyError(req.body.newPassword);
  if (pwErr) throw new HttpError(400, pwErr);
  db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.newPassword), user.id);
  // Signs out every device (shop and portal), then keeps this portal session going.
  destroyAllSessions(user.id);
  const csrfToken = createSession(res, req, user.id, { admin: true });
  audit(req, 'admin.password_changed');
  res.json({ ok: true, csrfToken });
});

router.get('/security', requireAdminSession, (req, res) => {
  const u = db.get().prepare('SELECT recovery_codes, last_admin_login FROM users WHERE id = ?').get(req.user.id);
  res.json({ recoveryCodesLeft: JSON.parse(u.recovery_codes || '[]').length, lastSignIn: u.last_admin_login });
});

router.post('/recovery-codes', limiter, requireAdminSession, (req, res) => {
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const step = totp.verify(user.totp_secret, code, user.totp_last_step);
  if (step < 0) throw new HttpError(400, 'That code is not right. Enter the 6-digit code your authenticator app shows now.');
  const recovery = newRecoveryCodes();
  db.get().prepare('UPDATE users SET recovery_codes = ?, totp_last_step = ? WHERE id = ?').run(JSON.stringify(recovery.hashes), step, user.id);
  audit(req, 'admin.recovery_codes_renewed');
  res.json({ recoveryCodes: recovery.codes });
});

// Moving to a new phone: the password confirms it is really you, then the new app's code switches over.
router.post('/authenticator', limiter, requireAdminSession, async (req, res) => {
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (typeof req.body.password !== 'string' || !verifyPassword(req.body.password, user.password_hash)) {
    throw new HttpError(400, 'Password is incorrect.');
  }
  const ch = await challengeFor({ ...user, totp_secret: null });
  res.json({ challenge: ch.challenge, enrol: ch.enrol });
});

router.post('/authenticator/confirm', limiter, requireAdminSession, (req, res) => {
  const token = typeof req.body.challenge === 'string' ? req.body.challenge : '';
  const ch = token && token.length < 100 ? db.get().prepare('SELECT * FROM admin_challenges WHERE token_hash = ?').get(sha256(token)) : null;
  if (!ch || ch.user_id !== req.user.id || !ch.pending_secret || ch.expires_at < Date.now()) {
    throw new HttpError(400, 'This set-up has timed out. Please start again.');
  }
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const step = totp.verify(ch.pending_secret, code, 0);
  if (step < 0) {
    db.get().prepare('UPDATE admin_challenges SET attempts = attempts + 1 WHERE token_hash = ?').run(ch.token_hash);
    if (ch.attempts + 1 >= MAX_CODE_ATTEMPTS) db.get().prepare('DELETE FROM admin_challenges WHERE token_hash = ?').run(ch.token_hash);
    throw new HttpError(400, 'That code is not right. Enter the 6-digit code the new app shows now.');
  }
  db.tx((d) => {
    d.prepare('DELETE FROM admin_challenges WHERE token_hash = ?').run(ch.token_hash);
    d.prepare('UPDATE users SET totp_secret = ?, totp_last_step = ? WHERE id = ?').run(ch.pending_secret, step, req.user.id);
  });
  audit(req, 'admin.2fa_moved');
  res.json({ ok: true });
});

// ---------- Staff accounts (owner only, see src/staff.js) ----------
const staffRouter = express.Router();
staffRouter.use(requireAdmin);

const staffRow = (u, meId) => ({
  id: u.id, name: u.name, email: u.email, staffRole: u.staff_role || 'owner', roleLabel: staff.ROLE_LABEL[u.staff_role || 'owner'],
  twoFactor: !!u.totp_secret, pendingFirstSignIn: !!u.must_change_password, lastSignIn: u.last_admin_login,
  locked: u.locked_until > Date.now(), createdAt: u.created_at, you: u.id === meId,
});

const roleOf = (val) => {
  if (!staff.ROLES.includes(val)) throw new HttpError(400, 'Choose a role: Owner, Manager or Support.');
  return val;
};

function staffMember(req) {
  const id = v.int(req.params.id, 'Staff member', { min: 1 });
  const u = db.get().prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(id);
  if (!u) throw new HttpError(404, 'Staff member not found.');
  if (u.id === req.user.id) throw new HttpError(400, 'You cannot change your own staff account here. Use My account.');
  return u;
}

staffRouter.get('/', (req, res) => {
  const rows = db.get().prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at").all();
  res.json({ staff: rows.map((u) => staffRow(u, req.user.id)), roles: staff.ROLES.map((r) => ({ key: r, label: staff.ROLE_LABEL[r] })) });
});

staffRouter.post('/', (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 60 });
  const email = v.email(req.body.email);
  const role = roleOf(req.body.staffRole);
  if (db.get().prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'This email already has an account on the store. Use a different email for the staff account.');
  }
  const password = tempPassword();
  const info = db.get().prepare("INSERT INTO users (name, email, password_hash, role, staff_role, must_change_password, created_at) VALUES (?,?,?,'admin',?,1,?)")
    .run(name, email, hashPassword(password), role, Date.now());
  const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  audit(req, 'staff.added', { staffId: u.id, email, role });
  res.status(201).json({ staff: staffRow(u, req.user.id), tempPassword: password });
});

staffRouter.patch('/:id', (req, res) => {
  const u = staffMember(req);
  const role = roleOf(req.body.staffRole);
  db.get().prepare('UPDATE users SET staff_role = ? WHERE id = ?').run(role, u.id);
  audit(req, 'staff.role_changed', { staffId: u.id, from: u.staff_role, to: role });
  res.json({ staff: staffRow({ ...u, staff_role: role }, req.user.id) });
});

// Lost phone or forgotten password: a new temporary password, and the authenticator app is set up again.
staffRouter.post('/:id/reset', (req, res) => {
  const u = staffMember(req);
  const password = tempPassword();
  db.get().prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, totp_secret = NULL, totp_last_step = 0,
    recovery_codes = '[]', failed_logins = 0, locked_until = 0 WHERE id = ?`).run(hashPassword(password), u.id);
  destroyAllSessions(u.id);
  audit(req, 'staff.reset', { staffId: u.id });
  res.json({ tempPassword: password });
});

// Removing someone ends their sessions at once; their account stays as an ordinary shopping account.
staffRouter.delete('/:id', (req, res) => {
  const u = staffMember(req);
  db.get().prepare(`UPDATE users SET role = 'customer', staff_role = NULL, totp_secret = NULL, totp_last_step = 0, recovery_codes = '[]',
    must_change_password = 0 WHERE id = ?`).run(u.id);
  destroyAllSessions(u.id);
  audit(req, 'staff.removed', { staffId: u.id, email: u.email });
  res.json({ ok: true });
});

module.exports = { router, staff: staffRouter };
