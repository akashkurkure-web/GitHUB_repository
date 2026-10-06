'use strict';
/**
 * Admin portal sign-in and staff accounts.
 *
 * Signing in is the email and password on one screen. Two steps are needed only when the person has to choose
 * their own password (new staff) or has turned on the optional authenticator code under My account; then the
 * password gives a short-lived challenge, and the new password or the 6-digit code (or a recovery code)
 * finishes the sign-in.
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

/** Owner reset key, like K7QM-2XPA-9RTD-HB4E (80 random bits). Saved by the owner; only its hash is kept. */
const newResetKey = () => totp.base32Encode(crypto.randomBytes(10)).replace(/(.{4})(?=.)/g, '$1-');
// Typed keys forgive look-alikes (0 for O, 1 for I, 8 for B), spaces and dashes.
const resetKeyHash = (key) => sha256(String(key).toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B').replace(/[^A-Z2-7]/g, ''));

function issueResetKey(userId) {
  const key = newResetKey();
  db.get().prepare('UPDATE users SET reset_key_hash = ? WHERE id = ?').run(resetKeyHash(key), userId);
  return key;
}

/** A temporary password for new staff: 12 letters and numbers, changed at first sign-in. */
const tempPassword = () => `${totp.base32Encode(crypto.randomBytes(6)).slice(0, 4)}-${crypto.randomInt(1000, 10000)}-${totp.base32Encode(crypto.randomBytes(6)).slice(0, 4).toLowerCase()}`;

/** Starts step 2 of signing in, or (with enrol) adding an authenticator app, which gets a new secret and QR code. */
async function challengeFor(user, { enrol: withApp = false } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const pending = withApp ? totp.newSecret() : null;
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
  return { challenge: token, enrol, mustChangePassword: !!user.must_change_password, twoStep: !!user.totp_secret, name: user.name };
}

/** Opens a portal session for a person whose sign-in is complete. */
function openSession(req, res, user, how) {
  db.get().prepare('UPDATE users SET last_admin_login = ? WHERE id = ?').run(Date.now(), user.id);
  revokeCurrentSession(req);
  const csrfToken = createSession(res, req, user.id, { admin: true });
  req.user = user;
  audit(req, 'admin.login', { with: how });
  return { user: portalUser(user), csrfToken, idleMinutes: config.adminIdleMs / 60000 };
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
  const out = openSession(req, res, user, 'password');
  out.resetKey = issueResetKey(user.id);
  res.status(201).json(out);
});

router.post('/login', limiter, async (req, res) => {
  const user = checkPassword(req, req.body.email, req.body.password);
  if (user.role !== 'admin') {
    throw new HttpError(403, 'This is a shopping account, not a staff account. Shoppers sign in on the store.');
  }
  if (user.must_change_password || user.totp_secret) return res.json(await challengeFor(user));
  res.json(openSession(req, res, user, 'password'));
});

router.post('/verify', limiter, (req, res) => {
  const token = typeof req.body.challenge === 'string' ? req.body.challenge : '';
  const code = typeof req.body.code === 'string' ? req.body.code.trim().replace(/\s/g, '') : '';
  const restart = new HttpError(401, 'Your sign-in has timed out. Please enter your email and password again.');
  const ch = token && token.length < 100 ? db.get().prepare('SELECT * FROM admin_challenges WHERE token_hash = ?').get(sha256(token)) : null;
  if (!ch || ch.pending_secret || ch.expires_at < Date.now()) throw restart;
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

  // The authenticator code, when the person has turned it on.
  let step = -1;
  let usedRecovery = null;
  if (user.totp_secret) {
    if (/^\d{6}$/.test(code)) {
      step = totp.verify(user.totp_secret, code, user.totp_last_step);
    } else if (/^[a-z2-7]{4}-?[a-z2-7]{4}$/i.test(code)) {
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
      throw new HttpError(401, 'That code is not right. Enter the 6-digit code your authenticator app shows now, or a recovery code.');
    }
  }

  db.tx((d) => {
    d.prepare('DELETE FROM admin_challenges WHERE token_hash = ?').run(ch.token_hash);
    if (step > 0) d.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
    if (usedRecovery) {
      const left = JSON.parse(user.recovery_codes || '[]').filter((x) => x !== usedRecovery);
      d.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(left), user.id);
    }
    if (newHash) d.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, user.id);
  });
  if (newHash) destroyAllSessions(user.id);
  const out = openSession(req, res, user, usedRecovery ? 'recovery code' : step > 0 ? 'authenticator app' : 'password');
  if (usedRecovery) out.recoveryCodesLeft = JSON.parse(user.recovery_codes || '[]').length - 1;
  res.json(out);
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
  const u = db.get().prepare('SELECT totp_secret, recovery_codes, last_admin_login, reset_key_hash FROM users WHERE id = ?').get(req.user.id);
  res.json({ twoStep: !!u.totp_secret, recoveryCodesLeft: JSON.parse(u.recovery_codes || '[]').length, lastSignIn: u.last_admin_login, hasResetKey: !!u.reset_key_hash });
});

// Forgot password (owners): the saved owner reset key sets a new password, with no email needed. Staff ask an
// owner to reset their access instead. Wrong keys count towards the same lockout as wrong passwords.
router.post('/forgot', limiter, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const key = typeof req.body.resetKey === 'string' ? req.body.resetKey : '';
  const wrong = new HttpError(400, 'That email and reset key do not match. Staff members: ask the store owner to reset your access.');
  const pwErr = passwordPolicyError(req.body.newPassword);
  if (pwErr) throw new HttpError(400, pwErr);
  const user = email ? db.get().prepare("SELECT * FROM users WHERE email = ? AND role = 'admin'").get(email) : null;
  if (!user || !user.reset_key_hash || (user.staff_role || 'owner') !== 'owner') { resetKeyHash(key); throw wrong; }
  if (user.locked_until > Date.now()) throw new HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later.');
  const ok = crypto.timingSafeEqual(Buffer.from(resetKeyHash(key)), Buffer.from(user.reset_key_hash));
  if (!ok) {
    const failed = user.failed_logins + 1;
    const lock = failed >= config.maxFailedLogins ? Date.now() + config.lockoutMs : 0;
    db.get().prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    audit(req, 'admin.reset_key_failed', { userId: user.id });
    throw wrong;
  }
  db.get().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = 0 WHERE id = ?')
    .run(hashPassword(req.body.newPassword), user.id);
  destroyAllSessions(user.id);
  req.user = user;
  audit(req, 'admin.password_reset_with_key');
  const out = openSession(req, res, user, 'reset key');
  out.resetKey = issueResetKey(user.id); // the used key is replaced, so it cannot be used again
  res.json(out);
});

router.post('/reset-key', limiter, requireAdminSession, (req, res) => {
  if (req.user.staffRole !== 'owner') throw new HttpError(403, 'Only owners have a reset key. Staff ask an owner to reset their access.');
  confirmPassword(req);
  audit(req, 'admin.reset_key_created');
  res.json({ resetKey: issueResetKey(req.user.id) });
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

// Optional authenticator code: turning it on, or moving it to a new phone. The password confirms it is really
// you, then a code from the app finishes it.
const confirmPassword = (req) => {
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (typeof req.body.password !== 'string' || !verifyPassword(req.body.password, user.password_hash)) {
    throw new HttpError(400, 'Password is incorrect.');
  }
  return user;
};

router.post('/authenticator', limiter, requireAdminSession, async (req, res) => {
  const user = confirmPassword(req);
  const ch = await challengeFor(user, { enrol: true });
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
  const turningOn = !db.get().prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id).totp_secret;
  const recovery = turningOn ? newRecoveryCodes() : null;
  db.tx((d) => {
    d.prepare('DELETE FROM admin_challenges WHERE token_hash = ?').run(ch.token_hash);
    d.prepare('UPDATE users SET totp_secret = ?, totp_last_step = ? WHERE id = ?').run(ch.pending_secret, step, req.user.id);
    if (recovery) d.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(recovery.hashes), req.user.id);
  });
  audit(req, turningOn ? 'admin.2fa_on' : 'admin.2fa_moved');
  res.json({ ok: true, recoveryCodes: recovery ? recovery.codes : undefined });
});

router.post('/authenticator/off', limiter, requireAdminSession, (req, res) => {
  confirmPassword(req);
  db.get().prepare("UPDATE users SET totp_secret = NULL, totp_last_step = 0, recovery_codes = '[]' WHERE id = ?").run(req.user.id);
  audit(req, 'admin.2fa_off');
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
  db.get().prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, totp_secret = NULL, totp_last_step = 0, reset_key_hash = NULL,
    recovery_codes = '[]', failed_logins = 0, locked_until = 0 WHERE id = ?`).run(hashPassword(password), u.id);
  destroyAllSessions(u.id);
  audit(req, 'staff.reset', { staffId: u.id });
  res.json({ tempPassword: password });
});

// Removing someone ends their sessions at once; their account stays as an ordinary shopping account.
staffRouter.delete('/:id', (req, res) => {
  const u = staffMember(req);
  db.get().prepare(`UPDATE users SET role = 'customer', staff_role = NULL, totp_secret = NULL, totp_last_step = 0, recovery_codes = '[]', reset_key_hash = NULL,
    must_change_password = 0 WHERE id = ?`).run(u.id);
  destroyAllSessions(u.id);
  audit(req, 'staff.removed', { staffId: u.id, email: u.email });
  res.json({ ok: true });
});

module.exports = { router, staff: staffRouter };
