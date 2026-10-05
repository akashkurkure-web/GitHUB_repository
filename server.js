'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
const db = require('./src/db');
const { seed } = require('./src/seed');
const { loadSession, csrfProtect, HttpError } = require('./src/security');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy); // behind a TLS-terminating proxy

  // Security headers: strict CSP (no inline script, no third-party origins), HSTS, frame-deny, no-sniff, etc.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        // https: lets a product photo be a link to an image hosted elsewhere (e.g. a CDN).
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'"],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
  });

  // Product photo uploads are larger than any other request; everything else keeps the 50 KB cap.
  app.use(['/api/admin/uploads', '/api/seller/uploads'], express.json({ limit: '3mb' }));
  // A bulk price and stock sheet from Seller Hub can be larger than other requests.
  app.use('/api/seller/offers/bulk', express.json({ limit: '300kb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(rateLimit({
    windowMs: 60 * 1000,
    limit: config.env === 'test' ? 10000 : 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  }));
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use(csrfProtect);

  api.get('/config', (_req, res) => res.json({
    storeName: config.storeName,
    freeShippingThreshold: config.freeShippingThreshold,
    shippingFee: config.shippingFee,
    maxQtyPerItem: config.maxQtyPerItem,
    returnWindowDays: config.returnWindowDays,
    expressFee: config.expressFee,
    emiMinOrder: config.emiMinOrder,
    codMaxOrder: config.codMaxOrder,
    expressCities: Object.values(require('./src/delivery').EXPRESS_CITIES),
    express: { shopAcceptMins: config.express.shopAcceptMs / 60000, prepMins: config.express.prepMins },
    reseller: { maxMarginPct: config.reseller.maxMarginPct },
    plus: { plans: config.plus.plans, expressFee: config.plus.expressFee, earlyHours: config.plus.earlyHours },
    referral: { referrerReward: config.referral.referrerReward, friendReward: config.referral.friendReward },
    testMode: { payments: config.paymentProvider === 'test', courier: config.courierProvider === 'test', sms: config.smsProvider === 'test' },
    otpSignIn: config.otpEnabled,
    grievanceOfficer: config.grievanceOfficer,
    companyName: config.companyName,
  }));
  api.use('/auth', require('./src/routes/auth'));
  // Shared product links open without signing in, so this comes before the routers that require it.
  api.use('/share', require('./src/routes/reseller').share);
  // Plus, sales, referrals, ad clicks and preferences. Routes that need sign-in check it themselves.
  const growthRoutes = require('./src/routes/growth');
  api.use('/', growthRoutes.open);
  api.use('/', growthRoutes.mine);
  api.use('/', require('./src/routes/catalog'));
  api.use('/', require('./src/routes/support'));
  api.use('/', require('./src/routes/orders').router);
  api.use('/seller', require('./src/routes/seller'));
  api.use('/shop', require('./src/routes/shop'));
  api.use('/reseller', require('./src/routes/reseller').router);
  api.use('/admin', growthRoutes.admin);
  api.use('/admin', require('./src/routes/admin-market'));
  api.use('/admin', require('./src/routes/admin'));
  api.use('/', require('./src/routes/shopping'));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  app.use('/api', api);
  // Self-hosted web fonts (Fraunces + Manrope), so the CSP can stay 'self'-only.
  app.use('/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource'), { maxAge: '30d', immutable: true }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));
  app.use(express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    maxAge: config.isProd ? '1h' : 0,
    setHeaders: (res, file) => {
      // The service worker and app manifest must be re-checked on every visit so installed apps pick up updates.
      if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
      if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    },
  }));
  // SPA fallback (hash routing, so only "/" really needs it).
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // Central error handler: never leaks stack traces or SQL errors to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

if (require.main === module) {
  db.open();
  seed();
  const app = createApp();
  // Keeps Express moving without anyone looking: missed 2-minute accepts move on, packed orders get riders.
  setInterval(() => {
    try {
      require('./src/routing').sweep();
      require('./src/hyperlocal').tick(db);
    } catch (err) { console.error(err); }
  }, 15_000).unref();
  // Win-back messages (bag left behind, price drop, back in stock), checked every hour.
  setInterval(() => {
    try { db.tx((d) => require('./src/winback').run(d)); } catch (err) { console.error(err); }
  }, 3600_000).unref();
  app.listen(config.port, () => console.log(`${config.storeName} running at http://localhost:${config.port}`));
}

module.exports = { createApp };
