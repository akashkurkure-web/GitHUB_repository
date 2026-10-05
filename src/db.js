'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  description TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '[]',
  price INTEGER NOT NULL CHECK (price > 0),
  mrp INTEGER NOT NULL CHECK (mrp > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  emoji TEXT NOT NULL DEFAULT '📦',
  color TEXT NOT NULL DEFAULT '#e3e6e6',
  image TEXT NOT NULL DEFAULT '',
  express INTEGER NOT NULL DEFAULT 0,
  is_deal INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (product_id, user_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty > 0),
  saved_for_later INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','flat')),
  value INTEGER NOT NULL,
  max_discount INTEGER,
  min_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('placed','packed','shipped','delivered','cancelled','return_requested','returned')),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  shipping INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  coupon_code TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','card','upi')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending','paid','refunded')),
  payment_ref TEXT,
  address TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  title TEXT NOT NULL,
  emoji TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
`;

/**
 * Opens the store database. With TURSO_DATABASE_URL set (Vercel's Turso integration adds it), the data lives
 * in a hosted libSQL database so it survives restarts and is shared by every server instance; otherwise it is
 * a local SQLite file. Both drivers expose the same synchronous prepare/get/all/run/exec API.
 */
function open(file = config.dbFile) {
  if (db) return db;
  if (config.databaseUrl && file !== ':memory:') {
    const Database = require('libsql');
    db = libsqlAdapter(new Database(config.databaseUrl, { authToken: config.databaseToken }));
    db.exec(SCHEMA.replace('PRAGMA journal_mode = WAL;', '')); // WAL is a local-file setting
    checkColumnNames(db);
  } else {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec(SCHEMA);
  }
  migrate(db);
  return db;
}

/** Brings databases created by older versions up to the current schema. */
/**
 * Makes a libsql connection behave like node:sqlite for this app. A libSQL server re-spells SQL keywords used
 * as names in upper case (a column called action comes back as ACTION, an alias "AS plan" as PLAN), and adds
 * a _metadata field to every row. So column definitions are quoted when tables are created, all-caps keys are
 * turned back to lower case (the app never uses all-caps names), and _metadata is dropped.
 */
function libsqlAdapter(raw) {
  const clean = (row) => {
    if (!row || typeof row !== 'object') return row;
    delete row._metadata;
    for (const k of Object.keys(row)) {
      if (k.length > 1 && /^[A-Z_]+$/.test(k) && !(k.toLowerCase() in row)) { row[k.toLowerCase()] = row[k]; delete row[k]; }
    }
    return row;
  };
  const quoteColumns = (sql) => sql
    .replace(/^(\s*)([a-z_][a-z0-9_]*)(\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)\b)/gim, '$1"$2"$3')
    .replace(/(ADD\s+COLUMN\s+)([a-z_][a-z0-9_]*)\b/gi, '$1"$2"');
  return {
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        get: (...args) => clean(st.get(...args)),
        all: (...args) => st.all(...args).map(clean),
        iterate: function* (...args) { for (const row of st.iterate(...args)) yield clean(row); },
        run: (...args) => { const r = st.run(...args); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
      };
    },
    exec: (sql) => raw.exec(/\b(CREATE\s+TABLE|ADD\s+COLUMN)\b/i.test(sql) ? quoteColumns(sql) : sql),
    close: () => raw.close(),
  };
}

/** Safety net: every column must come out lower-case, as the app spells them. */
function checkColumnNames(d) {
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    const bad = d.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name).filter((c) => c !== c.toLowerCase());
    if (bad.length) throw new Error(`Columns ${bad.join(', ')} in table ${name} were created in upper case by the database server.`);
  }
}

function migrate(d) {
  const cols = d.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!cols.includes('image')) d.exec("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''");
}

function get() {
  return db || open();
}

/** Run fn inside a transaction; rolls back on throw. */
function tx(fn) {
  const d = get();
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

function close() {
  if (db) db.close();
  db = undefined;
}

module.exports = { open, get, tx, close };
