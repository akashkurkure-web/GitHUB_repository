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
  // Express delivery from city stores (blueprint stage 7a): fee per order, and the hours riders work (IST).
  expressFee: 4900,
  expressOpenHour: 8,
  expressCloseHour: 21,
  // No-cost EMI on cards for orders of ₹3,000 and above.
  emiMinOrder: 300000,
  emiMonths: [3, 6, 9],
  // COD is paused for a buyer after this many refused deliveries (returned to origin).
  codMaxRefusals: 2,
  // Support: first-reply target for tickets, and the legal resolution limit for grievances.
  ticketSlaHours: 24,
  grievanceDays: 30,
  // Payment, courier and SMS partners. Until real accounts are connected, Bazaario runs them in test mode:
  // payments are simulated, AWB numbers are generated, and messages are recorded in Studio instead of being sent.
  paymentProvider: env.PAYMENT_PROVIDER || 'test',
  courierProvider: env.COURIER_PROVIDER || 'test',
  smsProvider: env.SMS_PROVIDER || 'test',
  // Mobile OTP sign-in. In test mode the code is shown on screen, so it is switched off on a live (production)
  // store until a real SMS partner is connected.
  otpEnabled: (env.SMS_PROVIDER || 'test') !== 'test' || env.NODE_ENV !== 'production',
  otpTtlMs: 5 * 60 * 1000,
  otpResendMs: 30 * 1000,
  otpMaxAttempts: 5,
  // Required by the Consumer Protection (E-Commerce) Rules 2020. Replace the defaults before going live.
  grievanceOfficer: {
    name: env.GRIEVANCE_OFFICER_NAME || 'Grievance Officer (name to be added)',
    email: env.GRIEVANCE_OFFICER_EMAIL || 'grievance@bazaario.example',
    phone: env.GRIEVANCE_OFFICER_PHONE || '',
    address: env.GRIEVANCE_OFFICER_ADDRESS || 'Registered office address to be added',
  },
  // Legal entity shown on policy pages and invoices.
  companyName: env.COMPANY_NAME || 'Bazaario Retail (company details to be added)',
  adminEmail: env.ADMIN_EMAIL || 'admin@bazaario.local',
  adminPassword: env.ADMIN_PASSWORD || null,
};
