'use strict';
const config = require('./config');

/**
 * GST invoice and shipping label for an order (blueprint stage 7).
 * The invoice is issued by whoever sold the goods: the seller, or Bazaario for Bazaario Direct stock.
 * A seller registered for GST issues a tax invoice with CGST and SGST (same state) or IGST (another state);
 * a seller with only a GST enrolment ID issues a bill of supply, without tax.
 * Prices on Bazaario include GST, so the taxable value is worked out from the price.
 */

/** Indian financial year of a date, e.g. "26-27" for 1 April 2026 to 31 March 2027 (IST). */
function finYear(ts) {
  const ist = new Date(ts + 330 * 60000);
  const y = ist.getUTCFullYear() - (ist.getUTCMonth() < 3 ? 1 : 0);
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

function supplierOf(seller) {
  if (seller.lane === 'direct') {
    return { name: config.companyName, gstin: config.companyGstin || null, address: 'Bazaario warehouse', state: config.companyState };
  }
  return {
    name: seller.legal_name, tradeName: seller.display_name, gstin: seller.gstin || null, enrolmentId: seller.enrolment_id || null,
    address: [seller.pickup_line1, seller.pickup_city, seller.pickup_pincode].filter(Boolean).join(', '), state: seller.pickup_state,
  };
}

function invoice(d, orderId) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const seller = d.prepare('SELECT * FROM sellers WHERE id = ?').get(o.seller_id);
  const items = d.prepare('SELECT title, hsn, gst_rate, price, qty FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  const buyer = JSON.parse(o.address);
  const supplier = supplierOf(seller);
  const taxInvoice = !!supplier.gstin;
  const intra = supplier.state === buyer.state;
  // Bazaario's coupon lowers what the buyer paid, so it is shared across the lines before tax is worked out.
  let left = o.discount;
  const lines = items.map((it, i) => {
    const amount = it.price * it.qty;
    const share = i === items.length - 1 ? left : Math.floor((o.discount * amount) / Math.max(1, o.subtotal));
    left -= share;
    const value = amount - share;
    const rate = taxInvoice ? it.gst_rate : 0;
    const taxable = Math.round((value * 100) / (100 + rate));
    const tax = value - taxable;
    const cgst = intra ? Math.floor(tax / 2) : 0;
    return { title: it.title, hsn: it.hsn, qty: it.qty, unitPrice: it.price, discount: share, taxable, rate, cgst, sgst: intra ? tax - cgst : 0,
      igst: intra ? 0 : tax, total: value };
  });
  const tot = (k) => lines.reduce((s, l) => s + l[k], 0);
  const date = o.shipped_at || o.created_at;
  return {
    type: taxInvoice ? 'Tax invoice' : 'Bill of supply',
    number: `${seller.code === 'direct' ? 'BZD' : seller.code}/${finYear(date)}/${String(o.id).padStart(6, '0')}`,
    date, orderNo: o.order_no, orderDate: o.created_at, supplier,
    buyer: { name: buyer.fullName, address: [buyer.line1, buyer.line2, buyer.city, buyer.pincode].filter(Boolean).join(', '), state: buyer.state },
    placeOfSupply: buyer.state, intraState: intra, lines,
    totals: { taxable: tot('taxable'), cgst: tot('cgst'), sgst: tot('sgst'), igst: tot('igst'), total: tot('total') },
    fees: o.shipping,
    note: taxInvoice ? 'Prices include GST. Tax is not payable on reverse charge.'
      : 'Bill of supply. The seller is not registered for GST and does not charge GST.',
  };
}

/** Shipping label: who it is from, who it is for, tracking number and any cash to collect. */
function label(d, orderId) {
  const o = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const seller = d.prepare('SELECT * FROM sellers WHERE id = ?').get(o.seller_id);
  const to = JSON.parse(o.address);
  const units = d.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM order_items WHERE order_id = ?').get(orderId).n;
  return {
    orderNo: o.order_no, awb: o.awb, courier: o.courier, speed: o.delivery_speed, units,
    cod: o.payment_method === 'cod' && o.payment_status === 'pending' ? o.total - o.wallet_used : 0,
    from: seller.lane === 'direct' || seller.fulfilment === 'fulfilled'
      ? { name: `${config.storeName} warehouse`, address: config.companyState, phone: '' }
      : { name: seller.display_name, address: [seller.pickup_line1, seller.pickup_city, seller.pickup_state, seller.pickup_pincode].filter(Boolean).join(', '), phone: seller.phone || '' },
    to: { name: to.fullName, address: [to.line1, to.line2, to.city, to.state].filter(Boolean).join(', '), pincode: to.pincode, phone: to.phone },
  };
}

module.exports = { invoice, label, finYear };
