'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { HttpError } = require('./security');

/**
 * Seller KYC checks (blueprint stage 1): GSTIN, PAN, IFSC and the one-rupee "penny drop" bank check.
 * The format and checksum rules are the public ones; whether a number is really registered is checked by the
 * KYC partner once one is connected (GST and PAN verification APIs from Signzy, Karza, Cashfree or Razorpay).
 */

// First two digits of a GSTIN are the state code.
const GST_STATE = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland',
  14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha',
  22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra',
  29: 'Karnataka', 30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman and Nicobar Islands',
  36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh',
};

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character of a GSTIN is a checksum of the first 14. */
function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

const PAN_RE = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;

function pan(val) {
  const s = String(val || '').trim().toUpperCase();
  if (!PAN_RE.test(s)) throw new HttpError(400, 'PAN is not valid. It has 10 characters, like ABCDE1234F.');
  return s;
}

/** Checks a GSTIN's format, state code and checksum. Returns { gstin, state, pan }. */
function gstin(val) {
  const s = String(val || '').trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) {
    throw new HttpError(400, 'GSTIN is not valid. It has 15 characters, like 27ABCDE1234F1Z5.');
  }
  const state = GST_STATE[s.slice(0, 2)];
  if (!state) throw new HttpError(400, 'The first two digits of the GSTIN are not a valid state code.');
  if (gstinCheckChar(s.slice(0, 14)) !== s[14]) throw new HttpError(400, 'GSTIN is not valid. Please check it for typing mistakes.');
  return { gstin: s, state, pan: s.slice(2, 12) };
}

/** GST enrolment ID for small sellers who are not registered for GST (allowed to sell within their own state). */
function enrolmentId(val) {
  const s = String(val || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{15}$/.test(s)) throw new HttpError(400, 'GST enrolment ID is not valid. It has 15 letters and digits.');
  return s;
}

function ifsc(val) {
  const s = String(val || '').trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) throw new HttpError(400, 'IFSC is not valid. It has 11 characters, like HDFC0001234.');
  return s;
}

function accountNumber(val) {
  const s = String(val || '').replace(/\s/g, '');
  if (!/^\d{9,18}$/.test(s)) throw new HttpError(400, 'Bank account number must be 9 to 18 digits.');
  return s;
}

/**
 * Penny drop: sends ₹1 to the account and reads back the name the bank holds, so payouts go to the right person.
 * The test provider accepts any valid account and echoes the legal name. A real payout partner returns the
 * bank's own record, which Studio compares with the legal name before approving.
 * The full account number is handed to the payout partner and only its last four digits are kept here.
 */
function pennyDrop({ account, ifsc: code, legalName }) {
  if (config.paymentProvider !== 'test') throw new HttpError(503, 'Bank verification is not set up yet. Please try again later.');
  return { nameAtBank: legalName.toUpperCase(), ref: `BENE-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, last4: account.slice(-4), ifsc: code };
}

module.exports = { gstin, gstinCheckChar, pan, enrolmentId, ifsc, accountNumber, pennyDrop, GST_STATE };
