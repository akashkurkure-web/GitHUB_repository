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
        'img-src': ["'self'", 'data:'],
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
  }));
  api.use('/auth', require('./src/routes/auth'));
  api.use('/', require('./src/routes/catalog'));
  api.use('/', require('./src/routes/orders').router);
  api.use('/admin', require('./src/routes/admin'));
  api.use('/', require('./src/routes/shopping'));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  app.use('/api', api);
  // Self-hosted web fonts (Fraunces + Manrope), so the CSP can stay 'self'-only.
  app.use('/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource'), { maxAge: '30d', immutable: true }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
  // SPA fallback (hash routing, so only "/" really needs it).
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // Central error handler: never leaks stack traces or SQL errors to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
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
  app.listen(config.port, () => console.log(`${config.storeName} running at http://localhost:${config.port}`));
}

module.exports = { createApp };
