'use strict';
const path = require('node:path');

const env = process.env;

module.exports = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  // Number of reverse-proxy hops to trust for client IP / protocol (Render, Codespaces, Nginx).
  trustProxy: env.TRUST_PROXY !== undefined ? Number(env.TRUST_PROXY) : (env.NODE_ENV === 'production' ? 1 : 0),
  port: Number(env.PORT) || 3000,
  // Hosted libSQL / Turso database (keeps data across restarts). Unset = local SQLite file at dbFile.
  databaseUrl: env.TURSO_DATABASE_URL || env.LIBSQL_URL || '',
  databaseToken: env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || '',
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'bazaario.db'),
  // Product photos uploaded in Bazaario Studio. Keep this on persistent storage, next to the database.
  uploadDir: env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'),
  // Store uploaded photos inside the database instead of as files (used by the single-page demo build).
  inlineImages: env.INLINE_IMAGES === '1',
  maxImageBytes: 2 * 1024 * 1024,
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
