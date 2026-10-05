'use strict';
const config = require('./config');

/**
 * Buyer messages by SMS and email (blueprint stage 8).
 * With the test provider, messages are only recorded; Bazaario Studio shows them under Messages.
 * To go live, send them through an SMS and WhatsApp partner (MSG91, Gupshup, Twilio) and an email service here.
 */
function send(d, { userId = null, orderId = null, channel, recipient, body }) {
  if (!recipient) return;
  d.prepare('INSERT INTO notifications (user_id, order_id, channel, recipient, body, provider, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId, orderId, channel, String(recipient), body, channel === 'email' ? 'test' : config.smsProvider, Date.now());
}

/** Sends the same short update by SMS (to the delivery phone) and email (to the account). */
function orderUpdate(d, order, text) {
  const user = d.prepare('SELECT email FROM users WHERE id = ?').get(order.user_id);
  const address = typeof order.address === 'string' ? JSON.parse(order.address) : order.address;
  const body = `${config.storeName}: ${text} Order ${order.order_no}.`;
  send(d, { userId: order.user_id, orderId: order.id, channel: 'sms', recipient: address.phone, body });
  if (user) send(d, { userId: order.user_id, orderId: order.id, channel: 'email', recipient: user.email, body });
}

module.exports = { send, orderUpdate };
