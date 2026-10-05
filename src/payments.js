'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { HttpError } = require('./security');

/**
 * Payment gateway adapter (blueprint stage 5).
 * Only the test provider exists today: it validates what the buyer enters and returns a reference, with no real charge.
 * To go live, add a provider here (Razorpay, Cashfree, PayU or PhonePe PG) using its hosted checkout or client-side
 * tokenisation, so card numbers never reach this server, and set PAYMENT_PROVIDER.
 */
function luhn(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const ref = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

function readCard(payment) {
  const number = String((payment && payment.cardNumber) || '').replace(/[\s-]/g, '');
  const expiry = String((payment && payment.expiry) || '');
  const cvv = String((payment && payment.cvv) || '');
  if (!/^\d{12,19}$/.test(number) || !luhn(number)) throw new HttpError(400, 'Please enter a valid card number.');
  const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expiry);
  if (!m) throw new HttpError(400, 'Card expiry must be in MM/YY format.');
  const expEnd = new Date(2000 + Number(m[2]), Number(m[1]), 1).getTime();
  if (expEnd <= Date.now()) throw new HttpError(400, 'This card has expired.');
  if (!/^\d{3,4}$/.test(cvv)) throw new HttpError(400, 'Please enter a valid CVV.');
  return number.slice(-4);
}

/**
 * Charges `amount` paise. Returns { status, ref, emiMonths }.
 * COD stays pending until the courier collects the cash; a fully wallet-paid order needs no gateway.
 */
function charge(method, payment, amount) {
  if (method === 'wallet') {
    if (amount !== 0) throw new HttpError(400, 'Your wallet balance does not cover this order. Please choose another way to pay.');
    return { status: 'paid', ref: ref('WALLET') };
  }
  if (method === 'cod') return { status: 'pending', ref: null };
  if (config.paymentProvider !== 'test') throw new HttpError(503, 'Online payments are not set up yet. Please choose Cash on Delivery.');
  if (method === 'card') return { status: 'paid', ref: `CARD-xxxx${readCard(payment)}-${ref('T').slice(2)}` };
  if (method === 'emi') {
    const months = Number(payment && payment.emiMonths);
    if (!config.emiMonths.includes(months)) throw new HttpError(400, 'Please choose an EMI plan.');
    if (amount < config.emiMinOrder) throw new HttpError(400, `No-cost EMI is available on orders of ₹${config.emiMinOrder / 100} and above.`);
    return { status: 'paid', ref: `EMI${months}-xxxx${readCard(payment)}-${ref('T').slice(2)}`, emiMonths: months };
  }
  if (method === 'upi') {
    const vpa = String((payment && payment.upiId) || '');
    if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa)) throw new HttpError(400, 'Please enter a valid UPI ID (e.g. name@bank).');
    return { status: 'paid', ref: ref('UPI') };
  }
  throw new HttpError(400, 'Please choose a payment method.');
}

/** Refunds money paid through the gateway back to the card, UPI account or bank. Returns the refund reference. */
function refund(order, amount) {
  if (amount <= 0) return null;
  return ref('RFND');
}

module.exports = { charge, refund, luhn };
