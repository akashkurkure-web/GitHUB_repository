/* Bazaario resellers: join, share products on WhatsApp with your own margin, see customers and earnings.
 * Also the page a shared link opens (#/r/CODE) and the Studio Resellers tab. Uses helpers from app.js and seller.js. */
'use strict';

const shareUrl = (code) => `${location.origin}/#/r/${code}`;
const shareText = (s) => `${s.title}\nPrice: ${inr(s.sharePrice)} (MRP ${inr(s.mrp)})\nOrder here: ${shareUrl(s.code)}`;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied.'); } catch { toast('Copy did not work here. Press and hold the link to copy it.', true); }
}

/** Popup after sharing: the link, WhatsApp and copy. */
function shareDialog(s) {
  const modal = $('#modal');
  $('#modal-body').replaceChildren(h('h3', null, 'Share this product'),
    h('p', { class: 'small' }, s.title),
    h('p', null, 'Your customers pay ', h('b', null, inr(s.sharePrice)), ` · you earn ${inr(s.margin)} on each one`),
    h('input', { readOnly: true, value: shareUrl(s.code), 'aria-label': 'Share link', onfocus: (e) => e.target.select() }),
    h('div', { class: 'line-actions', style: { marginTop: '12px' } },
      h('a', { class: 'btn btn-primary', href: `https://wa.me/?text=${encodeURIComponent(shareText(s))}`, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => copyText(shareText(s)) }, 'Copy message'),
      h('button', { class: 'link-btn', type: 'button', onclick: () => modal.close() }, 'Close')),
    h('p', { class: 'hint' }, 'The link shows your price and adds the item to your customer\'s bag. Bazaario delivers, collects payment and handles returns.'));
  modal.showModal();
}

const RESELL_TABS = [['share', 'Share products'], ['shares', 'My shares'], ['orders', 'Orders and customers'], ['earnings', 'Earnings']];

async function viewResell(params) {
  document.title = 'Resell and earn · Bazaario';
  const intro = [
    h('h1', { class: 'page-title' }, 'Resell on Bazaario and earn'),
    h('p', { class: 'tagline' }, 'Share products with your contacts on WhatsApp, add your own margin, and earn on every order. No stock, no delivery, no investment.'),
    h('div', { class: 'lane-grid' },
      h('div', { class: 'card lane' }, h('h3', null, '1. Pick and price'), h('p', { class: 'small' }, 'Choose any product and add your margin on top of the Bazaario price, up to 30% and never above MRP.')),
      h('div', { class: 'card lane' }, h('h3', null, '2. Share'), h('p', { class: 'small' }, 'Send your link on WhatsApp. Your customer sees your price and orders on Bazaario.')),
      h('div', { class: 'card lane' }, h('h3', null, '3. Earn'), h('p', { class: 'small' }, 'Your margin reaches your UPI once the return window closes for each order.'))),
  ];
  if (!state.user) {
    mount(intro, h('p', null, h('a', { class: 'btn btn-primary', href: '#/login?next=' + encodeURIComponent('#/resell') }, 'Sign in to start'),
      ' ', h('a', { class: 'btn btn-outline', href: '#/register?next=' + encodeURIComponent('#/resell') }, 'Create an account')));
    return;
  }
  const me = await api('GET', '/reseller/me');
  if (!me.reseller) { mount(intro, joinForm()); return; }
  const r = me.reseller;
  if (r.status !== 'active') {
    mount(h('h1', { class: 'page-title' }, 'Resell and earn'), h('div', { class: 'card' }, h('h3', null, 'Your reseller account is paused'),
      r.statusNote ? h('p', { class: 'low' }, r.statusNote) : null, h('a', { class: 'btn btn-outline', href: '#/help' }, 'Contact support')));
    return;
  }
  const qp = new URLSearchParams(params);
  const tab = RESELL_TABS.some(([k]) => k === qp.get('tab')) ? qp.get('tab') : 'share';
  const e = me.earnings;
  const tabs = h('div', { class: 'tabs' }, RESELL_TABS.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { location.hash = `#/resell?tab=${k}`; } }, l)));
  const body = h('div');
  mount(h('h1', { class: 'page-title' }, 'Resell and earn'), h('p', { class: 'tagline' }, `${r.displayName} · reseller code ${r.code} · payouts to ${r.upiId}`),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Products shared'), h('b', null, me.shares)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Link views'), h('b', null, me.views)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Orders'), h('b', null, e.orders)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Earned so far'), h('b', null, inr(e.pending + e.window + e.ready + e.paid)))),
    tabs, body);
  await ({ share: resellCatalog, shares: resellShares, orders: resellOrders, earnings: resellEarnings })[tab](body, me, qp);
}

function joinForm() {
  const name = h('input', { required: true, maxLength: 40, value: state.user.name, placeholder: 'Shown to your customers' });
  const phone = h('input', { required: true, maxLength: 10, inputMode: 'numeric', value: state.user.phone || '', placeholder: '10-digit mobile number' });
  const upi = h('input', { required: true, maxLength: 100, placeholder: 'name@okbank' });
  const pan = h('input', { maxLength: 10, placeholder: 'ABCDE1234F', autocapitalize: 'characters' });
  const agree = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'alert alert-err hidden' });
  return h('form', { class: 'card apply', onsubmit: async (ev) => {
    ev.preventDefault();
    err.classList.add('hidden');
    try {
      await api('POST', '/reseller/join', { displayName: name.value.trim(), phone: phone.value.trim(), upiId: upi.value.trim(), pan: pan.value.trim() || undefined, agree: agree.checked });
      toast('Welcome. Pick a product to share.');
      route();
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
  } }, h('h2', null, 'Join as a reseller'), err,
  h('div', { class: 'form-grid' }, field('Your name or shop name', name), field('WhatsApp number', phone), field('UPI ID for payouts', upi),
    field('PAN (optional)', pan, { hint: 'Needed once your earnings pass ₹20,000 in a year, for TDS.' })),
  h('label', { class: 'inline' }, agree, 'I agree to the ', h('a', { href: '#/page/terms', target: '_blank' }, 'reseller terms'), ' and will not make claims about products that are not on the product page.'),
  h('p', null, h('button', { class: 'btn btn-primary' }, 'Join for free')));
}

async function resellCatalog(body, me, qp) {
  const q = qp.get('q') || '';
  const cat = qp.get('category') || '';
  const { items } = await api('GET', `/reseller/catalog?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`);
  const search = h('input', { type: 'search', value: q, placeholder: 'Search products to share', maxLength: 60 });
  const catSel = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'),
    state.categories.map((c) => h('option', { value: c.slug, selected: c.slug === cat }, c.name)));
  const share = async (p, marginIn) => {
    try {
      const { share: s } = await api('POST', '/reseller/shares', { productId: p.id, margin: Number(marginIn.value || 0) });
      shareDialog(s);
    } catch (ex) { fail(ex); }
  };
  fill(body,
    h('form', { class: 'resell-search', onsubmit: (ev) => {
      ev.preventDefault();
      const n = new URLSearchParams({ tab: 'share' });
      if (search.value.trim()) n.set('q', search.value.trim());
      if (catSel.value) n.set('category', catSel.value);
      location.hash = '#/resell?' + n.toString();
    } }, search, catSel, h('button', { class: 'btn btn-outline' }, 'Search')),
    items.length ? h('div', { class: 'resell-grid' }, items.map((p) => {
      const maxRs = Math.floor(p.maxMargin / 100);
      const marginIn = h('input', { type: 'number', min: 0, max: maxRs, value: p.share ? Math.round(p.share.margin / 100) : Math.min(maxRs, Math.round(p.price / 1000) * 10 || 0),
        'aria-label': 'Your margin in rupees' });
      const priceOut = h('b', { class: 'now-sm' });
      const paintPrice = () => { priceOut.textContent = inr(p.price + Math.min(maxRs, Math.max(0, Number(marginIn.value || 0))) * 100); };
      marginIn.addEventListener('input', paintPrice);
      paintPrice();
      return h('div', { class: 'card resell-card' },
        h('a', { href: `#/p/${p.id}`, tabIndex: -1 }, pic(p, 'pimg')),
        h('div', null, h('a', { class: 'line-title', href: `#/p/${p.id}` }, p.title),
          h('div', { class: 'hint' }, `Bazaario price ${inr(p.price)} · MRP ${inr(p.mrp)}`),
          h('div', { class: 'resell-margin' }, h('label', null, 'Your margin (₹)'), marginIn, h('span', { class: 'hint' }, `up to ₹${maxRs}`)),
          h('div', { class: 'small' }, 'Your customer pays ', priceOut),
          h('button', { class: 'btn btn-outline btn-sm', onclick: () => share(p, marginIn) }, p.share ? 'Update and share' : 'Share')));
    })) : h('div', { class: 'card empty' }, h('p', null, 'No products match. Try another word.')));
}

async function resellShares(body) {
  const { shares } = await api('GET', '/reseller/shares');
  const stop = async (s) => {
    if (!(await askConfirm(`Stop sharing "${s.title}"? The link will stop working.`, 'Stop sharing'))) return;
    try { await api('DELETE', `/reseller/shares/${s.id}`); toast('Link stopped.'); route(); } catch (ex) { fail(ex); }
  };
  fill(body, shares.length ? h('div', { class: 'table-wrap' }, h('table', null,
    h('tr', null, ['Product', 'Customer price', 'You earn', 'Views', 'Orders', ''].map((t) => h('th', null, t))),
    shares.map((s) => h('tr', null, h('td', null, s.title, h('div', { class: 'hint' }, s.code), !s.product_active || !s.stock ? h('div', { class: 'low small' }, 'Out of stock now') : null),
      h('td', null, inr(s.sharePrice)), h('td', null, inr(s.margin)), h('td', null, s.views), h('td', null, s.orders),
      h('td', null, h('div', { class: 'line-actions' }, h('button', { class: 'btn btn-outline btn-sm', onclick: () => shareDialog(s) }, 'Share again'),
        h('button', { class: 'link-btn danger', onclick: () => stop(s) }, 'Stop')))))))
    : h('div', { class: 'card empty' }, h('p', null, 'You have not shared anything yet.'), h('a', { class: 'btn btn-outline', href: '#/resell?tab=share' }, 'Find products to share')));
}

const STAGE = { pending: 'On its way', window: 'In return window', ready: 'Ready to pay', paid: 'Paid', lost: 'Cancelled or returned' };

async function resellOrders(body) {
  const d = await api('GET', '/reseller/sales');
  fill(body,
    h('div', { class: 'card' }, h('h3', null, 'Your customers'),
      d.customers.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Customer', 'Orders', 'Spent', 'You earned', 'Last order'].map((t) => h('th', null, t))),
        d.customers.map((c) => h('tr', null, h('td', null, `${c.name}, ${c.city}`), h('td', null, c.orders), h('td', null, inr(c.spent)), h('td', null, inr(c.earned)), h('td', null, fmtDate(c.last))))))
        : h('p', { class: 'muted' }, 'Customers who order from your links appear here. Only their first name and city are shown.')),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Orders from your links'),
      d.sales.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Date', 'Order', 'Item', 'Customer', 'Status', 'You earn'].map((t) => h('th', null, t))),
        d.sales.map((x) => h('tr', null, h('td', null, fmtDate(x.createdAt)), h('td', null, x.orderNo), h('td', null, `${x.qty} × ${x.title}`), h('td', null, x.customer),
          h('td', null, STATUS_LABEL[x.status] || x.status, h('div', { class: 'hint' }, STAGE[x.stage], x.stage === 'window' && x.releaseAt ? ` until ${fmtDate(x.releaseAt)}` : '')),
          h('td', { class: x.stage === 'lost' ? 'muted' : '' }, x.stage === 'lost' ? h('s', null, inr(x.earn)) : inr(x.earn))))))
        : h('p', { class: 'muted' }, 'No orders yet. Share a product to get started.')));
}

async function resellEarnings(body) {
  const d = await api('GET', '/reseller/payouts');
  const t = d.totals;
  fill(body,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Orders on their way'), h('b', null, inr(t.pending))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'In return window'), h('b', null, inr(t.window))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Ready to pay'), h('b', null, inr(t.ready))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Paid to you'), h('b', null, inr(t.paid)))),
    h('p', { class: 'hint' }, `Earnings are paid to ${d.upiId} after the ${d.rules.returnWindowDays}-day return window. Once you earn more than ${inr(d.rules.tdsThreshold)} in a financial year, TDS of ${d.rules.tdsPct}% is deducted (section 194H). Earned this year: ${inr(d.yearToDate)}.`),
    h('div', { class: 'card' }, h('h3', null, 'Payouts'),
      d.payouts.length ? h('table', null, h('tr', null, ['Date', 'Payout', 'Earned', 'TDS', 'Paid', 'UTR'].map((x) => h('th', null, x))),
        d.payouts.map((p) => h('tr', null, h('td', null, fmtDate(p.created_at)), h('td', null, p.payout_no), h('td', null, inr(p.gross)), h('td', null, p.tds ? inr(p.tds) : '—'),
          h('td', null, h('b', null, inr(p.net))), h('td', { class: 'hint' }, p.utr || '—'))))
        : h('p', { class: 'muted' }, 'No payouts yet.')));
}

// ---------------- The page a shared link opens ----------------
async function viewShare(code) {
  const { share, product: p } = await api('GET', `/share/${encodeURIComponent(code || '')}`);
  document.title = `${p.title} · Bazaario`;
  const item = { ...p, resellerName: share.resellerName };
  mount(
    h('p', { class: 'alert alert-ok' }, `${share.resellerName} shared this with you. Bazaario delivers it, and you can pay on delivery or online.`),
    h('div', { class: 'pdp' },
      h('div', { class: 'pdp-gallery' }, pic(p, 'pdp-img', { role: 'img', 'aria-label': p.title })),
      h('div', { class: 'pdp-info' },
        h('span', { class: 'brand' }, p.brand),
        h('h1', { class: 'pdp-title' }, p.title),
        h('div', { class: 'pdp-meta' }, ratingChip(p), h('span', { class: 'muted' }, p.category_name)),
        h('div', { class: 'buy-card' },
          priceBlock(p, true),
          h('p', { class: 'muted small' }, 'Inclusive of GST'),
          p.stock > 0 ? h('div', { class: 'buy-actions' },
            h('button', { class: 'btn btn-primary', onclick: () => addToCart(item, 1, true, null, share.code) }, 'Buy now'),
            h('button', { class: 'btn btn-outline', onclick: () => addToCart(item, 1, false, null, share.code) }, 'Add to bag'))
            : h('p', { class: 'err' }, 'Out of stock right now.'),
          h('div', { class: 'trust' }, h('div', null, `${state.config.returnWindowDays || 10}-day returns`), h('div', null, 'Cash on Delivery'), h('div', null, 'Secure payment'))),
        h('h3', null, 'Highlights'),
        h('ul', { class: 'features' }, p.features.map((f) => h('li', null, f))),
        h('p', { class: 'muted' }, p.description))));
}

// ---------------- Studio ----------------
async function studioResellers(body) {
  const { resellers } = await api('GET', '/admin/resellers');
  const act = async (r, action) => {
    let note;
    if (action === 'suspend') { note = await askText(`Pause ${r.display_name}?`, { yes: 'Pause', hint: 'Their links stop working. They see this reason.' }); if (!note) return; }
    try { await api('PATCH', `/admin/resellers/${r.id}`, { action, note }); toast('Reseller updated.'); route(); } catch (ex) { fail(ex); }
  };
  fill(body, h('p', { class: 'muted' }, 'Resellers share products with their own margin. Their earnings are paid in the settlement run once the return window closes.'),
    resellers.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Reseller', 'Payout to', 'Shares', 'Views', 'Orders', 'Earned', 'Status', ''].map((t) => h('th', null, t))),
      resellers.map((r) => h('tr', null, h('td', null, h('b', null, r.display_name), h('div', { class: 'hint' }, `${r.code} · ${r.email} · ${r.phone}`)),
        h('td', null, r.upi_id, r.pan ? h('div', { class: 'hint' }, `PAN ${r.pan}`) : h('div', { class: 'hint' }, 'No PAN')),
        h('td', null, r.shares), h('td', null, r.views), h('td', null, r.orders), h('td', null, inr(r.earned)),
        h('td', null, r.status === 'active' ? 'Active' : 'Paused', r.status_note ? h('div', { class: 'hint' }, r.status_note) : null),
        h('td', null, r.status === 'active' ? h('button', { class: 'link-btn danger', onclick: () => act(r, 'suspend') }, 'Pause')
          : h('button', { class: 'btn btn-outline btn-sm', onclick: () => act(r, 'reinstate') }, 'Reinstate'))))))
      : h('div', { class: 'card empty' }, h('p', null, 'No resellers yet.')));
}
