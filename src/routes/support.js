'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const notify = require('../notify');
const { HttpError, requireAuth, requireAdmin, audit, v } = require('../security');

/** Help desk (blueprint stage 11): buyers raise tickets, the Studio team answers them within the SLA. */
const router = express.Router();

const CATEGORIES = {
  order: 'An order', delivery: 'Delivery', return: 'Return or refund', payment: 'Payment', account: 'My account',
  grievance: 'Complaint to the Grievance Officer', other: 'Something else',
};

const ticketNo = () => `TK${Date.now().toString(36).toUpperCase()}${crypto.randomInt(10, 99)}`;

function loadTicket(id, userId) {
  const t = userId
    ? db.get().prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(id, userId)
    : db.get().prepare('SELECT t.*, u.name AS customer, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(id);
  if (!t) throw new HttpError(404, 'Ticket not found.');
  t.order_no = t.order_id ? (db.get().prepare('SELECT order_no FROM orders WHERE id = ?').get(t.order_id) || {}).order_no : null;
  t.messages = db.get().prepare('SELECT author, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(id);
  return t;
}

router.get('/support/categories', (_req, res) => res.json({ categories: CATEGORIES }));

router.get('/tickets', requireAuth, (req, res) => {
  res.json({ tickets: db.get().prepare(
    'SELECT id, ticket_no, category, subject, status, due_at, created_at, updated_at FROM tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100'
  ).all(req.user.id) });
});

router.post('/tickets', requireAuth, (req, res) => {
  const category = String(req.body.category || '');
  if (!CATEGORIES[category]) throw new HttpError(400, 'Please choose what your question is about.');
  const subject = v.str(req.body.subject, 'Subject', { min: 4, max: 120 });
  const body = v.str(req.body.message, 'Message', { min: 10, max: 4000 });
  let orderId = null;
  if (req.body.orderId) {
    orderId = v.int(req.body.orderId, 'Order', { min: 1 });
    if (!db.get().prepare('SELECT 1 FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id)) throw new HttpError(400, 'Order not found.');
  }
  const open = db.get().prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status != 'closed'").get(req.user.id).n;
  if (open >= 10) throw new HttpError(429, 'You have 10 open requests. Please wait for a reply or close one first.');
  const now = Date.now();
  const grievance = category === 'grievance';
  const due = now + (grievance ? config.grievanceDays * 86400_000 : config.ticketSlaHours * 3600_000);
  const no = ticketNo();
  const id = db.tx((d) => {
    const tid = Number(d.prepare(`INSERT INTO tickets (ticket_no, user_id, order_id, category, subject, status, due_at, created_at, updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?)`).run(no, req.user.id, orderId, category, subject, due, now, now).lastInsertRowid);
    const ins = d.prepare('INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?,?,?,?)');
    ins.run(tid, 'customer', body, now);
    // The E-Commerce Rules 2020 require grievances to be acknowledged within 48 hours: do it straight away.
    const ack = grievance
      ? `Your complaint ${no} has reached our Grievance Officer, ${config.grievanceOfficer.name}. We will resolve it within ${config.grievanceDays} days.`
      : `Thanks for writing to us. Your request number is ${no}. We usually reply within ${config.ticketSlaHours} hours.`;
    ins.run(tid, 'system', ack, now);
    notify.send(d, { userId: req.user.id, channel: 'email', recipient: req.user.email, body: `${config.storeName}: ${ack}` });
    return tid;
  });
  audit(req, 'ticket.create', { ticketId: id, category });
  res.status(201).json({ ticket: loadTicket(id, req.user.id) });
});

router.get('/tickets/:id', requireAuth, (req, res) => {
  res.json({ ticket: loadTicket(v.int(req.params.id, 'Ticket', { min: 1 }), req.user.id) });
});

router.post('/tickets/:id/messages', requireAuth, (req, res) => {
  const id = v.int(req.params.id, 'Ticket', { min: 1 });
  const body = v.str(req.body.message, 'Message', { min: 2, max: 4000 });
  const t = loadTicket(id, req.user.id);
  if (t.status === 'closed') throw new HttpError(400, 'This request is closed. Please start a new one.');
  const now = Date.now();
  db.tx((d) => {
    d.prepare('INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?,?,?,?)').run(id, 'customer', body, now);
    // A new message from the buyer reopens the clock for a reply.
    d.prepare(`UPDATE tickets SET status = 'open', updated_at = ?, due_at = CASE WHEN category = 'grievance' THEN due_at ELSE ? END WHERE id = ?`)
      .run(now, now + config.ticketSlaHours * 3600_000, id);
  });
  res.json({ ticket: loadTicket(id, req.user.id) });
});

router.post('/tickets/:id/close', requireAuth, (req, res) => {
  const id = v.int(req.params.id, 'Ticket', { min: 1 });
  loadTicket(id, req.user.id);
  db.get().prepare("UPDATE tickets SET status = 'closed', updated_at = ? WHERE id = ?").run(Date.now(), id);
  res.json({ ticket: loadTicket(id, req.user.id) });
});

// ---------- Studio ticket inbox ----------
router.get('/admin/tickets', requireAdmin, (req, res) => {
  const status = ['open', 'answered', 'closed'].includes(req.query.status) ? req.query.status : null;
  res.json({ tickets: db.get().prepare(
    `SELECT t.id, t.ticket_no, t.category, t.subject, t.status, t.due_at, t.created_at, t.updated_at, u.name AS customer, u.email
       FROM tickets t JOIN users u ON u.id = t.user_id ${status ? 'WHERE t.status = ?' : ''}
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.due_at ASC LIMIT 200`
  ).all(...(status ? [status] : [])), categories: CATEGORIES });
});

router.get('/admin/tickets/:id', requireAdmin, (req, res) => {
  res.json({ ticket: loadTicket(v.int(req.params.id, 'Ticket', { min: 1 })), categories: CATEGORIES });
});

router.post('/admin/tickets/:id/reply', requireAdmin, (req, res) => {
  const id = v.int(req.params.id, 'Ticket', { min: 1 });
  const body = v.str(req.body.message, 'Reply', { min: 2, max: 4000 });
  const t = loadTicket(id);
  const now = Date.now();
  db.tx((d) => {
    d.prepare('INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?,?,?,?)').run(id, 'agent', body, now);
    d.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(req.body.close ? 'closed' : 'answered', now, id);
    notify.send(d, { userId: t.user_id, channel: 'email', recipient: t.email, body: `${config.storeName}: We replied to your request ${t.ticket_no}. Open Help centre > My requests to read it.` });
  });
  audit(req, 'admin.ticket_reply', { ticketId: id });
  res.json({ ticket: loadTicket(id) });
});

module.exports = router;
