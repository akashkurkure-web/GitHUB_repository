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
  // Bazaario Direct (our own stock) sells under the company's GSTIN, from its warehouse state.
  companyGstin: env.COMPANY_GSTIN || '',
  companyState: env.COMPANY_STATE || 'Maharashtra',

  // ---------- Marketplace (blueprint stages 1, 2, 6, 7 and 10) ----------
  // Starting placeholders from the blueprint. Have a CA confirm the tax rates before go-live.
  market: {
    // Commission on the item price, by category, for brands and Standard sellers. Value sellers pay 0%.
    commission: {
      mobiles: 5, electronics: 8, fashion: 15, 'home-kitchen': 12, books: 8, beauty: 12, sports: 10, toys: 10, grocery: 5, appliances: 6,
    },
    defaultCommission: 10,
    // Flat fee per order (paise) by fulfilment option: Bazaario Fulfilled stores and ships, Pickup collects from the seller.
    fulfilmentFee: { fulfilled: 6000, pickup: 4000, self: 0 },
    gstOnFeesPct: 18,
    // GST TCS (CGST Act section 52) and income-tax TDS (section 194-O), deducted from seller payouts.
    tcsPct: 0.5,
    tdsPct: 0.1,
    // A seller must accept a new order within this many hours, or it moves to the next seller.
    acceptHours: 24,
    // Value sellers ship by economy courier: this many extra days on the delivery promise.
    valueExtraDays: 2,
    // Only brands and Bazaario Direct may sell in these categories (authenticity rule).
    authenticCategories: ['mobiles', 'electronics', 'beauty'],
    // New listings in these categories always go to a person for quality check.
    riskyCategories: ['beauty', 'grocery'],
    // Food and cosmetics must show a best-before date.
    bestBeforeCategories: ['beauty', 'grocery'],
    // Risk rules that hold an order for a person to check before it is sent out.
    holdCodAbove: 1000000,
    holdNewAccountMs: 24 * 3600_000,
    holdBulkQty: 6,
  },
  adminEmail: env.ADMIN_EMAIL || 'admin@bazaario.local',
  adminPassword: env.ADMIN_PASSWORD || null,
};
