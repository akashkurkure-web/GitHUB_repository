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
  // Admin portal: sessions last at most 12 hours and end after 30 minutes without activity.
  adminSessionTtlMs: 12 * 60 * 60 * 1000,
  adminIdleMs: 30 * 60 * 1000,
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
  // ---------- Express from partner shops and riders (blueprint stages 1, 6, 7a and 8) ----------
  express: {
    // A partner shop must accept an Express order within 2 minutes, or the next shop is tried.
    shopAcceptMs: 2 * 60_000,
    // Shops choose how far they deliver.
    shopRadiusKm: { min: 2, max: 5 },
    // Minutes a shop or city store takes to pack an Express order.
    prepMins: 10,
    // Rider travel: average city speed, a factor for roads not being straight lines, and the hand-over time.
    riderSpeedKmh: 18,
    roadFactor: 1.3,
    handoverMins: 2,
    // A rider carries at most this many Express orders at once.
    riderMaxLoad: 2,
    // Rider pay per delivery: a base fee plus a fee per km from pickup to drop (paise).
    riderFeeBase: 3000,
    riderFeePerKm: 800,
    // Commission on the item price for partner shops; they are paid the day after delivery.
    shopCommission: 10,
    shopPayoutDays: 1,
    // In test mode riders move on their own along the route, so Express orders can be followed end to end.
    simulateRiders: (env.COURIER_PROVIDER || 'test') === 'test' && env.RIDER_SIMULATION !== '0',
  },

  // ---------- Resellers (blueprint stages 3, 10 and 12) ----------
  reseller: {
    // A reseller adds their own margin on top of Bazaario's price, up to this share of the price and never above MRP.
    maxMarginPct: 30,
    // Income-tax TDS on commission (section 194H) once a reseller's earnings in the financial year cross the threshold.
    // Placeholders: have a CA confirm the rate and threshold.
    tdsPct: 2,
    tdsThreshold: 2000000,
  },

  // ---------- Growth and loyalty (blueprint stage 12) ----------
  plus: {
    // Bazaario Plus: free Standard delivery on every order, a lower Express fee and early access to sales.
    plans: { monthly: { price: 9900, months: 1 }, yearly: { price: 99900, months: 12 } },
    expressFee: 1900,
    earlyHours: 24,
  },
  // Referrals: both people get wallet money once the friend's first order is delivered.
  referral: { referrerReward: 10000, friendReward: 10000, maxPerMonth: 20 },
  // Sponsored listings: sellers pay per click, between these bids (paise), within a daily budget.
  ads: { minBid: 200, maxBid: 5000, minDailyBudget: 10000, slots: 2 },
  // Win-back messages: abandoned bags after this many hours, wishlist price drops of at least this share.
  winback: { cartHours: 24, cartMaxDays: 7, priceDropPct: 5, repeatDays: 3 },
  adminEmail: env.ADMIN_EMAIL || 'admin@bazaario.local',
  adminPassword: env.ADMIN_PASSWORD || null,
};
