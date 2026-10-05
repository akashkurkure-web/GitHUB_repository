'use strict';
// Vercel entry point: one serverless function serves the whole store (pages, API, fonts, pictures).
// Vercel's disk is read-only except /tmp, and /tmp is wiped whenever the function restarts, so a
// Vercel deployment is a preview: the catalogue is re-seeded on each cold start and new accounts,
// bags and orders do not last. Use Render (render.yaml) or a hosted database for a real store.
process.env.DB_FILE = process.env.DB_FILE || '/tmp/bazaario.db';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';
process.env.INLINE_IMAGES = process.env.INLINE_IMAGES || '1';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';

const db = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../server');

db.open();
seed();
module.exports = createApp();
