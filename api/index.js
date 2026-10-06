'use strict';
// Vercel entry point: one serverless function serves the whole store (pages, API, fonts, pictures).
// Data: connect a Turso database in Vercel (Storage -> Turso). Vercel then sets TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN, and accounts, orders and products are kept for good and shared by every instance.
// Without it the store falls back to SQLite in /tmp, which Vercel wipes on restart (preview only).
process.env.DB_FILE = process.env.DB_FILE || '/tmp/bazaario.db';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';
process.env.INLINE_IMAGES = process.env.INLINE_IMAGES || '1';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
// No database connected: tell the admin portal, so it can warn that accounts and data are temporary.
if (!process.env.TURSO_DATABASE_URL && !process.env.LIBSQL_URL) process.env.TEMPORARY_STORAGE = '1';

const db = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../server');

db.open();
seed();
module.exports = createApp();
