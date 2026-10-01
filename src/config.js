'use strict';
const path = require('node:path');

const env = process.env;

module.exports = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  // Number of reverse-proxy hops to trust for client IP / protocol (Render, Codespaces, Nginx).
  trustProxy: env.TRUST_PROXY !== undefined ? Number(env.TRUST_PROXY) : (env.NODE_ENV === 'production' ? 1 : 0),
  port: Number(env.PORT) || 3000,
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'bazaario.db'),
  storeName: env.STORE_NAME || 'Bazaario',
  // Session lifetime (ms) - 7 days, sliding.
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  // Account lockout policy
  maxFailedLogins: 5,
  lockoutMs: 15 * 60 * 1000,
  // Commerce rules (all money in paise: 1 INR = 100 paise)
  freeShippingThreshold: 49900,
  shippingFee: 4000,
  codFee: 0,
  codMaxOrder: 5000000,
  maxQtyPerItem: 10,
  returnWindowDays: 10,
  adminEmail: env.ADMIN_EMAIL || 'admin@bazaario.local',
  adminPassword: env.ADMIN_PASSWORD || null,
};
