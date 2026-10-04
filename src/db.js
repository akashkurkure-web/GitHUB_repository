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
  status TEXT NOT NULL CHECK (status IN ('placed','confirmed','packed','shipped','out_for_delivery','delivery_failed','delivered',
    'rto','cancelled','return_requested','returned')),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  shipping INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  wallet_used INTEGER NOT NULL DEFAULT 0,
  coupon_code TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','card','upi','emi','wallet')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending','paid','refunded')),
  payment_ref TEXT,
  emi_months INTEGER,
  delivery_speed TEXT NOT NULL DEFAULT 'standard' CHECK (delivery_speed IN ('standard','express')),
  promised_at INTEGER,
  courier TEXT,
  awb TEXT,
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

-- Every status change of an order, shown to the buyer as a tracking timeline.
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

-- SMS, WhatsApp and email messages sent to buyers (the outbox; the test provider only records them).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  refund_to TEXT NOT NULL CHECK (refund_to IN ('wallet','source')),
  status TEXT NOT NULL CHECK (status IN ('requested','pickup_scheduled','refunded','rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Bazaario wallet: credits (refunds) are positive, spends are negative. Balance = SUM(amount).
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_ledger(user_id);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id),
  category TEXT NOT NULL CHECK (category IN ('order','delivery','return','payment','account','grievance','other')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','answered','closed')),
  due_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('customer','agent','system')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One-time sign-in codes sent by SMS. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL
);

-- ---------- Marketplace (blueprint stages 1, 2, 6, 7 and 10) ----------
-- Everyone who sells on Bazaario. Bazaario Direct (our own stock) is the seller with code 'direct' and no user.
CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  lane TEXT NOT NULL CHECK (lane IN ('direct','brand','standard','value')),
  display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  legal_name TEXT NOT NULL,
  gstin TEXT,
  enrolment_id TEXT,
  pan TEXT,
  brand_name TEXT,
  trademark_no TEXT,
  bank_ifsc TEXT,
  bank_last4 TEXT,
  bank_name_at_bank TEXT,
  bank_ref TEXT,
  phone TEXT,
  email TEXT,
  pickup_line1 TEXT,
  pickup_city TEXT,
  pickup_state TEXT NOT NULL,
  pickup_pincode TEXT,
  fulfilment TEXT NOT NULL CHECK (fulfilment IN ('fulfilled','pickup','self')),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','suspended')),
  status_note TEXT NOT NULL DEFAULT '',
  score INTEGER,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- One product page, many sellers: each seller adds an offer (price, stock, dispatch time) to the same listing.
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  price INTEGER NOT NULL CHECK (price > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  dispatch_days INTEGER NOT NULL DEFAULT 1 CHECK (dispatch_days BETWEEN 1 AND 7),
  best_before TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (product_id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_seller ON offers(seller_id);

-- Which seller each order was sent to, and what they did with it (blueprint stage 6, routing).
CREATE TABLE IF NOT EXISTS order_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('waiting','accepted','rejected','expired','seller_cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_routes_seller ON order_routes(seller_id);
CREATE INDEX IF NOT EXISTS idx_routes_order ON order_routes(order_id);

-- Seller claims for returns that came back used, damaged or wrong (blueprint stage 9).
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open','approved','rejected')),
  amount INTEGER NOT NULL DEFAULT 0,
  decision_note TEXT NOT NULL DEFAULT '',
  payout_id INTEGER REFERENCES payouts(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Seller payouts (blueprint stage 10). Each payout has one line per settled order or approved claim.
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_no TEXT NOT NULL UNIQUE,
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  gross INTEGER NOT NULL,
  commission INTEGER NOT NULL,
  fees INTEGER NOT NULL,
  gst_on_fees INTEGER NOT NULL,
  tcs INTEGER NOT NULL,
  tds INTEGER NOT NULL,
  adjustments INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid','failed')),
  utr TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_id INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id),
  claim_id INTEGER REFERENCES claims(id),
  gross INTEGER NOT NULL DEFAULT 0,
  commission INTEGER NOT NULL DEFAULT 0,
  fees INTEGER NOT NULL DEFAULT 0,
  gst_on_fees INTEGER NOT NULL DEFAULT 0,
  tcs INTEGER NOT NULL DEFAULT 0,
  tds INTEGER NOT NULL DEFAULT 0,
  adjustment INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL
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

function open(file = config.dbFile) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Columns added after the first release. They are added here (not in SCHEMA) so new and upgraded stores match.
const ADDED_COLUMNS = [
  ['products', 'image', "TEXT NOT NULL DEFAULT ''"],
  // Marketplace: the winning offer is cached on the product (price, stock, seller), so search and sorting stay simple.
  ['products', 'best_offer_id', 'INTEGER'],
  ['products', 'seller_id', 'INTEGER'],
  ['products', 'assured', 'INTEGER NOT NULL DEFAULT 0'],
  ['products', 'offer_count', 'INTEGER NOT NULL DEFAULT 0'],
  // Mandatory details (Legal Metrology and GST): HSN code, GST rate, country of origin, manufacturer, category specs.
  ['products', 'hsn', "TEXT NOT NULL DEFAULT ''"],
  ['products', 'gst_rate', 'INTEGER NOT NULL DEFAULT 18'],
  ['products', 'origin', "TEXT NOT NULL DEFAULT 'India'"],
  ['products', 'manufacturer', "TEXT NOT NULL DEFAULT ''"],
  ['products', 'specs', "TEXT NOT NULL DEFAULT '{}'"],
  // Catalog quality check for listings created by sellers.
  ['products', 'qc_status', "TEXT NOT NULL DEFAULT 'approved'"],
  ['products', 'qc_note', "TEXT NOT NULL DEFAULT ''"],
  ['products', 'created_by_seller', 'INTEGER'],
  ['cart_items', 'offer_id', 'INTEGER'],
  ['order_items', 'offer_id', 'INTEGER'],
  ['order_items', 'hsn', "TEXT NOT NULL DEFAULT ''"],
  ['order_items', 'gst_rate', 'INTEGER NOT NULL DEFAULT 18'],
  // One checkout makes one order per seller; they share a checkout reference and one payment.
  ['orders', 'seller_id', 'INTEGER'],
  ['orders', 'checkout_ref', 'TEXT'],
  ['orders', 'accept_by', 'INTEGER'],
  ['orders', 'dispatch_by', 'INTEGER'],
  ['orders', 'shipped_at', 'INTEGER'],
  ['orders', 'hold_reason', 'TEXT'],
  ['orders', 'route_reason', "TEXT NOT NULL DEFAULT ''"],
  ['orders', 'payout_id', 'INTEGER'],
];

/** Brings databases created by older versions up to the current schema. */
function migrate(d) {

  // Orders gained new statuses (confirmed, out for delivery, failed delivery, RTO), wallet, EMI and delivery speed.
  // SQLite cannot change a CHECK rule in place, so the table is rebuilt once, keeping every row.
  const ordersSql = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get().sql;
  if (!ordersSql.includes('out_for_delivery')) {
    const create = SCHEMA.slice(SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS orders ('), SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS order_items'))
      .replace('CREATE TABLE IF NOT EXISTS orders (', 'CREATE TABLE orders_new (');
    const keep = 'id, order_no, user_id, status, subtotal, discount, shipping, total, coupon_code, payment_method, payment_status, ' +
      'payment_ref, address, idempotency_key, created_at, updated_at, delivered_at';
    d.exec('PRAGMA foreign_keys = OFF');
    try {
      d.exec('BEGIN IMMEDIATE');
      d.exec(create);
      d.exec(`INSERT INTO orders_new (${keep}) SELECT ${keep} FROM orders`);
      d.exec('DROP TABLE orders');
      d.exec('ALTER TABLE orders_new RENAME TO orders');
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    } finally {
      d.exec('PRAGMA foreign_keys = ON');
    }
  }

  const exists = (t) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  for (const [table, col, decl] of ADDED_COLUMNS) {
    if (!exists(table)) continue;
    const have = d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!have.includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
  d.exec('CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id)');
  d.exec('CREATE INDEX IF NOT EXISTS idx_orders_checkout ON orders(checkout_ref)');
  // Every product gets a Bazaario Direct offer from its old price and stock (needs the market module, loaded late).
  if (exists('sellers')) require('./market').backfill(d);
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

module.exports = { open, get, tx, close, migrate };
