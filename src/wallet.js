'use strict';
const db = require('./db');

/** Bazaario wallet balance in paise. */
function balance(userId, d = db.get()) {
  return d.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM wallet_ledger WHERE user_id = ?').get(userId).n;
}

/** Adds (positive) or spends (negative) wallet money. Call inside the same transaction as the order change. */
function post(d, userId, amount, reason, orderId = null) {
  if (!amount) return;
  d.prepare('INSERT INTO wallet_ledger (user_id, amount, reason, order_id, created_at) VALUES (?,?,?,?,?)')
    .run(userId, amount, reason, orderId, Date.now());
}

function history(userId) {
  return db.get().prepare(
    `SELECT w.id, w.amount, w.reason, w.created_at, o.order_no FROM wallet_ledger w
       LEFT JOIN orders o ON o.id = w.order_id WHERE w.user_id = ? ORDER BY w.id DESC LIMIT 100`
  ).all(userId);
}

module.exports = { balance, post, history };
