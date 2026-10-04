/* Bazaario marketplace screens: Sell on Bazaario, Seller Hub, the Studio marketplace tabs, and printable
 * invoices and shipping labels. Loaded after app.js and uses its helpers (h, api, mount, toast, inr, ...).
 * Like app.js, everything is rendered with DOM APIs, never innerHTML. */
'use strict';

// ---------------- Small shared helpers ----------------
/** Asks for a short piece of text (a reason) in the dialog. Resolves to the text, or null when cancelled. */
function askText(title, { label = 'Reason', placeholder = '', yes = 'Confirm', hint = '', min = 3 } = {}) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    const input = h('input', { maxLength: 300, required: true, minLength: min, placeholder });
    let answered = false;
    const done = (val) => { answered = true; modal.close(); resolve(val); };
    $('#modal-body').replaceChildren(h('h3', null, title), hint ? h('p', { class: 'muted small' }, hint) : null,
      h('form', { onsubmit: (e) => { e.preventDefault(); done(input.value.trim()); } }, h('label', null, label), input,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-outline' }, yes),
          h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Go back'))));
    modal.addEventListener('close', () => { if (!answered) resolve(null); }, { once: true });
    modal.showModal();
    input.focus();
  });
}

const pctText = (x) => `${Math.round(x * 1000) / 10}%`;
const monthText = (ym) => new Date(`${ym}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: TZ, month: 'short', year: 'numeric' });
const field = (label, input, opts = {}) => h('div', { class: opts.full ? 'full' : '' }, h('label', null, label), input, opts.hint instanceof Node ? opts.hint : opts.hint ? h('p', { class: 'hint' }, opts.hint) : null);
const sellerStatusText = {
  pending: 'We are checking your details. This usually takes one working day. We will email you when your account is approved.',
  rejected: 'We could not approve your application.',
  suspended: 'Your seller account is paused, and your listings are hidden from the store.',
};

/** Downloads rows as a CSV file the seller can open in Excel or Google Sheets. */
function downloadCsv(name, rows) {
  const esc = (c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// GSTIN checksum, the same rule the server checks, so typing mistakes show up at once.
function gstinValid(s) {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false;
  const B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = B.indexOf(s[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return B[(36 - (sum % 36)) % 36] === s[14];
}

// ---------------- Sell on Bazaario (sign-up, blueprint stage 1) ----------------
async function viewSell() {
  document.title = 'Sell on Bazaario';
  const me = state.user ? await api('GET', '/seller/me') : null;
  const plans = me ? me.plans : null;
  const s = me && me.seller;
  if (s && s.status === 'approved') { location.hash = s.lane === 'shop' ? '#/shop' : '#/seller'; return; }
  if (s && s.lane === 'shop') { location.hash = '#/partner'; return; }

  const laneCard = (k, l) => h('div', { class: 'card lane' }, h('h3', null, l.name), h('p', { class: 'small' }, l.fee), h('p', { class: 'hint' }, `You need: ${l.docs}`));
  const lanes = { brand: { name: 'Brand', fee: 'Commission 5-15% by category. Sell in every category, including beauty, mobiles and electronics.', docs: 'GSTIN, PAN, bank account and trademark number' },
    standard: { name: 'Standard seller', fee: 'Commission 5-15% by category, with fast payouts and the Assured badge for top sellers.', docs: 'GSTIN, PAN and bank account' },
    value: { name: 'Value seller', fee: '0% commission for small sellers and makers. You sell within your own state.', docs: 'PAN, bank account and GST enrolment ID' } };
  const intro = [
    h('h1', { class: 'page-title' }, 'Sell on Bazaario'),
    h('p', { class: 'tagline' }, 'Reach buyers across India. Bazaario handles payments, delivery and customer support, and pays you every week.'),
    h('div', { class: 'lane-grid' }, Object.entries(lanes).map(([k, l]) => laneCard(k, l))),
    h('div', { class: 'card steps-card' }, h('h3', null, 'How it works'),
      h('ol', { class: 'plain-steps' },
        h('li', null, h('b', null, 'Register. '), 'Choose how you sell and share your GST, PAN and bank details. We check them and confirm your bank account with a ₹1 deposit.'),
        h('li', null, h('b', null, 'List. '), 'Add your price to products already on Bazaario, or create a new product page. New pages get a quick quality check.'),
        h('li', null, h('b', null, 'Ship. '), 'Accept each order within 24 hours, pack it and hand it to our courier, or ship it yourself.'),
        h('li', null, h('b', null, 'Get paid. '), 'Money is released once the 10-day return window closes, minus commission, fees and the taxes the law requires us to deduct.'))),
  ];

  if (!state.user) {
    mount(intro, h('p', null, h('a', { class: 'btn btn-primary', href: '#/login?next=' + encodeURIComponent('#/sell') }, 'Sign in to start selling'),
      ' ', h('a', { class: 'btn btn-outline', href: '#/register?next=' + encodeURIComponent('#/sell') }, 'Create an account')));
    return;
  }
  if (s && s.status !== 'rejected') {
    mount(h('h1', { class: 'page-title' }, 'Sell on Bazaario'), h('div', { class: 'card' }, h('h3', null, `${s.displayName} · ${s.laneName}`),
      h('p', null, sellerStatusText[s.status]), s.statusNote ? h('p', { class: 'low' }, s.statusNote) : null,
      h('p', { class: 'hint' }, `Applied on ${fmtDate(s.createdAt)}.`)));
    return;
  }
  mount(intro, s ? h('div', { class: 'alert alert-err' }, h('b', null, `${sellerStatusText.rejected} `), s.statusNote, ' Correct your details below and apply again.') : null,
    applyForm(me, s));
}

function applyForm(me, prev, { shop = false } = {}) {
  const sel = { lane: shop ? 'shop' : (prev && prev.lane !== 'shop' && prev.lane) || 'standard', fulfilment: (prev && prev.fulfilment) || 'pickup' };
  const inp = (attrs) => h('input', attrs);
  const f = {
    displayName: inp({ required: true, maxLength: 60, value: prev ? prev.displayName : '', placeholder: 'Shown to buyers, for example Sharma Home Store' }),
    legalName: inp({ required: true, maxLength: 120, value: prev ? prev.legalName : '', placeholder: 'As on your PAN or GST certificate' }),
    phone: inp({ required: true, maxLength: 10, inputMode: 'numeric', value: (prev && prev.phone) || state.user.phone || '', placeholder: '10-digit mobile number' }),
    gstin: inp({ maxLength: 15, value: (prev && prev.gstin) || '', placeholder: '27ABCDE1234F1Z5', autocapitalize: 'characters' }),
    pan: inp({ maxLength: 10, value: (prev && prev.pan) || '', placeholder: 'ABCDE1234F', autocapitalize: 'characters' }),
    enrolmentId: inp({ maxLength: 15, value: (prev && prev.enrolmentId) || '', autocapitalize: 'characters' }),
    brandName: inp({ maxLength: 60, value: (prev && prev.brandName) || '' }),
    trademarkNo: inp({ maxLength: 9, inputMode: 'numeric', value: (prev && prev.trademarkNo) || '' }),
    pickupLine1: inp({ required: true, maxLength: 160, value: prev ? prev.pickup.line1 || '' : '', placeholder: 'Shop or warehouse address' }),
    pickupCity: inp({ required: true, maxLength: 60, value: prev ? prev.pickup.city || '' : '' }),
    pickupPincode: inp({ required: true, maxLength: 6, inputMode: 'numeric', value: prev ? prev.pickup.pincode || '' : '' }),
    accountNumber: inp({ required: true, maxLength: 18, inputMode: 'numeric', autocomplete: 'off' }),
    accountConfirm: inp({ required: true, maxLength: 18, inputMode: 'numeric', autocomplete: 'off' }),
    ifsc: inp({ required: true, maxLength: 11, value: prev && prev.bank ? prev.bank.ifsc : '', placeholder: 'HDFC0001234', autocapitalize: 'characters' }),
    fssai: inp({ maxLength: 14, inputMode: 'numeric', value: (prev && prev.shop && prev.shop.fssai) || '', placeholder: '14 digits, for food and grocery' }),
  };
  // Partner shops: how far they deliver and when they are open.
  const R = me.plans.shopRadiusKm || { min: 2, max: 5 };
  const hourOpt = (hr, pick) => h('option', { value: hr, selected: hr === pick }, `${hr % 12 || 12}:00 ${hr < 12 || hr === 24 ? 'am' : 'pm'}${hr === 24 ? ' (midnight)' : ''}`);
  const radius = h('select', null, Array.from({ length: R.max - R.min + 1 }, (_, i) => R.min + i)
    .map((km) => h('option', { value: km, selected: km === ((prev && prev.shop && prev.shop.radiusKm) || 3) }, `${km} km`)));
  const openHour = h('select', null, Array.from({ length: 24 }, (_, i) => hourOpt(i, (prev && prev.shop && prev.shop.openHour) ?? 8)));
  const closeHour = h('select', null, Array.from({ length: 24 }, (_, i) => hourOpt(i + 1, (prev && prev.shop && prev.shop.closeHour) ?? 22)));
  const state_ = h('select', { required: true }, h('option', { value: '' }, 'Choose a state'),
    me.states.map((st) => h('option', { value: st, selected: prev && prev.pickup.state === st }, st)));
  const agree = h('input', { type: 'checkbox' });
  const gstHint = h('p', { class: 'hint' }, 'The state in your GSTIN must match your pickup address.');
  f.gstin.addEventListener('input', () => {
    const g = f.gstin.value.trim().toUpperCase();
    if (g.length < 15) { gstHint.className = 'hint'; gstHint.textContent = 'The state in your GSTIN must match your pickup address.'; return; }
    const ok = gstinValid(g);
    gstHint.className = ok ? 'hint ok' : 'hint err';
    gstHint.textContent = ok ? `Valid format. PAN ${g.slice(2, 12)}.` : 'This GSTIN does not look right. Please check it for typing mistakes.';
  });

  const gstBox = h('div', { class: 'form-grid' }, field('GSTIN', f.gstin, { hint: gstHint }));
  const valueBox = h('div', { class: 'form-grid' }, field('PAN', f.pan), field(shop ? 'GST enrolment ID (optional)' : 'GST enrolment ID', f.enrolmentId,
    { hint: shop ? 'Only if you have one. A shop not registered for GST can join with its PAN.' : 'For sellers not registered for GST. You can sell only within your own state.' }));
  const shopBox = h('div', { class: 'form-grid' }, field('Delivery radius', radius, { hint: 'Express riders bring your orders to buyers within this distance.' }),
    field('FSSAI licence (optional)', f.fssai), field('Opens at', openHour), field('Closes at', closeHour));
  const brandBox = h('div', { class: 'form-grid' }, field('Brand name', f.brandName), field('Trademark application or registration number', f.trademarkNo));
  const paintLane = () => {
    gstBox.classList.toggle('hidden', sel.lane === 'value');
    valueBox.classList.toggle('hidden', sel.lane !== 'value' && sel.lane !== 'shop');
    brandBox.classList.toggle('hidden', sel.lane !== 'brand');
  };
  const radioCards = (name, options, key) => h('div', { class: 'choice-grid' }, Object.entries(options).map(([k, o]) => h('label', { class: 'addr-opt' + (sel[key] === k ? ' sel' : '') },
    h('input', { type: 'radio', name, checked: sel[key] === k, onchange: (e) => {
      sel[key] = k;
      e.target.closest('.choice-grid').querySelectorAll('.addr-opt').forEach((x) => x.classList.remove('sel'));
      e.target.closest('.addr-opt').classList.add('sel');
      paintLane();
    } }), h('span', null, h('b', null, o.name), h('div', { class: 'hint' }, o.text || o.fee)))));
  paintLane();

  const err = h('div', { class: 'alert alert-err hidden' });
  const submit = h('button', { class: 'btn btn-primary' }, prev ? 'Apply again' : 'Submit application');
  return h('form', { class: 'card apply', onsubmit: async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    submit.disabled = true;
    try {
      const body = { lane: sel.lane, fulfilment: sel.fulfilment, agree: agree.checked, pickupState: state_.value };
      for (const [k, el] of Object.entries(f)) body[k] = el.value.trim();
      if (sel.lane === 'value') { delete body.gstin; } else if (sel.lane === 'shop') {
        if (!body.gstin) delete body.gstin; else delete body.pan;
        if (!body.enrolmentId) delete body.enrolmentId;
        if (!body.fssai) delete body.fssai;
        Object.assign(body, { radiusKm: Number(radius.value), openHour: Number(openHour.value), closeHour: Number(closeHour.value) });
      } else { delete body.enrolmentId; if (!body.pan) delete body.pan; }
      if (sel.lane !== 'shop') delete body.fssai;
      await api('POST', '/seller/apply', body);
      toast(shop ? 'Shop registered. We will email you once it is approved.' : 'Application sent. We will email you once it is approved.');
      route();
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' }); }
    submit.disabled = false;
  } },
  h('h2', null, shop ? 'Register your shop' : 'Register as a seller'), err,
  shop ? null : [h('h4', null, '1. How do you want to sell?'),
    radioCards('lane', Object.fromEntries(Object.entries(me.plans.lanes).filter(([k]) => k !== 'shop')), 'lane'),
    h('p', { class: 'hint' }, 'Run a neighbourhood shop? ', h('a', { href: '#/partner' }, 'Join as a partner shop'), ' and deliver by Express.')],
  h('h4', null, `${shop ? 1 : 2}. Your business`),
  h('div', { class: 'form-grid' }, field('Shop name', f.displayName), field('Legal name', f.legalName), field('Mobile number', f.phone)),
  shop ? h('p', { class: 'hint' }, 'Registered for GST? Enter your GSTIN. If not, leave it empty and enter your PAN below.') : null,
  gstBox, valueBox, brandBox,
  h('h4', null, `${shop ? 2 : 3}. ${shop ? 'Shop address' : 'Pickup address'}`),
  h('div', { class: 'form-grid' }, field('Address', f.pickupLine1, { full: true }), field('City', f.pickupCity), field('State', state_), field('PIN code', f.pickupPincode)),
  shop ? [h('h4', null, '3. Delivery area and hours'), shopBox] : null,
  h('h4', null, '4. Bank account for payouts'),
  h('div', { class: 'form-grid' }, field('Account number', f.accountNumber), field('Re-enter account number', f.accountConfirm), field('IFSC', f.ifsc)),
  h('p', { class: 'hint' }, 'We confirm the account with a ₹1 deposit. Only the last four digits are kept on Bazaario; the full number goes to our payout partner.'),
  shop ? null : [h('h4', null, '5. How will orders be shipped?'), radioCards('fulfilment', me.plans.fulfilment, 'fulfilment')],
  h('label', { class: 'inline' }, agree, 'I agree to the ', h('a', { href: '#/page/terms', target: '_blank' }, 'seller terms'), ' and confirm my details are correct.'),
  h('p', null, submit));
}

// ---------------- Seller Hub ----------------
const HUB_TABS = [['overview', 'Overview'], ['orders', 'Orders'], ['listings', 'Listings'], ['add', 'Add a product'], ['returns', 'Returns and claims'],
  ['payouts', 'Payouts'], ['account', 'Account']];

async function viewSellerHub(params) {
  if (!state.user) { location.hash = '#/login?next=' + encodeURIComponent('#/seller'); return; }
  const me = await api('GET', '/seller/me');
  if (!me.seller || me.seller.status === 'rejected' || me.seller.status === 'pending') { location.hash = '#/sell'; return; }
  document.title = 'Seller Hub · Bazaario';
  const s = me.seller;
  const qp = new URLSearchParams(params);
  const tab = HUB_TABS.some(([k]) => k === qp.get('tab')) ? qp.get('tab') : 'overview';
  const head = [h('h1', { class: 'page-title' }, 'Seller Hub'),
    h('p', { class: 'tagline' }, `${s.displayName} · ${s.laneName} · ${s.fulfilmentName}`,
      s.lane === 'shop' ? [' · ', h('a', { href: '#/shop' }, 'Open the Shop Partner app')] : null)];
  if (s.status === 'suspended') {
    mount(head, h('div', { class: 'card' }, h('h3', null, 'Account paused'), h('p', null, sellerStatusText.suspended), s.statusNote ? h('p', { class: 'low' }, s.statusNote) : null,
      h('a', { class: 'btn btn-outline', href: '#/help' }, 'Contact seller support')));
    return;
  }
  const c = me.counts;
  const badge = { orders: c.toAccept + c.toPack + c.toShip, returns: c.returns };
  const tabs = h('div', { class: 'tabs' }, HUB_TABS.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { location.hash = `#/seller?tab=${k}`; } },
    l, badge[k] ? h('span', { class: 'tab-count' }, badge[k]) : null)));
  const body = h('div');
  const test = state.config.testMode || {};
  mount(head, test.courier || test.payments ? h('p', { class: 'alert alert-test' }, 'Test mode: courier bookings, tracking numbers, bank checks and payouts are simulated. Nothing is sent or paid.') : null, tabs, body);
  await ({ overview: hubOverview, orders: hubOrders, listings: hubListings, add: hubAdd, returns: hubReturns, payouts: hubPayouts, account: hubAccount })[tab](body, me, qp);
}

function hubOverview(body, me) {
  const c = me.counts;
  const p = me.performance;
  const tile = (l, val, href, alert) => h(href ? 'a' : 'div', { class: 'stat' + (alert ? ' stat-alert' : ''), href }, h('span', { class: 'hint' }, l), h('b', null, val));
  const assuredNote = me.seller.fulfilment === 'self'
    ? 'The Assured badge needs Bazaario Pickup or Bazaario Fulfilled, a score of 85 or more and dispatch within 1 day.'
    : 'Offers get the Assured badge with a score of 85 or more and dispatch within 1 day. Assured offers rank higher.';
  fill(body, 
    h('div', { class: 'stats' },
      tile('Orders to accept', c.toAccept, '#/seller?tab=orders&view=accept', c.toAccept > 0),
      tile('To pack', c.toPack, '#/seller?tab=orders&view=pack'),
      tile('To hand to courier', c.toShip, '#/seller?tab=orders&view=ship'),
      tile('Late to ship', c.lateToShip, '#/seller?tab=orders&view=pack', c.lateToShip > 0),
      tile('Live listings', c.listings, '#/seller?tab=listings'),
      tile('In quality check', c.inQc, '#/seller?tab=listings'),
      tile('Open returns', c.returns, '#/seller?tab=returns'),
      tile('Next payout (estimate)', inr(me.upcoming), '#/seller?tab=payouts')),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' }, h('h3', null, 'Performance score'),
        h('p', { class: 'big-score' }, p.score === null ? 'New seller' : `${p.score} / 100`),
        h('p', { class: 'hint' }, p.score === null ? `Your score appears after 5 orders (you have ${p.decided}). It decides your place on product pages and the Assured badge.`
          : 'Based on your last 90 days. It decides your place on product pages and the Assured badge.'),
        h('table', { class: 'details' },
          h('tr', null, h('th', null, 'Orders decided'), h('td', null, p.decided)),
          h('tr', null, h('th', null, 'Rejected or cancelled'), h('td', { class: p.cancelRate > 0.05 ? 'err' : '' }, pctText(p.cancelRate))),
          h('tr', null, h('th', null, 'Shipped late'), h('td', { class: p.lateRate > 0.05 ? 'err' : '' }, pctText(p.lateRate))),
          h('tr', null, h('th', null, 'Returned for a product problem'), h('td', { class: p.returnRate > 0.05 ? 'err' : '' }, pctText(p.returnRate)))),
        h('p', { class: 'hint' }, assuredNote)),
      h('div', { class: 'card' }, h('h3', null, 'Your plan'),
        h('table', { class: 'details' },
          h('tr', null, h('th', null, 'Selling as'), h('td', null, me.seller.laneName)),
          h('tr', null, h('th', null, 'Shipping'), h('td', null, me.seller.fulfilmentName, h('div', { class: 'hint' }, me.seller.lane === 'shop' ? 'A Bazaario Express rider collects each order from your shop.' : me.plans.fulfilment[me.seller.fulfilment].text))),
          h('tr', null, h('th', null, 'Commission'), h('td', null, me.seller.lane === 'value' ? '0%' : me.seller.lane === 'shop' ? `${me.plans.shopCommission}% of the item price` : '5-15% of the item price, by category')),
          h('tr', null, h('th', null, 'Fee per order'), h('td', null, me.seller.lane === 'shop' ? 'None' : inr(me.plans.fulfilmentFee[me.seller.fulfilment]))),
          h('tr', null, h('th', null, 'Accept orders within'), h('td', null, me.seller.lane === 'shop' ? `${me.plans.shopAcceptMins} minutes` : `${me.plans.acceptHours} hours`))),
        h('p', null, h('a', { class: 'btn btn-outline', href: '#/seller?tab=add' }, 'Add a product')))));
}

const ORDER_VIEWS = [['accept', 'To accept'], ['pack', 'To pack'], ['ship', 'To hand over'], ['transit', 'On the way'], ['done', 'Completed'], ['all', 'All']];

async function hubOrders(body, me, qp) {
  const view = ORDER_VIEWS.some(([k]) => k === qp.get('view')) ? qp.get('view') : 'accept';
  const { orders, managed } = await api('GET', `/seller/orders?view=${view}`);
  const self = me.seller.fulfilment === 'self';
  const act = async (o, path, payload, msg) => {
    try { await api('POST', `/seller/orders/${o.id}/${path}`, payload); toast(msg); route(); } catch (ex) { fail(ex); }
  };
  const reject = async (o) => {
    const reason = await askText(`Reject order ${o.order_no}?`, { placeholder: 'For example: out of stock', yes: 'Reject order',
      hint: 'The order moves to another seller. Rejections lower your performance score.' });
    if (reason) act(o, 'reject', { reason }, 'Order rejected. It has moved to another seller.');
  };
  const cancel = async (o) => {
    const reason = await askText(`Cancel order ${o.order_no}?`, { placeholder: 'For example: item damaged in store', yes: 'Cancel order',
      hint: 'The order moves to another seller or is refunded. Cancellations lower your performance score.' });
    if (reason) act(o, 'cancel', { reason }, 'Order cancelled.');
  };
  const shipForm = (o) => {
    const courier = h('input', { placeholder: 'Courier, e.g. DTDC', maxLength: 40, required: true });
    const awb = h('input', { placeholder: 'Tracking number', maxLength: 30, required: true });
    return h('form', { class: 'ship-form', onsubmit: (e) => { e.preventDefault(); act(o, 'ship', { courier: courier.value, awb: awb.value }, 'Marked as shipped. The buyer has the tracking number.'); } },
      courier, awb, h('button', { class: 'btn btn-sm btn-outline' }, 'Mark shipped'));
  };
  const actions = (o) => {
    if (managed) return h('span', { class: 'hint' }, 'Bazaario packs and ships this order');
    const docs = ['packed', 'shipped', 'out_for_delivery', 'delivery_failed', 'delivered'].includes(o.status)
      ? h('div', { class: 'hint' }, h('a', { href: `#/doc/label/${o.id}?as=seller` }, 'Shipping label'), ' · ', h('a', { href: `#/doc/invoice/${o.id}?as=seller` }, 'Invoice')) : null;
    if (o.status === 'placed') {
      return h('div', { class: 'line-actions' }, h('button', { class: 'btn btn-sm btn-outline', onclick: () => act(o, 'accept', undefined, 'Order accepted. Please pack it.') }, 'Accept'),
        h('button', { class: 'link-btn danger', onclick: () => reject(o) }, 'Reject'));
    }
    if (o.status === 'confirmed') {
      return h('div', { class: 'line-actions' }, h('button', { class: 'btn btn-sm btn-outline', onclick: () => act(o, 'pack', undefined, self ? 'Marked as packed.' : 'Packed. The pickup is booked; print the label.') },
        self ? 'Mark packed' : 'Packed: book pickup'), h('button', { class: 'link-btn danger', onclick: () => cancel(o) }, 'Cancel'));
    }
    if (o.status === 'packed') {
      return h('div', null, self ? shipForm(o) : h('button', { class: 'btn btn-sm btn-outline', onclick: () => act(o, 'ship', undefined, 'Handed to the courier.') }, 'Handed to courier'),
        docs, h('button', { class: 'link-btn danger', onclick: () => cancel(o) }, 'Cancel'));
    }
    if (self && ['shipped', 'out_for_delivery', 'delivery_failed'].includes(o.status)) {
      const next = { shipped: ['out_for_delivery'], out_for_delivery: ['delivered', 'delivery_failed'], delivery_failed: ['out_for_delivery', 'rto'] }[o.status];
      return h('div', null, h('select', { 'aria-label': 'Delivery update', onchange: (e) => e.target.value && act(o, 'status', { status: e.target.value }, 'Delivery updated. The buyer has been told.') },
        h('option', { value: '' }, 'Courier update…'), next.map((t) => h('option', { value: t }, STATUS_LABEL[t]))), docs);
    }
    return docs || '—';
  };
  const deadline = (o) => {
    const now = Date.now();
    if (o.status === 'placed' && o.accept_by) return h('span', { class: o.accept_by - now < 4 * 3600000 ? 'err' : 'low' }, `Accept by ${fmtWhen(o.accept_by)}`);
    if (['confirmed', 'packed'].includes(o.status) && o.dispatch_by) return h('span', { class: o.dispatch_by < now ? 'err' : '' }, `${o.dispatch_by < now ? 'Late: was due' : 'Ship by'} ${fmtWhen(o.dispatch_by)}`);
    if (o.promised_at && !['delivered', 'cancelled', 'returned', 'rto'].includes(o.status)) return h('span', { class: 'hint' }, `Buyer expects it ${promiseText({ speed: o.delivery_speed, promisedAt: o.promised_at })}`);
    return o.delivered_at ? `Delivered ${fmtDate(o.delivered_at)}` : '';
  };
  fill(body, h('div', { class: 'chip-set view-chips' }, ORDER_VIEWS.map(([k, l]) => h('a', { class: 'fchip' + (k === view ? ' sel' : ''), href: `#/seller?tab=orders&view=${k}` }, l))),
    orders.length ? h('div', { class: 'table-wrap stack-sm' }, h('table', null,
      h('tr', null, ['Order', 'Items', 'Amount', 'Ship to', 'Status', 'Action'].map((t) => h('th', null, t))),
      orders.map((o) => h('tr', null,
        h('td', null, h('b', null, o.order_no), h('div', { class: 'hint' }, fmtWhen(o.created_at)), o.delivery_speed === 'express' ? h('span', { class: 'speed-tag' }, 'Express') : null),
        h('td', null, o.items.map((it) => h('div', null, `${it.title}`, h('span', { class: 'muted' }, ` × ${it.qty}`)))),
        h('td', null, inr(o.subtotal), h('div', { class: 'hint' }, o.payment_method === 'cod' ? 'Cash on Delivery' : 'Prepaid')),
        h('td', null, o.address.fullName ? [h('div', null, o.address.fullName), h('div', { class: 'hint' }, `${o.address.line1}, ${o.address.city}, ${o.address.state} ${o.address.pincode}`)]
          : h('div', null, `${o.address.city}, ${o.address.state} ${o.address.pincode}`), o.awb ? h('div', { class: 'hint' }, `${o.courier} · ${o.awb}`) : null),
        h('td', null, STATUS_LABEL[o.status], h('div', { class: 'hint' }, deadline(o))),
        h('td', null, actions(o)))))) : h('div', { class: 'card empty' }, h('p', null, view === 'accept' ? 'No new orders right now.' : 'No orders here.')));
}

async function hubListings(body, me) {
  const { listings } = await api('GET', '/seller/listings');
  const bbCats = me.plans.bestBeforeCategories;
  const save = async (l, f) => {
    const payload = { price: Number(f.price.value), stock: Number(f.stock.value), dispatchDays: Number(f.days.value), active: f.active.checked };
    if (f.bb) payload.bestBefore = f.bb.value;
    try { await api('PATCH', `/seller/offers/${l.id}`, payload); toast('Offer saved.'); route(); } catch (ex) { fail(ex); }
  };
  const status = (l) => {
    if (l.qc_status === 'pending') return h('span', { class: 'low' }, 'In quality check');
    if (l.qc_status === 'rejected') return [h('span', { class: 'err' }, 'Needs changes'), h('div', { class: 'hint' }, l.qc_note),
      h('a', { class: 'hint', href: `#/seller?tab=add&edit=${l.product_id}` }, 'Edit and resubmit')];
    if (!l.active) return h('span', { class: 'muted' }, 'Paused');
    if (l.stock === 0) return h('span', { class: 'err' }, 'Out of stock');
    if (l.bestOffer) return [h('span', { class: 'ok' }, 'Best offer'), l.assured ? h('span', { class: 'assured-tag' }, 'Assured') : null];
    return [h('span', null, 'Other sellers rank higher'), l.lowestOther ? h('div', { class: 'hint' }, `Lowest other price ${inr(l.lowestOther)}`) : null];
  };
  const csv = h('textarea', { rows: 5, placeholder: 'product_id,price,stock,dispatch_days,best_before\n16,1199,20,2\n33,265,40,2,2027-03' });
  const results = h('div');
  fill(body, 
    listings.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['', 'Product', 'Your price (₹)', 'Stock', 'Dispatch', 'Status', ''].map((t) => h('th', null, t))),
      listings.map((l) => {
        const f = {
          price: h('input', { type: 'number', min: 1, max: l.mrp / 100, value: l.price / 100, class: 'cell-input', 'aria-label': 'Price' }),
          stock: h('input', { type: 'number', min: 0, value: l.stock, class: 'cell-input', 'aria-label': 'Stock' }),
          days: h('select', { 'aria-label': 'Dispatch time' }, [1, 2, 3, 4, 5, 6, 7].map((d) => h('option', { value: d, selected: d === l.dispatch_days }, d === 1 ? '1 day' : `${d} days`))),
          active: h('input', { type: 'checkbox', checked: !!l.active }),
          bb: bbCats.includes(l.category) ? h('input', { type: 'month', value: l.best_before || '', 'aria-label': 'Best before' }) : null,
        };
        return h('tr', null, h('td', null, pic(l, 'pimg thumb')),
          h('td', null, l.qc_status === 'approved' ? h('a', { href: `#/p/${l.product_id}` }, l.title) : h('b', null, l.title),
            h('div', { class: 'hint' }, `${l.category_name} · MRP ${inr(l.mrp)} · ID ${l.product_id}`)),
          h('td', null, f.price), h('td', null, f.stock), h('td', null, f.days, f.bb ? h('div', null, h('span', { class: 'hint' }, 'Best before'), f.bb) : null),
          h('td', null, status(l)),
          h('td', null, h('label', { class: 'inline' }, f.active, 'On sale'), h('button', { class: 'btn btn-sm btn-outline', onclick: () => save(l, f) }, 'Save')));
      }))) : h('div', { class: 'card empty' }, h('h2', null, 'No listings yet'), h('p', null, 'Add your price to a product already on Bazaario, or create a new product page.'),
      h('a', { class: 'btn btn-outline', href: '#/seller?tab=add' }, 'Add a product')),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Update many offers at once'),
      h('p', { class: 'hint' }, 'Paste a sheet with one product per row: product ID, price in rupees, stock, dispatch days and, for food and beauty, best-before month. New product IDs are added as new offers.'),
      csv, h('div', { class: 'line-actions', style: { marginTop: '8px' } },
        h('button', { class: 'btn btn-outline', onclick: async () => {
          try {
            const r = await api('POST', '/seller/offers/bulk', { csv: csv.value });
            const bad = r.results.filter((x) => !x.ok);
            fill(results, h('p', { class: bad.length ? 'low' : 'ok' }, `${r.results.length - bad.length} of ${r.results.length} rows saved.`),
              bad.map((x) => h('div', { class: 'err small' }, `Row ${x.row}${x.productId ? ` (product ${x.productId})` : ''}: ${x.error}`)));
            if (!bad.length) setTimeout(route, 1200);
          } catch (ex) { fail(ex); }
        } }, 'Upload sheet'),
        h('button', { class: 'link-btn', onclick: () => downloadCsv('bazaario-listings.csv', [['product_id', 'price', 'stock', 'dispatch_days', 'best_before', 'title'],
          ...listings.map((l) => [l.product_id, l.price / 100, l.stock, l.dispatch_days, l.best_before || '', l.title])]) }, 'Download my listings as a sheet')),
      results));
}

async function hubAdd(body, me, qp) {
  const editId = Number(qp.get('edit')) || null;
  const offerBox = h('div');
  const results = h('div');
  const q = h('input', { type: 'search', placeholder: 'Search by product name or brand', maxLength: 80 });
  const offerForm = (p) => {
    const price = h('input', { type: 'number', min: 1, max: p.mrp / 100, required: true, placeholder: `Up to ${p.mrp / 100}` });
    const stock = h('input', { type: 'number', min: 0, required: true, value: 10 });
    const days = h('select', null, [1, 2, 3, 4, 5].map((d) => h('option', { value: d, selected: d === 2 }, d === 1 ? 'Ships in 1 day' : `Ships in ${d} days`)));
    const bb = me.plans.bestBeforeCategories.includes(p.category) ? h('input', { type: 'month', required: true }) : null;
    fill(offerBox, h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/seller/offers', { productId: p.id, price: Number(price.value), stock: Number(stock.value), dispatchDays: Number(days.value), bestBefore: bb ? bb.value : undefined });
        toast('Your offer is live.'); location.hash = '#/seller?tab=listings';
      } catch (ex) { fail(ex); }
    } }, h('h3', null, `Sell: ${p.title}`), h('p', { class: 'hint' }, `MRP ${inr(p.mrp)} · current best price ${inr(p.price)} · ${p.offer_count} seller(s)`),
    h('div', { class: 'form-grid' }, field('Your price (₹)', price), field('Stock', stock), field('Dispatch time', days), bb ? field('Best before', bb) : null),
    h('p', null, h('button', { class: 'btn btn-primary' }, 'Start selling'))));
    offerBox.scrollIntoView({ block: 'center' });
  };
  const search = async () => {
    try {
      const { products } = await api('GET', `/seller/catalog?q=${encodeURIComponent(q.value.trim())}`);
      fill(results, products.length ? products.map((p) => h('div', { class: 'order-item' }, pic(p, 'pimg'),
        h('div', null, h('b', null, p.title), h('div', { class: 'hint' }, `${p.brand} · ${p.category_name} · best price ${inr(p.price)}`),
          p.my_offer ? h('span', { class: 'ok small' }, 'You already sell this') : p.allowed
            ? h('button', { class: 'btn btn-sm btn-outline', onclick: () => offerForm(p) }, 'Sell this')
            : h('span', { class: 'hint' }, 'Only brands and Bazaario sell in this category')))) : h('p', { class: 'muted' }, 'No match. Create a new product page below.'));
    } catch (ex) { fail(ex); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });

  let existing = null;
  if (editId) existing = (await api('GET', '/seller/listings')).listings.find((l) => l.product_id === editId) || null;
  fill(body, 
    existing ? null : h('div', { class: 'card' }, h('h3', null, '1. Is it already on Bazaario?'),
      h('p', { class: 'hint' }, 'Each product has one page. If it is already listed, add your price to it; buyers see the best offer first and other sellers next to it.'),
      h('div', { class: 'search-row' }, q, h('button', { class: 'btn btn-outline', onclick: search }, 'Search')), results),
    offerBox,
    newProductForm(me, existing));
}

function newProductForm(me, existing) {
  const cats = state.categories;
  const cat = h('select', { required: true }, cats.map((c) => h('option', { value: c.id, selected: existing ? existing.category_id === c.id : c.slug === 'home-kitchen' }, c.name)));
  const slugOf = () => (cats.find((c) => String(c.id) === cat.value) || {}).slug;
  const f = {};
  const inp = (k, attrs) => (f[k] = h(attrs.tag || 'input', { ...attrs, tag: undefined }));
  const ex = existing || {};
  inp('title', { required: true, maxLength: 150, value: ex.title || '', placeholder: 'Brand, product, key detail, size or pack' });
  inp('brand', { required: true, maxLength: 60, value: ex.brand || '' });
  inp('mrp', { type: 'number', min: 1, required: true, value: ex.mrp ? ex.mrp / 100 : '' });
  inp('price', { type: 'number', min: 1, required: true, value: ex.price ? ex.price / 100 : '' });
  inp('stock', { type: 'number', min: 0, required: true, value: ex.stock ?? 10 });
  inp('days', { tag: 'select' });
  [1, 2, 3, 4, 5].forEach((d) => f.days.append(h('option', { value: d, selected: d === (ex.dispatch_days || 2) }, d === 1 ? 'Ships in 1 day' : `Ships in ${d} days`)));
  inp('description', { tag: 'textarea', rows: 3, maxLength: 4000, value: ex.description || '', placeholder: 'What it is, what it is made of, who it is for' });
  inp('features', { tag: 'textarea', rows: 3, maxLength: 3000, value: (ex.features || []).join('\n'), placeholder: 'One highlight per line' });
  inp('hsn', { maxLength: 8, inputMode: 'numeric', value: ex.hsn || '' });
  inp('gst', { tag: 'select' });
  me.plans.gstRates.forEach((r) => f.gst.append(h('option', { value: r, selected: r === (ex.gst_rate ?? 18) }, `${r}%`)));
  inp('origin', { maxLength: 60, value: ex.origin || 'India' });
  inp('manufacturer', { maxLength: 200, value: ex.manufacturer || '', placeholder: 'Name and address of the maker or importer' });
  const bb = h('input', { type: 'month', value: ex.best_before || '' });
  const bbWrap = field('Best before', bb);
  const specBox = h('div', { class: 'form-grid' });
  const specInputs = {};
  const paintSpecs = () => {
    const keys = me.plans.specs[slugOf()] || [];
    for (const k of Object.keys(specInputs)) if (!keys.includes(k)) delete specInputs[k];
    fill(specBox, keys.map((k) => {
      specInputs[k] = specInputs[k] || h('input', { maxLength: 120, required: true, value: (ex.specs || {})[k] || '' });
      return field(k, specInputs[k]);
    }));
    bbWrap.classList.toggle('hidden', !me.plans.bestBeforeCategories.includes(slugOf()));
    if (me.plans.authenticCategories.includes(slugOf()) && !['brand', 'direct'].includes(me.seller.lane)) {
      specBox.prepend(h('p', { class: 'alert alert-err full' }, 'Only brands and Bazaario sell in this category, so buyers always get genuine products. Please choose another category.'));
    }
  };
  cat.addEventListener('change', paintSpecs);
  paintSpecs();
  const photo = photoField(f, ex.image ? ex : null, '/seller/uploads');

  const problems = h('div', { class: 'alert alert-err hidden' });
  const notDup = h('input', { type: 'checkbox' });
  const dupBox = h('div', { class: 'card hidden dup-box' });
  const submit = async (e) => {
    e.preventDefault();
    problems.classList.add('hidden');
    const specs = Object.fromEntries(Object.entries(specInputs).map(([k, el]) => [k, el.value]));
    const payload = { title: f.title.value, brand: f.brand.value, categoryId: Number(cat.value), mrp: Number(f.mrp.value), price: Number(f.price.value),
      stock: Number(f.stock.value), dispatchDays: Number(f.days.value), description: f.description.value, features: f.features.value, image: f.image.value,
      hsn: f.hsn.value || undefined, gstRate: Number(f.gst.value), origin: f.origin.value, manufacturer: f.manufacturer.value, specs,
      bestBefore: bbWrap.classList.contains('hidden') ? undefined : bb.value, notDuplicate: notDup.checked };
    try {
      const r = existing ? await api('PUT', `/seller/products/${existing.product_id}`, payload) : await api('POST', '/seller/products', payload);
      toast(existing || r.qcStatus === 'pending' ? 'Sent for quality check. It usually takes a few hours.' : 'Your product is live.');
      location.hash = '#/seller?tab=listings';
    } catch (ex2) {
      const d = ex2.details || {};
      if (d.matches) {
        fill(dupBox, h('h3', null, 'This product may already be on Bazaario'),
          h('p', { class: 'hint' }, 'Add your price to the existing page instead, so buyers see one page with every seller.'),
          d.matches.map((m) => h('div', { class: 'order-item' }, pic(m, 'pimg'), h('div', null, h('a', { href: `#/p/${m.id}`, target: '_blank' }, m.title), h('div', { class: 'hint' }, `Product ID ${m.id}`)))),
          h('label', { class: 'inline' }, notDup, 'My product is different (for example another size or model). Send it for quality check.'));
        dupBox.classList.remove('hidden');
        dupBox.scrollIntoView({ block: 'center' });
      } else {
        fill(problems, h('b', null, 'Please fix these before sending:'), h('ul', null, (d.problems || [ex2.message]).map((p) => h('li', null, p))));
        problems.classList.remove('hidden');
        problems.scrollIntoView({ block: 'center' });
      }
    }
  };
  return h('form', { class: 'card', style: { marginTop: '16px' }, onsubmit: submit },
    h('h3', null, existing ? `Edit and resubmit: ${existing.title}` : '2. Or create a new product page'),
    existing && existing.qc_note ? h('p', { class: 'alert alert-err' }, `Quality check note: ${existing.qc_note}`) : null,
    h('p', { class: 'hint' }, 'Every listing needs a clear photo, the MRP, HSN code, country of origin and the manufacturer, as Indian law requires. No phone numbers, links or claims like "best price".'),
    problems,
    h('div', { class: 'form-grid' }, field('Title', f.title, { full: true }), field('Brand', f.brand), field('Category', cat),
      field('MRP (₹)', f.mrp), field('Your price (₹)', f.price), field('Stock', f.stock), field('Dispatch time', f.days), bbWrap),
    h('div', { class: 'form-grid' }, photo),
    h('h4', null, 'Details buyers look for'), specBox,
    h('div', { class: 'form-grid' }, field('Description', f.description, { full: true }), field('Highlights', f.features, { full: true })),
    h('h4', null, 'Tax and legal details'),
    h('div', { class: 'form-grid' }, field('HSN code', f.hsn, { hint: 'Leave empty to use the usual code for the category.' }), field('GST rate', f.gst),
      field('Country of origin', f.origin), field('Manufacturer or importer', f.manufacturer)),
    dupBox,
    h('p', null, h('button', { class: 'btn btn-primary' }, existing ? 'Resubmit for quality check' : 'Send for quality check')));
}

async function hubReturns(body) {
  const { returns, claimReasons } = await api('GET', '/seller/returns');
  const RS = { requested: 'Requested', pickup_scheduled: 'Pickup scheduled', refunded: 'Back with you, refunded', rejected: 'Not accepted' };
  const claim = (r) => {
    const modal = $('#modal');
    const reason = h('select', { required: true }, h('option', { value: '' }, 'What was wrong?'), claimReasons.map((c) => h('option', { value: c }, c)));
    const note = h('textarea', { rows: 3, maxLength: 1000, required: true, minLength: 10, placeholder: 'Describe what you received back' });
    $('#modal-body').replaceChildren(h('h3', null, `Claim for ${r.order_no}`),
      h('p', { class: 'muted small' }, 'If a return came back used, damaged or wrong, we review it and add the approved amount to your next payout.'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/seller/claims', { orderId: r.order_id, reason: reason.value, note: note.value }); modal.close(); toast('Claim filed.'); route(); } catch (ex) { fail(ex); }
      } }, h('label', null, 'Reason'), reason, h('label', null, 'Details'), note,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-outline' }, 'File claim'), h('button', { type: 'button', class: 'btn', onclick: () => modal.close() }, 'Go back'))));
    modal.showModal();
  };
  const CS = { open: 'Claim under review', approved: 'Claim approved', rejected: 'Claim not approved' };
  fill(body, returns.length ? h('div', { class: 'table-wrap' }, h('table', null,
    h('tr', null, ['Order', 'Buyer\'s reason', 'Return', 'Claim'].map((t) => h('th', null, t))),
    returns.map((r) => h('tr', null, h('td', null, h('b', null, r.order_no), h('div', { class: 'hint' }, inr(r.subtotal))),
      h('td', null, r.reason, r.comment ? h('div', { class: 'hint' }, r.comment) : null),
      h('td', null, RS[r.status], r.note ? h('div', { class: 'hint' }, r.note) : null),
      h('td', null, r.claim_status ? [h('span', { class: r.claim_status === 'approved' ? 'ok' : r.claim_status === 'rejected' ? 'err' : '' }, CS[r.claim_status]),
        r.claim_amount ? h('div', { class: 'hint' }, inr(r.claim_amount)) : null, r.decision_note ? h('div', { class: 'hint' }, r.decision_note) : null]
        : r.order_status === 'returned' ? h('button', { class: 'btn btn-sm btn-outline', onclick: () => claim(r) }, 'File a claim') : '—')))))
    : h('div', { class: 'card empty' }, h('p', null, 'No returns on your orders.')));
}

async function hubPayouts(body, me) {
  const { upcoming, payouts, returnWindowDays } = await api('GET', '/seller/payouts');
  const pl = me.plans;
  const deductions = (l) => l.commission + l.fees + (l.gstOnFees ?? l.gst_on_fees);
  const taxes = (l) => l.tcs + l.tds;
  fill(body, 
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Next payout (estimate)'), h('b', null, inr(upcoming.net))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Paid so far'), h('b', null, inr(payouts.reduce((s, p) => s + p.net, 0))))),
    h('p', { class: 'hint' }, `Money for an order is released ${returnWindowDays} days after delivery, when the return window closes. From the item price we deduct commission, the fee per order, ${pl.gstOnFeesPct}% GST on those two, GST TCS of ${pl.tcsPct}% and income-tax TDS of ${pl.tdsPct}%. TCS and TDS are deposited against your GSTIN and PAN, and you can claim them back.`),
    h('div', { class: 'card' }, h('h3', null, 'Coming up'),
      upcoming.lines.length || upcoming.claims.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Order', 'Delivered', 'Released on', 'Item price', 'Commission and fees', 'TCS and TDS', 'You get'].map((t) => h('th', null, t))),
        upcoming.lines.map((l) => h('tr', null, h('td', null, l.orderNo), h('td', null, fmtDate(l.deliveredAt)),
          h('td', null, l.onHold ? h('span', { class: 'low' }, 'On hold: return requested') : l.ready ? h('span', { class: 'ok' }, 'In the next payout') : fmtDate(l.releaseAt)),
          h('td', null, inr(l.gross)), h('td', null, '-' + inr(deductions(l))), h('td', null, '-' + inr(taxes(l))), h('td', null, h('b', null, inr(l.net))))),
        upcoming.claims.map((c) => h('tr', null, h('td', null, c.order_no), h('td', { colSpan: 5 }, `Approved claim: ${c.reason}`), h('td', null, h('b', null, inr(c.amount)))))))
        : h('p', { class: 'muted' }, 'Nothing yet. Delivered orders appear here.')),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Payouts'),
      payouts.length ? payouts.map((p) => h('details', { class: 'payout' },
        h('summary', null, h('b', null, inr(p.net)), h('span', null, `${fmtDate(p.created_at)} · ${p.payout_no}`), h('span', { class: 'hint' }, `UTR ${p.utr || 'pending'}`)),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('tr', null, ['Order', 'Item price', 'Commission', 'Fee', 'GST on fees', 'TCS', 'TDS', 'Claim', 'Net'].map((t) => h('th', null, t))),
          p.lines.map((l) => h('tr', null, h('td', null, l.order_no || '—'), h('td', null, inr(l.gross)), h('td', null, inr(l.commission)), h('td', null, inr(l.fees)),
            h('td', null, inr(l.gst_on_fees)), h('td', null, inr(l.tcs)), h('td', null, inr(l.tds)), h('td', null, l.adjustment ? inr(l.adjustment) : '—'), h('td', null, h('b', null, inr(l.net))))))),
        h('button', { class: 'link-btn', onclick: () => downloadCsv(`${p.payout_no}.csv`, [['order', 'item_price', 'commission', 'fee', 'gst_on_fees', 'tcs', 'tds', 'claim', 'net'],
          ...p.lines.map((l) => [l.order_no || '', l.gross / 100, l.commission / 100, l.fees / 100, l.gst_on_fees / 100, l.tcs / 100, l.tds / 100, l.adjustment / 100, l.net / 100])]) }, 'Download statement')))
        : h('p', { class: 'muted' }, 'No payouts yet.')));
}

function hubAccount(body, me) {
  const s = me.seller;
  const row = (k, val) => (val ? h('tr', null, h('th', null, k), h('td', null, val)) : null);
  fill(body, h('div', { class: 'card' }, h('h3', null, 'Business details'),
    h('table', { class: 'details' },
      row('Seller ID', s.code), row('Shop name', s.displayName), row('Legal name', s.legalName), row('Selling as', s.laneName),
      row('GSTIN', s.gstin), row('GST enrolment ID', s.enrolmentId), row('PAN', s.pan), row('Brand', s.brandName), row('Trademark number', s.trademarkNo),
      row('Bank account', s.bank ? `•••• ${s.bank.last4} · ${s.bank.ifsc} · ${s.bank.nameAtBank}` : null),
      row('Pickup address', [s.pickup.line1, s.pickup.city, s.pickup.state, s.pickup.pincode].filter(Boolean).join(', ')),
      row('Mobile', s.phone), row('Email', s.email), row('Shipping', s.fulfilmentName), row('Approved on', s.approvedAt ? fmtDate(s.approvedAt) : null)),
    h('p', { class: 'hint' }, 'To change your bank, GST or address details, contact seller support. We check every change before payouts go to a new account.'),
    h('a', { class: 'btn btn-outline', href: '#/help' }, 'Contact seller support')));
}

// ---------------- Studio: sellers, catalog check, claims, settlement ----------------
async function studioMarket(tab, body, qp) {
  if (tab === 'sellers') {
    const status = qp.get('status') || '';
    const lane = qp.get('lane') || '';
    const { sellers } = await api('GET', `/admin/sellers?status=${status}&lane=${lane}`);
    const act = async (s, action) => {
      let note;
      if (['reject', 'suspend'].includes(action)) {
        note = await askText(`${action === 'reject' ? 'Reject' : 'Suspend'} ${s.display_name}?`, { yes: action === 'reject' ? 'Reject' : 'Suspend', hint: 'The seller sees this reason.' });
        if (!note) return;
      }
      try { await api('PATCH', `/admin/sellers/${s.id}`, { action, note }); toast('Seller updated. They have been emailed.'); route(); } catch (ex) { fail(ex); }
    };
    const go = (st2, ln) => { location.hash = '#/admin?tab=sellers' + (st2 ? `&status=${st2}` : '') + (ln ? `&lane=${ln}` : ''); };
    const filter = h('select', { style: { width: 'auto' }, onchange: (e) => go(e.target.value, lane) },
      [['', 'All sellers'], ['pending', 'Waiting for approval'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Rejected']]
        .map(([v2, l]) => h('option', { value: v2, selected: v2 === status }, l)));
    const laneFilter = h('select', { style: { width: 'auto' }, 'aria-label': 'Type', onchange: (e) => go(status, e.target.value) },
      [['', 'Every type'], ['brand', 'Brand stores'], ['standard', 'Standard sellers'], ['value', 'Value sellers'], ['shop', 'Partner shops']]
        .map(([v2, l]) => h('option', { value: v2, selected: v2 === lane }, l)));
    const nameMatch = (s) => !s.bank_name_at_bank || s.bank_name_at_bank.replace(/\W/g, '') === s.legal_name.toUpperCase().replace(/\W/g, '');
    fill(body, h('p', null, h('label', { class: 'inline' }, 'Show: ', filter, ' ', laneFilter)),
      sellers.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Seller', 'KYC', 'Bank (₹1 check)', 'Ships from', 'Performance', 'Status', ''].map((t) => h('th', null, t))),
        sellers.map((s) => h('tr', null,
          h('td', null, h('b', null, s.display_name), h('div', { class: 'hint' }, `${s.code} · ${LANE_LABEL[s.lane]} · ${s.legal_name}`), h('div', { class: 'hint' }, s.account_email || s.email || '')),
          h('td', null, s.gstin ? h('div', null, `GSTIN ${s.gstin}`) : null, s.enrolment_id ? h('div', null, `Enrolment ${s.enrolment_id}`) : null,
            h('div', { class: 'hint' }, `PAN ${s.pan}`), s.trademark_no ? h('div', { class: 'hint' }, `${s.brand_name} · TM ${s.trademark_no}`) : null),
          h('td', null, s.bank_last4 ? `•••• ${s.bank_last4}` : '—', h('div', { class: 'hint' }, s.bank_ifsc || ''),
            s.bank_name_at_bank ? h('div', { class: nameMatch(s) ? 'hint ok' : 'hint err' }, `Bank name: ${s.bank_name_at_bank}${nameMatch(s) ? '' : ' (does not match)'}`) : null),
          h('td', null, `${s.pickup_city || ''}, ${s.pickup_state}`, h('div', { class: 'hint' }, s.lane === 'shop'
            ? `Express riders · ${s.radius_km} km · ${s.open_hour}:00 to ${s.close_hour}:00` : { fulfilled: 'Bazaario Fulfilled', pickup: 'Bazaario Pickup', self: 'Self Ship' }[s.fulfilment])),
          h('td', null, s.performance.score === null ? 'New' : `${s.performance.score}/100`, h('div', { class: 'hint' }, `${s.offers} offers · ${s.orders} orders`)),
          h('td', null, cap(s.status), s.status_note ? h('div', { class: 'hint' }, s.status_note) : null),
          h('td', null, h('div', { class: 'line-actions' },
            s.status === 'pending' ? [h('button', { class: 'btn btn-sm btn-outline', onclick: () => act(s, 'approve') }, 'Approve'), h('button', { class: 'link-btn danger', onclick: () => act(s, 'reject') }, 'Reject')] : null,
            s.status === 'approved' ? h('button', { class: 'link-btn danger', onclick: () => act(s, 'suspend') }, 'Suspend') : null,
            s.status === 'suspended' ? h('button', { class: 'btn btn-sm btn-outline', onclick: () => act(s, 'reinstate') }, 'Reinstate') : null)))))) : h('div', { class: 'card empty' }, h('p', null, 'No sellers here.')));
  }

  if (tab === 'qc') {
    const { products } = await api('GET', '/admin/qc');
    const act = async (p, action) => {
      let note;
      if (action === 'reject') { note = await askText(`Ask for changes to "${p.title}"?`, { yes: 'Send back', label: 'What should the seller change?', hint: 'The seller sees this note.' }); if (!note) return; }
      try { await api('PATCH', `/admin/qc/${p.id}`, { action, note }); toast(action === 'approve' ? 'Listing approved and live.' : 'Sent back to the seller.'); route(); } catch (ex) { fail(ex); }
    };
    fill(body, h('p', { class: 'muted' }, 'New product pages from sellers. Automatic checks ran when they were submitted; check the photo, title and details match, and that it is not a copy of an existing page.'),
      products.length ? products.map((p) => h('div', { class: 'card qc-card' },
        h('div', { class: 'qc-grid' }, pic(p, 'pdp-img qc-img'),
          h('div', null, h('h3', null, p.title), h('p', { class: 'hint' }, `${p.brand} · ${p.category_name} · by ${p.seller} (${LANE_LABEL[p.seller_lane]}) · submitted ${fmtWhen(p.created_at)}`),
            h('p', null, `MRP ${inr(p.mrp)} · price ${inr(p.offer_price)} · stock ${p.offer_stock} · ships in ${p.dispatch_days} day(s)`, p.best_before ? ` · best before ${monthText(p.best_before)}` : ''),
            h('p', { class: 'small' }, p.description), p.features.length ? h('ul', { class: 'features' }, p.features.map((x) => h('li', null, x))) : null,
            h('table', { class: 'details' }, [['HSN', p.hsn], ['GST', `${p.gst_rate}%`], ['Origin', p.origin], ['Manufacturer', p.manufacturer], ...Object.entries(p.specs)]
              .map(([k, val]) => h('tr', null, h('th', null, k), h('td', null, val)))),
            p.qc_note ? h('p', { class: 'low small' }, p.qc_note) : null,
            p.problems.length ? h('div', { class: 'alert alert-err' }, p.problems.map((x) => h('div', null, x))) : h('p', { class: 'ok small' }, 'Automatic checks passed.'),
            p.matches.length ? h('p', { class: 'small' }, 'Looks like: ', p.matches.map((m, i) => [i ? ', ' : '', h('a', { href: `#/p/${m.id}`, target: '_blank' }, m.title)])) : null,
            h('div', { class: 'line-actions' }, h('button', { class: 'btn btn-sm btn-outline', onclick: () => act(p, 'approve') }, 'Approve'),
              h('button', { class: 'link-btn danger', onclick: () => act(p, 'reject') }, 'Ask for changes')))))) : h('div', { class: 'card empty' }, h('p', null, 'Nothing to check.')));
  }

  if (tab === 'claims') {
    const { claims } = await api('GET', '/admin/claims');
    const decide = async (c, action) => {
      let payload = { action };
      if (action === 'approve') {
        const amount = await askText(`Approve claim for ${c.order_no}?`, { label: 'Amount to credit (₹)', placeholder: `Up to ${c.subtotal / 100}`, yes: 'Approve', min: 1 });
        if (!amount) return;
        payload = { action, amount: Number(amount) };
      } else {
        const note = await askText(`Reject claim for ${c.order_no}?`, { yes: 'Reject', hint: 'The seller sees this reason.' });
        if (!note) return;
        payload = { action, note };
      }
      try { await api('PATCH', `/admin/claims/${c.id}`, payload); toast('Claim updated.'); route(); } catch (ex) { fail(ex); }
    };
    const CS = { open: 'Open', approved: 'Approved', rejected: 'Rejected' };
    fill(body, claims.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Order', 'Seller', 'Buyer said', 'Seller says', 'Status', ''].map((t) => h('th', null, t))),
      claims.map((c) => h('tr', null, h('td', null, c.order_no, h('div', { class: 'hint' }, inr(c.subtotal))), h('td', null, c.seller),
        h('td', null, c.return_reason || '—', c.return_comment ? h('div', { class: 'hint' }, c.return_comment) : null),
        h('td', null, c.reason, h('div', { class: 'hint' }, c.note)),
        h('td', null, CS[c.status], c.amount ? h('div', { class: 'hint' }, inr(c.amount)) : null, c.decision_note ? h('div', { class: 'hint' }, c.decision_note) : null),
        h('td', null, c.status === 'open' ? h('div', { class: 'line-actions' }, h('button', { class: 'btn btn-sm btn-outline', onclick: () => decide(c, 'approve') }, 'Approve'),
          h('button', { class: 'link-btn danger', onclick: () => decide(c, 'reject') }, 'Reject')) : '—')))))
      : h('div', { class: 'card empty' }, h('p', null, 'No claims.')));
  }

  if (tab === 'settlement') {
    const st = await api('GET', '/admin/settlement');
    const run = async () => {
      if (!(await askConfirm('Pay every seller whose return window has closed?', 'Run settlement'))) return;
      try {
        const r = await api('POST', '/admin/settlement/run');
        const n = r.payouts.length + (r.resellerPayouts || []).length;
        toast(n ? `${n} payout(s) sent.` : 'Nothing was due.'); route();
      } catch (ex) { fail(ex); }
    };
    const due = st.due.reduce((s, r) => s + r.net, 0) + st.resellerDue.reduce((s, r) => s + r.gross, 0);
    fill(body, 
      h('p', { class: 'muted' }, `Sellers are paid ${st.returnWindowDays} days after delivery. Each payout deducts commission, the fee per order, ${st.rates.gstOnFeesPct}% GST on those, GST TCS ${st.rates.tcsPct}% and TDS ${st.rates.tdsPct}%. Have your CA confirm these rates and file TCS (GSTR-8) and TDS returns every month.`),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Due now'), h('b', null, inr(due))),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Sellers due'), h('b', null, st.due.length)),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Resellers due'), h('b', null, st.resellerDue.length))),
      h('p', null, h('button', { class: 'btn btn-primary', onclick: run }, 'Run settlement now')),
      st.due.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Seller', 'Orders', 'Item value', 'Seller gets', 'Status'].map((t) => h('th', null, t))),
        st.due.map((r) => h('tr', null, h('td', null, r.seller), h('td', null, r.orders), h('td', null, inr(r.gross)), h('td', null, inr(r.net)),
          h('td', null, r.status === 'approved' ? 'Ready' : h('span', { class: 'low' }, 'Held: seller suspended')))))) : null,
      st.resellerDue.length ? [h('h3', { style: { marginTop: '16px' } }, 'Reseller earnings due'), h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Reseller', 'UPI', 'Items', 'Margin earned'].map((t) => h('th', null, t))),
        st.resellerDue.map((r) => h('tr', null, h('td', null, r.display_name), h('td', null, r.upi_id), h('td', null, r.items), h('td', null, inr(r.gross))))))] : null,
      h('h3', { style: { marginTop: '16px' } }, 'Payouts'),
      st.payouts.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Date', 'Payout', 'Seller', 'Item value', 'Commission and fees', 'TCS', 'TDS', 'Claims', 'Paid', 'UTR'].map((t) => h('th', null, t))),
        st.payouts.map((p) => h('tr', null, h('td', null, fmtDate(p.created_at)), h('td', null, p.payout_no), h('td', null, p.seller), h('td', null, inr(p.gross)),
          h('td', null, inr(p.commission + p.fees + p.gst_on_fees)), h('td', null, inr(p.tcs)), h('td', null, inr(p.tds)), h('td', null, p.adjustments ? inr(p.adjustments) : '—'),
          h('td', null, h('b', null, inr(p.net))), h('td', { class: 'hint' }, p.utr || '—'))))) : h('p', { class: 'muted' }, 'No payouts yet.'),
      st.resellerPayouts.length ? [h('h3', { style: { marginTop: '16px' } }, 'Reseller payouts'), h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Date', 'Payout', 'Reseller', 'Earned', 'TDS (194H)', 'Paid', 'UTR'].map((t) => h('th', null, t))),
        st.resellerPayouts.map((p) => h('tr', null, h('td', null, fmtDate(p.created_at)), h('td', null, p.payout_no), h('td', null, p.reseller), h('td', null, inr(p.gross)),
          h('td', null, p.tds ? inr(p.tds) : '—'), h('td', null, h('b', null, inr(p.net))), h('td', { class: 'hint' }, p.utr || '—')))))] : null,
      h('h3', { style: { marginTop: '16px' } }, 'Daily money check (last 14 days)'),
      st.reconciliation.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Day', 'Paid online', 'Cash collected', 'Refunded', 'Paid to sellers', 'Bazaario earned', 'TCS to deposit', 'TDS to deposit'].map((t) => h('th', null, t))),
        st.reconciliation.map((r) => h('tr', null, h('td', null, fmtDate(new Date(`${r.day}T12:00:00+05:30`).getTime())), ...['online', 'cod', 'refunds', 'payouts', 'earned', 'tcs', 'tds'].map((k) => h('td', null, r[k] ? inr(r[k]) : '—'))))))
        : h('p', { class: 'muted' }, 'No money moved in the last 14 days.'));
  }
}

// ---------------- Printable invoice and shipping label ----------------
// Code 128 (set B) bar widths, the barcode couriers scan on labels.
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');

function barcode(text) {
  const codes = [104, ...[...text].map((ch) => ch.charCodeAt(0) - 32)];
  codes.push(codes.reduce((s, c, i) => s + c * (i || 1), 0) % 103, 106);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  let x = 10; // quiet zone
  for (const c of codes) {
    [...C128[c]].forEach((w, i) => {
      if (i % 2 === 0) {
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', 0); r.setAttribute('width', w); r.setAttribute('height', 60);
        svg.append(r);
      }
      x += Number(w);
    });
  }
  svg.setAttribute('viewBox', `0 0 ${x + 10} 60`);
  svg.setAttribute('class', 'barcode');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Barcode ${text}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  return svg;
}

async function viewDocument(kind, id, params) {
  const as = new URLSearchParams(params).get('as') || 'buyer';
  if (!state.user) { location.hash = '#/login?next=' + encodeURIComponent(location.hash); return; }
  const data = as === 'seller' ? await api('GET', `/seller/orders/${encodeURIComponent(id)}/documents`)
    : as === 'admin' ? await api('GET', `/admin/orders/${encodeURIComponent(id)}/documents`)
      : await api('GET', `/orders/${encodeURIComponent(id)}/invoice`);
  const back = as === 'seller' ? '#/seller?tab=orders&view=all' : as === 'admin' ? '#/admin?tab=orders' : `#/orders/${id}`;
  const bar = h('div', { class: 'doc-bar no-print' }, h('a', { href: back }, 'Back'),
    h('button', { class: 'btn btn-outline', onclick: () => window.print() }, 'Print or save as PDF'),
    as !== 'buyer' ? h('a', { href: `#/doc/${kind === 'label' ? 'invoice' : 'label'}/${id}?as=${as}` }, kind === 'label' ? 'Invoice' : 'Shipping label') : null);

  if (kind === 'label') {
    const l = data.label;
    document.title = `Label ${l.awb || l.orderNo}`;
    mount(bar, h('div', { class: 'label-sheet' },
      h('div', { class: 'label-row label-top' }, h('div', null, h('b', null, l.courier || 'Courier not booked yet'), h('div', null, l.speed === 'express' ? 'EXPRESS' : 'STANDARD')),
        l.cod ? h('div', { class: 'label-cod' }, 'COLLECT CASH', h('b', null, inr(l.cod))) : h('div', { class: 'label-cod prepaid' }, h('b', null, 'PREPAID'))),
      l.awb ? h('div', { class: 'label-row center' }, barcode(l.awb), h('div', { class: 'label-awb' }, l.awb)) : h('p', { class: 'label-row' }, 'The tracking number appears once the courier is booked.'),
      h('div', { class: 'label-row' }, h('div', { class: 'label-k' }, 'DELIVER TO'), h('b', null, l.to.name), h('div', null, l.to.address), h('div', { class: 'label-pin' }, l.to.pincode), h('div', null, `Phone ${l.to.phone}`)),
      h('div', { class: 'label-row' }, h('div', { class: 'label-k' }, 'FROM (RETURN ADDRESS)'), h('b', null, l.from.name), h('div', null, l.from.address), l.from.phone ? h('div', null, `Phone ${l.from.phone}`) : null),
      h('div', { class: 'label-row label-foot' }, h('span', null, `Order ${l.orderNo}`), h('span', null, `${l.units} item(s)`), h('span', null, 'Sold on Bazaario'))));
    return;
  }

  const inv = data.invoice;
  document.title = `${inv.type} ${inv.number}`;
  const s = inv.supplier;
  const tax = inv.type === 'Tax invoice';
  const cols = tax ? (inv.intraState ? ['Item', 'HSN', 'Qty', 'Taxable value', 'GST', 'CGST', 'SGST', 'Total'] : ['Item', 'HSN', 'Qty', 'Taxable value', 'GST', 'IGST', 'Total'])
    : ['Item', 'HSN', 'Qty', 'Value', 'Total'];
  const cells = (l) => (tax ? [l.title, l.hsn, l.qty, inr(l.taxable), `${l.rate}%`, ...(inv.intraState ? [inr(l.cgst), inr(l.sgst)] : [inr(l.igst)]), inr(l.total)]
    : [l.title, l.hsn, l.qty, inr(l.taxable), inr(l.total)]);
  const t = inv.totals;
  mount(bar, h('div', { class: 'invoice-sheet' },
    h('div', { class: 'inv-head' }, h('div', null, h('h1', null, inv.type), h('div', null, `No. ${inv.number}`), h('div', null, `Date ${fmtDate(inv.date)}`)),
      h('div', { class: 'right' }, h('span', { class: 'logo-word' }, 'Bazaario'), h('div', { class: 'hint' }, `Order ${inv.orderNo} · ${fmtDate(inv.orderDate)}`))),
    h('div', { class: 'inv-parties' },
      h('div', null, h('div', { class: 'label-k' }, 'SOLD BY'), h('b', null, s.name), s.tradeName ? h('div', null, `Trading as ${s.tradeName}`) : null, h('div', null, s.address),
        h('div', null, s.state), s.gstin ? h('div', null, `GSTIN ${s.gstin}`) : s.enrolmentId ? h('div', null, `GST enrolment ID ${s.enrolmentId}`) : h('div', { class: 'hint' }, 'GSTIN to be added')),
      h('div', null, h('div', { class: 'label-k' }, 'BILL AND SHIP TO'), h('b', null, inv.buyer.name), h('div', null, inv.buyer.address), h('div', null, inv.buyer.state),
        h('div', null, `Place of supply: ${inv.placeOfSupply}`))),
    h('div', { class: 'inv-scroll' }, h('table', { class: 'inv-table' }, h('tr', null, cols.map((c) => h('th', null, c))),
      inv.lines.map((l) => h('tr', null, cells(l).map((c) => h('td', null, c)))),
      h('tr', { class: 'inv-total' }, h('td', { colSpan: 3 }, 'Total'), h('td', null, inr(t.taxable)),
        ...(tax ? [h('td', null, ''), ...(inv.intraState ? [h('td', null, inr(t.cgst)), h('td', null, inr(t.sgst))] : [h('td', null, inr(t.igst))])] : []),
        h('td', null, h('b', null, inr(t.total)))))),
    inv.lines.some((l) => l.discount) ? h('p', { class: 'hint' }, 'Values are after the Bazaario coupon discount.') : null,
    h('p', { class: 'hint' }, inv.note),
    inv.fees ? h('p', { class: 'hint' }, `Delivery and service fees of ${inr(inv.fees)} are billed by ${state.config.companyName || 'Bazaario'} separately.`) : null,
    h('p', { class: 'hint' }, 'This is a computer-generated invoice and needs no signature.')));
}
