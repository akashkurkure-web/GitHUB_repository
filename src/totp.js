'use strict';
/**
 * Time-based one-time codes (RFC 6238, the codes Google Authenticator, Microsoft Authenticator and Authy show):
 * HMAC-SHA1, 6 digits, a new code every 30 seconds. No SMS or email partner is needed.
 */
const crypto = require('node:crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, as the base32 text authenticator apps accept. */
const newSecret = () => base32Encode(crypto.randomBytes(20));

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const num = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(num).padStart(DIGITS, '0');
}

/**
 * Checks a code against the current 30-second step and one step either side (phone clocks drift).
 * Returns the step that matched, or -1. A step at or before `lastStep` is refused, so a code works only once.
 */
function verify(secret, code, lastStep = 0, now = Date.now()) {
  if (!secret || typeof code !== 'string' || !/^\d{6}$/.test(code)) return -1;
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastStep) continue;
    const a = Buffer.from(codeAt(secret, step));
    if (crypto.timingSafeEqual(a, Buffer.from(code))) return step;
  }
  return -1;
}

/** The link an authenticator app reads from the QR code. */
function otpauthUri(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { newSecret, codeAt, stepAt, verify, otpauthUri, base32Encode, base32Decode };
