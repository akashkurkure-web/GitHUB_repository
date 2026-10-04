'use strict';
const config = require('./config');
const notify = require('./notify');

/**
 * Win-back messages (blueprint stage 12): a bag left behind, a wishlist item whose price dropped, and a wishlist item
 * that is back in stock. Sent by email and SMS to buyers who allow offers, never twice for the same thing.
 * With the test SMS provider they are only recorded and appear in Studio under Messages.
 */
const W = config.winback;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const rs = (p) => `₹${(p / 100).toLocaleString('en-IN')}`;

function tell(d, user, text) {
  const body = `${config.storeName}: ${text} Reply STOP to stop offers.`;
  notify.send(d, { userId: user.id, channel: 'email', recipient: user.email, body });
  if (user.phone) notify.send(d, { userId: user.id, channel: 'sms', recipient: user.phone, body });
}

const logged = (d, userId, kind, productId, since) => !!d.prepare(
  `SELECT 1 FROM winback_log WHERE user_id = ? AND kind = ? AND COALESCE(product_id, 0) = COALESCE(?, 0) AND created_at >= ?`).get(userId, kind, productId, since);
const log = (d, userId, kind, productId, now) => d.prepare('INSERT INTO winback_log (user_id, kind, product_id, created_at) VALUES (?,?,?,?)').run(userId, kind, productId, now);

/** Sends every message that is due. Must run inside db.tx(). Returns how many of each kind went out. */
function run(d, now = Date.now()) {
  const out = { cart: 0, priceDrop: 0, backInStock: 0 };
  const users = new Map();
  const userOf = (id) => {
    if (!users.has(id)) users.set(id, d.prepare("SELECT id, name, email, phone, marketing_opt_in FROM users WHERE id = ? AND role = 'customer'").get(id) || null);
    return users.get(id);
  };

  // A bag left for a day (but not more than a week), with no order since the last item went in.
  const bags = d.prepare(`SELECT c.user_id, MAX(c.added_at) AS last, COUNT(*) AS n, SUM(c.qty * p.price) AS value,
      (SELECT p2.title FROM cart_items c2 JOIN products p2 ON p2.id = c2.product_id WHERE c2.user_id = c.user_id AND c2.saved_for_later = 0 ORDER BY c2.added_at DESC LIMIT 1) AS title
      FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.saved_for_later = 0 AND p.active = 1 GROUP BY c.user_id`).all();
  for (const b of bags) {
    if (b.last > now - W.cartHours * HOUR || b.last < now - W.cartMaxDays * DAY) continue;
    const u = userOf(b.user_id);
    if (!u || !u.marketing_opt_in) continue;
    if (d.prepare('SELECT 1 FROM orders WHERE user_id = ? AND created_at > ?').get(u.id, b.last)) continue;
    if (logged(d, u.id, 'cart', null, Math.max(b.last, now - W.repeatDays * DAY))) continue;
    const short = b.title.length > 40 ? `${b.title.slice(0, 38)}…` : b.title;
    tell(d, u, `${u.name.split(' ')[0]}, your bag is waiting: ${short}${b.n > 1 ? ` and ${b.n - 1} more` : ''} (${rs(b.value)}). Complete your order before it sells out.`);
    log(d, u.id, 'cart', null, now);
    out.cart += 1;
  }

  // Wishlist: price dropped by at least priceDropPct, or back in stock after being sold out.
  const wishes = d.prepare(`SELECT w.user_id, w.product_id, w.price_at_add, w.stock_at_add, p.title, p.price, p.stock FROM wishlist w
    JOIN products p ON p.id = w.product_id WHERE p.active = 1 AND w.price_at_add IS NOT NULL`).all();
  const setWish = d.prepare('UPDATE wishlist SET price_at_add = ?, stock_at_add = ? WHERE user_id = ? AND product_id = ?');
  for (const w of wishes) {
    const u = userOf(w.user_id);
    const back = w.stock_at_add === 0 && w.stock > 0;
    const dropped = w.stock > 0 && w.price <= Math.floor(w.price_at_add * (1 - W.priceDropPct / 100));
    if (u && u.marketing_opt_in && back && !logged(d, u.id, 'back_in_stock', w.product_id, now - W.repeatDays * DAY)) {
      tell(d, u, `Back in stock: ${w.title} is available again at ${rs(w.price)}. It is in your wishlist.`);
      log(d, u.id, 'back_in_stock', w.product_id, now);
      out.backInStock += 1;
    } else if (u && u.marketing_opt_in && dropped && !logged(d, u.id, 'price_drop', w.product_id, now - W.repeatDays * DAY)) {
      tell(d, u, `Price drop: ${w.title} is now ${rs(w.price)}, down from ${rs(w.price_at_add)}. It is in your wishlist.`);
      log(d, u.id, 'price_drop', w.product_id, now);
      out.priceDrop += 1;
    }
    // Remember today's price and stock, so the next message needs a new drop or a new restock.
    if (w.price !== w.price_at_add || w.stock_at_add !== (w.stock > 0 ? 1 : 0)) {
      setWish.run(back || dropped ? w.price : Math.max(w.price, w.price_at_add), w.stock > 0 ? 1 : 0, w.user_id, w.product_id);
    }
  }
  return out;
}

module.exports = { run };
