/* Bazaario storefront - vanilla JS single-page app.
 * Security note: all dynamic content is rendered with textContent / DOM APIs (never innerHTML),
 * so product data, reviews and user input cannot inject markup (XSS-safe by construction). */
'use strict';

const state = { user: null, csrf: null, categories: [], config: {}, cartCount: 0, timers: [], wish: new Set() };
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

// ---------------- DOM helper ----------------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs || {})) {
    if (val === null || val === undefined || val === false) continue;
    if (k === 'class') el.className = val;
    else if (k === 'style') Object.assign(el.style, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), val);
    else if (k === 'dataset') Object.assign(el.dataset, val);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = val;
    else el.setAttribute(k, val === true ? '' : val);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
/** Replaces an element's content, skipping empty (null/false) parts and flattening lists. */
const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
const add = (el, ...nodes) => el.append(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
const mount = (...nodes) => { app.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false)); app.focus({ preventScroll: true }); };

// ---------------- Formatting ----------------
const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
const pct = (p) => Math.round(((p.mrp - p.price) / p.mrp) * 100);
// Bazaario runs on India time, whatever the device's own clock is set to.
const TZ = 'Asia/Kolkata';
const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const istDay = (ts) => Math.floor((ts + 330 * 60000) / 86400000);
const fmtWhen = (ts) => new Date(ts).toLocaleString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const deliveryDate = (express) => {
  const d = new Date(Date.now() + (express ? 1 : 4) * 86400000);
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
};
/** "today by 4:30 pm", "tomorrow" or "by Thursday, 9 October", from a delivery promise. */
function promiseText({ speed, promisedAt }) {
  const d = new Date(promisedAt);
  const days = istDay(promisedAt) - istDay(Date.now());
  const time = d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  if (speed === 'express') return `${days <= 0 ? 'today' : 'tomorrow'} by ${time}`;
  return days === 1 ? 'tomorrow' : `by ${d.toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })}`;
}
const STATUS_LABEL = {
  placed: 'Order placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', out_for_delivery: 'Out for delivery',
  delivery_failed: 'Delivery attempt failed', delivered: 'Delivered', rto: 'Returned to Bazaario', cancelled: 'Cancelled',
  return_requested: 'Return requested', returned: 'Returned and refunded',
  reattempt_requested: 'New delivery time requested', return_pickup: 'Return pickup scheduled', return_rejected: 'Return not accepted',
  sent_to_seller: 'Sent to the seller', on_hold: 'Being checked', rerouted: 'Moved to another seller', rider_assigned: 'Rider assigned',
};
const LANE_LABEL = { direct: 'Bazaario Direct', brand: 'Brand store', standard: 'Standard seller', value: 'Value seller', shop: 'Partner shop' };
/** "Excellent" etc. from a seller performance score; new sellers have none yet. */
const scoreText = (score) => (score === null || score === undefined ? 'New seller' : score >= 85 ? `Excellent seller (${score}/100)` : score >= 70 ? `Good seller (${score}/100)` : `Seller score ${score}/100`);
const PAY_LABEL = { upi: 'UPI', card: 'Card', emi: 'Card EMI', cod: 'Cash on Delivery', wallet: 'Wallet' };

function priceBlock(p, big) {
  return h('div', { class: 'pricing' + (big ? ' pricing-lg' : '') },
    h('span', { class: 'now' }, inr(p.price)),
    p.mrp > p.price ? [h('span', { class: 'was', 'aria-label': `MRP ${inr(p.mrp)}` }, inr(p.mrp)),
      h('span', { class: 'save' }, `Save ${inr(p.mrp - p.price)} · ${pct(p)}%`)] : null);
}

function ratingChip(p) {
  return h('span', { class: 'rating-wrap' }, h('span', { class: 'rating' }, `${p.rating_avg.toFixed(1)} ★`),
    h('span', { class: 'muted' }, `(${p.rating_count.toLocaleString('en-IN')})`));
}

// ---------------- API client ----------------
async function api(method, path, body) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (state.csrf && method !== 'GET') opts.headers['X-CSRF-Token'] = state.csrf;
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new Error('We could not reach Bazaario. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data.details;
    if (res.status === 401 && state.user) { state.user = null; state.csrf = null; renderHeader(); }
    throw err;
  }
  return data;
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}
const fail = (e) => toast(e.message, true);

// ---------------- Local storage (guest cart, recently viewed, PIN) ----------------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('bz_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bz_' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function guestCart() { return store.get('guest_cart', []); }
function setGuestCart(items) { store.set('guest_cart', items); updateCartCount(); }

function pushRecent(id) {
  const r = store.get('recent', []).filter((x) => x !== id);
  r.unshift(id);
  store.set('recent', r.slice(0, 12));
}

// ---------------- Session / header ----------------
async function refreshSession() {
  const me = await api('GET', '/auth/me');
  state.user = me.user;
  state.csrf = me.csrfToken || null;
  await loadWishlistIds();
}

async function loadWishlistIds() {
  state.wish = new Set();
  if (!state.user) return;
  try { (await api('GET', '/wishlist')).items.forEach((i) => state.wish.add(i.id)); } catch { /* shown as not saved */ }
}

async function updateCartCount() {
  if (state.user) {
    try { state.cartCount = (await api('GET', '/cart')).count; } catch { state.cartCount = 0; }
  } else {
    state.cartCount = guestCart().reduce((s, i) => s + i.qty, 0);
  }
  $('#cart-count').textContent = state.cartCount;
  $('#cart-count').classList.toggle('empty', !state.cartCount);
}

function renderHeader() {
  const link = $('#account-link');
  $('#hello').textContent = state.user ? `Hi, ${state.user.name.split(' ')[0]}` : 'Sign in';
  link.href = state.user ? '#/account' : '#/login';
  const pin = store.get('pin', '');
  $('#deliver-pin').textContent = pin || 'add PIN code';
  updateCartCount();
}

async function afterLogin(data, redirect) {
  state.user = data.user;
  state.csrf = data.csrfToken;
  await loadWishlistIds();
  const guest = guestCart();
  if (guest.length) {
    try { await api('POST', '/cart/merge', { items: guest }); } catch { /* ignore */ }
    store.set('guest_cart', []);
  }
  renderHeader();
  location.hash = redirect || '#/';
}

async function logout() {
  await api('POST', '/auth/logout').catch(() => {});
  state.user = null; state.csrf = null; state.wish = new Set();
  renderHeader();
  toast('You have been signed out.');
  location.hash = '#/';
}

/** In-page yes/no question (browser confirm() boxes are blocked in some app views). */
function askConfirm(message, yesLabel = 'Yes') {
  return new Promise((resolve) => {
    const modal = $('#modal');
    const done = (answer) => { modal.close(); resolve(answer); };
    $('#modal-body').replaceChildren(h('h3', null, message),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => done(true) }, yesLabel),
        h('button', { type: 'button', class: 'btn btn-outline', onclick: () => done(false) }, 'No, go back')));
    modal.addEventListener('cancel', () => resolve(false), { once: true });
    modal.showModal();
  });
}

// ---------------- Cart actions ----------------
/** Adds to the bag from the best offer, or from one seller's offer when `offerId` is given ("Other sellers"). */
async function addToCart(product, qty = 1, buyNow = false, offerId = null, shareCode = null) {
  try {
    if (state.user) {
      await api('POST', '/cart', { productId: product.id, qty, offerId: offerId || undefined, shareCode: shareCode || undefined });
    } else {
      const items = guestCart();
      const ex = items.find((i) => i.productId === product.id);
      const max = Math.min(product.stock, state.config.maxQtyPerItem || 10);
      // Picking another seller replaces the line, as it does for signed-in shoppers.
      if (ex && (ex.offerId || null) === (offerId || null)) Object.assign(ex, { qty: Math.min(ex.qty + qty, max), shareCode: shareCode || ex.shareCode });
      else if (ex) Object.assign(ex, { qty: Math.min(qty, max), offerId: offerId || undefined, shareCode: shareCode || undefined });
      else items.unshift({ productId: product.id, qty: Math.min(qty, max), offerId: offerId || undefined, shareCode: shareCode || undefined });
      // A shared link's price and reseller are kept so the signed-out bag shows what the buyer will pay.
      if (shareCode) Object.assign(items.find((i) => i.productId === product.id), { sharePrice: product.price, resellerName: product.resellerName });
      setGuestCart(items);
    }
    await updateCartCount();
    if (buyNow) {
      location.hash = state.user ? '#/checkout' : '#/login?next=' + encodeURIComponent('#/checkout');
    } else toast(`Added to your bag: ${product.title.slice(0, 50)}`);
  } catch (e) { fail(e); }
}

async function toggleWishlist(product, btn) {
  if (!state.user) { location.hash = '#/login?next=' + encodeURIComponent(location.hash); return; }
  const saved = state.wish.has(product.id);
  try {
    if (saved) {
      await api('DELETE', `/wishlist/${product.id}`);
      state.wish.delete(product.id);
      toast('Removed from your wishlist');
    } else {
      await api('POST', '/wishlist', { productId: product.id });
      state.wish.add(product.id);
      toast('Saved to your wishlist');
    }
    document.querySelectorAll(`[data-wish="${product.id}"]`).forEach(paintWishButton);
    if (btn && !btn.dataset.wish) paintWishButton(btn);
  } catch (e) { fail(e); }
}

/** Shows a wishlist button as saved or not; the same button saves and removes. */
function paintWishButton(btn) {
  const saved = state.wish.has(Number(btn.dataset.wish));
  btn.classList.toggle('on', saved);
  btn.setAttribute('aria-pressed', String(saved));
  if (btn.classList.contains('heart')) {
    btn.textContent = saved ? '♥' : '♡';
    btn.setAttribute('aria-label', saved ? 'Remove from wishlist' : 'Save to wishlist');
    btn.title = saved ? 'Remove from wishlist' : 'Save to wishlist';
  } else {
    btn.textContent = saved ? 'Saved to wishlist (tap to remove)' : 'Save to wishlist';
  }
  return btn;
}

// ---------------- Product photo ----------------
/** Product photo when one is set, otherwise the coloured tile with the product's icon. */
function pic(p, cls, attrs = {}) {
  const tile = h('div', { class: cls, style: { background: p.color || 'var(--paper-2)' }, ...attrs }, p.emoji || '📦');
  if (!p.image) return tile;
  const img = h('img', { src: p.image, alt: p.title || '', loading: 'lazy', decoding: 'async' });
  const box = h('div', { class: cls + ' has-photo', ...attrs }, img);
  img.addEventListener('error', () => box.replaceWith(tile), { once: true });
  return box;
}

// ---------------- Product card ----------------
function productCard(p, { compact } = {}) {
  const url = `#/p/${p.id}`;
  return h('article', { class: 'pcard' },
    h('div', { class: 'pimg-wrap' },
      h('a', { href: url, 'aria-label': p.title, tabIndex: -1 },
        pic(p, 'pimg')),
      p.is_deal ? h('span', { class: 'tag-steal' }, 'Deal') : null,
      paintWishButton(h('button', { class: 'heart', type: 'button', 'data-wish': p.id, onclick: (e) => toggleWishlist(p, e.currentTarget) }))),
    h('div', { class: 'pbody' },
      p.brand ? h('div', { class: 'brand' }, p.brand) : null,
      h('a', { class: 'title', href: url }, p.title),
      ratingChip(p),
      priceBlock(p),
      p.assured ? h('span', { class: 'assured-tag' }, 'Bazaario Assured') : null,
      h('div', { class: 'ship' }, p.express ? 'Express delivery available' : `Free delivery by ${deliveryDate(false).split(',')[0]}`),
      p.stock === 0 ? h('div', { class: 'err' }, 'Out of stock') : p.stock < 10 ? h('div', { class: 'low' }, `Only ${p.stock} left`) : null,
      compact || p.stock === 0 ? null : h('button', { class: 'btn btn-outline btn-block', onclick: () => addToCart(p) }, 'Add to bag')));
}

// ---------------- Views ----------------
async function viewHome() {
  const [deals, best, all] = await Promise.all([
    api('GET', '/products?deals=1&limit=8&sort=discount'),
    api('GET', '/products?sort=rating&limit=8'),
    api('GET', '/products?limit=48'),
  ]);
  const collage = deals.items.slice(0, 4);
  const recentIds = store.get('recent', []);
  const recent = all.items.filter((p) => recentIds.includes(p.id)).sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
  const section = (title, tagline, link, items) => h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('div', null, h('h2', null, title), h('p', { class: 'tagline' }, tagline)),
      link ? h('a', { class: 'btn btn-ghost', href: link }, 'View all') : null),
    h('div', { class: 'grid' }, items.map((p) => productCard(p))));

  mount(
    h('section', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('span', { class: 'eyebrow' }, 'Festive sale'),
        h('h1', null, 'Everything your home needs, delivered.'),
        h('p', null, 'Handpicked brands, honest prices and doorstep delivery across India. New here? Take 10% off with ', h('b', null, 'WELCOME10'), '.'),
        h('div', { class: 'hero-cta' },
          h('a', { class: 'btn btn-primary', href: '#/s?deals=1' }, 'Shop deals'),
          h('a', { class: 'btn btn-outline', href: '#/s?sort=newest' }, 'New arrivals'))),
      h('div', { class: 'hero-collage', 'aria-hidden': 'true' }, collage.map((p, i) =>
        h('a', { class: `collage-tile t${i}${p.image ? ' has-photo' : ''}`, href: `#/p/${p.id}`, tabIndex: -1, style: { background: p.color } },
          p.image ? h('img', { src: p.image, alt: '', loading: 'lazy' }) : h('span', { class: 'collage-emoji' }, p.emoji), h('span', { class: 'collage-price' }, inr(p.price)))))),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('div', null, h('h2', null, 'Shop by category'), h('p', { class: 'tagline' }, 'Browse all departments'))),
      h('div', { class: 'cat-row' }, state.categories.map((c) => h('a', { class: 'cat', href: `#/s?category=${c.slug}` }, c.name)))),
    section('Deals of the day', 'Limited-time offers', '#/s?deals=1', deals.items),
    h('section', { class: 'promo' },
      h('div', null, h('h3', null, 'Free delivery, every day'), h('p', null, 'On orders above ₹499, with 10-day easy returns and Cash on Delivery.')),
      h('div', { class: 'promo-badges' }, h('span', null, 'Secure payments'), h('span', null, 'Easy returns'), h('span', null, 'Genuine brands'))),
    section('Most loved', 'Highest rated products', '#/s?sort=rating', best.items),
    recent.length ? section('Recently viewed', 'Based on your browsing', null, recent.slice(0, 8)) : null,
    state.user ? null : h('section', { class: 'signin-band' },
      h('div', null, h('h3', null, 'Your bazaar, personalised'), h('p', null, 'Sign in for saved bags, wishlists and order tracking.')),
      h('div', { class: 'hero-cta' }, h('a', { class: 'btn btn-primary', href: '#/login' }, 'Sign in'), h('a', { class: 'btn btn-outline', href: '#/register' }, 'Create account'))));
}

async function viewSearch(params) {
  const q = new URLSearchParams(params);
  if (!q.get('page')) q.set('page', '1');
  const data = await api('GET', '/products?' + q.toString());
  const go = (changes) => {
    const n = new URLSearchParams(q);
    for (const [k, val] of Object.entries(changes)) { if (val === null || val === '') n.delete(k); else n.set(k, val); }
    if (!('page' in changes)) n.set('page', '1');
    location.hash = '#/s?' + n.toString();
  };
  const brandsSel = (q.get('brand') || '').split(',').filter(Boolean);
  const cat = state.categories.find((c) => c.slug === q.get('category'));
  const heading = q.get('q') ? `"${q.get('q')}"` : cat ? cat.name : q.get('deals') ? 'Deals' : 'All products';

  const minIn = h('input', { type: 'number', min: 0, placeholder: 'Min', value: q.get('min') || '' });
  const maxIn = h('input', { type: 'number', min: 0, placeholder: 'Max', value: q.get('max') || '' });

  const filters = h('aside', { class: 'filters', 'aria-label': 'Filters' },
    h('h4', null, 'Delivery'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('express') === '1', onchange: (e) => go({ express: e.target.checked ? '1' : null }) }), 'Delivery tomorrow'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('instock') === '1', onchange: (e) => go({ instock: e.target.checked ? '1' : null }) }), 'Include in-stock only'),
    h('h4', null, 'Category'),
    h('button', { class: 'f' + (!q.get('category') ? ' sel' : ''), onclick: () => go({ category: null }) }, 'Any category'),
    state.categories.map((c) => h('button', { class: 'f' + (c.slug === q.get('category') ? ' sel' : ''), onclick: () => go({ category: c.slug }) }, c.name)),
    h('h4', null, 'Rating'),
    h('div', { class: 'chip-set' }, [4, 3, 2].map((r) => h('button', { class: 'fchip' + (q.get('rating') === String(r) ? ' sel' : ''), onclick: () => go({ rating: q.get('rating') === String(r) ? null : r }) }, `${r}★ & above`))),
    data.brands.length ? h('h4', null, 'Brands') : null,
    data.brands.map((b) => h('label', { class: 'inline' }, h('input', {
      type: 'checkbox', checked: brandsSel.includes(b.brand),
      onchange: (e) => {
        const next = e.target.checked ? [...brandsSel, b.brand] : brandsSel.filter((x) => x !== b.brand);
        go({ brand: next.join(',') || null });
      },
    }), `${b.brand} (${b.n})`)),
    h('h4', null, 'Price'),
    h('div', { class: 'chip-set' }, [[0, 500], [500, 1000], [1000, 5000], [5000, 20000], [20000, null]].map(([a, b]) =>
      h('button', { class: 'fchip', onclick: () => go({ min: a || null, max: b }) }, b ? `₹${a.toLocaleString('en-IN')}–${b.toLocaleString('en-IN')}` : `₹${a.toLocaleString('en-IN')}+`))),
    h('div', { class: 'price-range' }, minIn, maxIn, h('button', { class: 'btn btn-sm', onclick: () => go({ min: minIn.value || null, max: maxIn.value || null }) }, 'Go')),
    h('h4', null, 'Offers'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('deals') === '1', onchange: (e) => go({ deals: e.target.checked ? '1' : null }) }), 'Deals only'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('assured') === '1', onchange: (e) => go({ assured: e.target.checked ? '1' : null }) }), 'Bazaario Assured'),
    h('p', null, h('a', { class: 'btn btn-ghost', href: '#/s' }, 'Clear all filters')));

  const start = (data.page - 1) * data.pageSize + 1;
  const sortSel = h('select', { 'aria-label': 'Sort by', onchange: (e) => go({ sort: e.target.value }) },
    [['relevance', 'Recommended'], ['price-asc', 'Price: Low to High'], ['price-desc', 'Price: High to Low'], ['rating', 'Avg. Customer Review'], ['newest', 'Newest Arrivals'], ['discount', 'Discount']]
      .map(([v, l]) => h('option', { value: v, selected: (q.get('sort') || 'relevance') === v }, l)));

  const pager = data.pages > 1 ? h('div', { class: 'pager' },
    h('button', { class: 'btn', disabled: data.page <= 1, onclick: () => go({ page: data.page - 1 }) }, '‹ Previous'),
    Array.from({ length: data.pages }, (_, i) => h('button', { class: 'btn' + (i + 1 === data.page ? ' cur' : ''), onclick: () => go({ page: i + 1 }) }, i + 1)),
    h('button', { class: 'btn', disabled: data.page >= data.pages, onclick: () => go({ page: data.page + 1 }) }, 'Next ›')) : null;

  // On phones the filters fold away behind one button so results come first.
  const filterCount = ['express', 'instock', 'category', 'rating', 'brand', 'min', 'max', 'deals', 'assured'].filter((k) => q.get(k)).length;
  const filterBox = h('details', { class: 'filters-fold', open: window.matchMedia('(min-width: 1081px)').matches },
    h('summary', null, filterCount ? `Filters (${filterCount})` : 'Filters'), filters);
  mount(h('div', { class: 'search-layout' }, filterBox,
    h('section', null,
      h('div', { class: 'results-bar' },
        h('div', null, h('h1', { class: 'results-title' }, heading), h('span', { class: 'muted' }, data.total ? `Showing ${start}–${Math.min(start + data.pageSize - 1, data.total)} of ${data.total} products` : 'No products found')),
        h('label', { class: 'inline' }, 'Sort by: ', sortSel)),
      data.items.length ? h('div', { class: 'grid' }, data.items.map((p) => productCard(p)))
        : h('div', { class: 'card empty' }, h('h2', null, 'No products found'), h('p', null, 'Try a different spelling or remove some filters.'), h('a', { class: 'btn btn-primary', href: '#/s?deals=1' }, 'Browse deals')),
      pager)));
}

async function viewProduct(id) {
  const pinNow = store.get('pin', '');
  const data = await api('GET', `/products/${encodeURIComponent(id)}${/^[1-9]\d{5}$/.test(pinNow) ? `?pin=${pinNow}` : ''}`);
  const p = data.product;
  pushRecent(p.id);
  document.title = `${p.title} · Bazaario`;
  const maxQty = Math.min(p.stock, state.config.maxQtyPerItem || 10);
  const qtySel = h('select', { 'aria-label': 'Quantity' }, Array.from({ length: Math.max(1, maxQty) }, (_, i) => h('option', { value: i + 1 }, i + 1)));

  const pin = store.get('pin', '');
  const pinIn = h('input', { value: pin, maxLength: 6, placeholder: 'Enter PIN code', inputMode: 'numeric', 'aria-label': 'Delivery PIN code' });
  const pinOut = h('div', { class: 'hint' });
  // Partner shops near the buyer's PIN code that can bring this item by Express (express.js).
  const nearBox = h('div');
  const paintNear = (list) => fill(nearBox, expressNear(p, list || []));
  paintNear(p.nearby);
  const checkPin = async () => {
    if (!/^[1-9]\d{5}$/.test(pinIn.value)) { pinOut.className = 'err'; pinOut.textContent = 'Please enter a valid 6-digit PIN code.'; return; }
    const changed = pinIn.value !== store.get('pin', '');
    store.set('pin', pinIn.value); renderHeader();
    if (changed) api('GET', `/products/${p.id}?pin=${pinIn.value}`).then((d) => paintNear(d.product.nearby)).catch(() => {});
    try {
      const d = await api('GET', `/delivery?pincode=${pinIn.value}&products=${p.id}`);
      pinOut.className = 'delivery-opts';
      fill(pinOut,
        d.options.map((o) => h('div', null, h('b', null, o.speed === 'express' ? 'Express: ' : 'Standard: '), cap(promiseText(o)),
          o.speed === 'express' ? h('span', { class: 'muted' }, ` · ${inr(o.fee)} from a store in ${d.city}`) : h('span', { class: 'muted' }, p.price >= (state.config.freeShippingThreshold || 0) ? ' · Free delivery' : ''))),
        h('div', { class: d.cod ? 'ok' : 'muted' }, d.cod ? 'Cash on Delivery available' : 'Cash on Delivery is not available for this PIN code'));
    } catch (e) { pinOut.className = 'err'; pinOut.textContent = e.message; }
  };
  if (pin) setTimeout(checkPin);

  const coupons = [['WELCOME10', '10% off up to ₹200 on orders above ₹499'], ['SAVE100', '₹100 off on orders above ₹999'], ['FESTIVE15', '15% off up to ₹1,500 above ₹2,999']];

  const total = data.ratingDistribution.reduce((s, r) => s + r.n, 0);
  const distRows = [5, 4, 3, 2, 1].map((star) => {
    const n = (data.ratingDistribution.find((r) => r.rating === star) || { n: 0 }).n;
    const share = total ? Math.round((n / total) * 100) : 0;
    return h('div', { class: 'bar-row' }, h('span', null, `${star} ★`), h('div', { class: 'bar' }, h('i', { style: { width: share + '%' } })), h('span', { class: 'muted' }, share + '%'));
  });

  const reviewForm = () => {
    if (!state.user) return h('p', null, h('a', { href: '#/login?next=' + encodeURIComponent(location.hash) }, 'Sign in'), ' to share your review.');
    if (!data.canReview) return h('p', { class: 'muted' }, 'Thanks — you have already reviewed this product.');
    let rating = 0;
    const starBtns = [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', 'aria-label': `${n} star`, onclick: () => { rating = n; starBtns.forEach((b, i) => b.classList.toggle('on', i < n)); } }, '★'));
    const title = h('input', { maxLength: 100, required: true, placeholder: "What's most important to know?" });
    const body = h('textarea', { rows: 4, maxLength: 2000, required: true, placeholder: 'What did you like or dislike?' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!rating) return toast('Please select a star rating.', true);
        try {
          await api('POST', `/products/${p.id}/reviews`, { rating, title: title.value, body: body.value });
          toast('Thank you! Your review has been published.');
          route();
        } catch (err) { fail(err); }
      },
    }, h('h3', null, 'Share your experience'), h('div', { class: 'star-input' }, starBtns),
      h('label', null, 'Headline'), title, h('label', null, 'Your review'), body,
      h('button', { class: 'btn btn-outline', style: { marginTop: '12px' } }, 'Post review'));
  };

  const wishBtn = paintWishButton(h('button', { class: 'btn btn-outline', type: 'button', 'data-wish': p.id, onclick: (e) => toggleWishlist(p, e.currentTarget) }));

  // Marketplace: who sells it, other sellers, and the details the law asks every listing to show.
  const best = p.offers[0] || null;
  const sellerLink = (s) => h('button', { type: 'button', class: 'link-btn', onclick: () => sellerDetails(s) }, s.name);
  const shipsText = (o) => (o.seller.lane === 'value' ? `Economy delivery, ships within ${o.seller.state}` : o.dispatchDays <= 1 ? 'Ships today or tomorrow' : `Ships in ${o.dispatchDays} days`);
  const others = p.offers.slice(1);
  const otherSellers = others.length ? h('div', { class: 'card other-sellers' },
    h('h3', null, `Other sellers on Bazaario (${others.length})`),
    others.map((o) => h('div', { class: 'offer-row' },
      h('div', null, h('b', { class: 'now-sm' }, inr(o.price)), o.assured ? h('span', { class: 'assured-tag' }, 'Assured') : null,
        h('div', { class: 'hint' }, shipsText(o))),
      h('div', null, sellerLink(o.seller), h('div', { class: 'hint' }, o.seller.lane === 'direct' ? 'Sold and shipped by Bazaario' : scoreText(o.seller.score))),
      h('button', { class: 'btn btn-outline btn-sm', onclick: () => addToCart({ ...p, stock: o.stock }, 1, false, o.id) }, 'Add to bag')))) : null;
  const specs = Object.entries(p.specs || {});
  const month = (ym) => new Date(`${ym}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: TZ, month: 'long', year: 'numeric' });
  const details = h('table', { class: 'details' },
    [['Brand', p.brand], ['Manufacturer', p.manufacturer], ['Country of origin', p.origin], ...specs,
      best && best.bestBefore ? ['Best before', month(best.bestBefore)] : null].filter(Boolean)
      .map(([k, val]) => h('tr', null, h('th', null, k), h('td', null, val))));

  mount(
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ',
      h('a', { href: `#/s?category=${p.category}` }, p.category_name), ' / ', h('span', null, p.brand)),
    h('div', { class: 'pdp' },
      h('div', { class: 'pdp-gallery' },
        pic(p, 'pdp-img', { role: 'img', 'aria-label': p.title }),
        h('div', { class: 'trust' },
          h('div', null, `${state.config.returnWindowDays || 10}-day returns`),
          h('div', null, 'Free delivery'),
          h('div', null, 'Cash on Delivery'),
          h('div', null, 'Secure payment'))),
      h('div', { class: 'pdp-info' },
        h('a', { class: 'brand', href: `#/s?q=${encodeURIComponent(p.brand)}` }, p.brand),
        h('h1', { class: 'pdp-title' }, p.title),
        h('div', { class: 'pdp-meta' }, ratingChip(p),
          h('a', { href: '#reviews', onclick: (e) => { e.preventDefault(); $('#reviews').scrollIntoView(); } }, 'Read reviews'),
          h('span', { class: 'muted' }, `${p.sold_count.toLocaleString('en-IN')}+ bought this month`)),
        h('div', { class: 'buy-card' },
          p.is_deal ? h('span', { class: 'tag-steal inline-tag' }, 'Deal') : null,
          priceBlock(p, true),
          h('p', { class: 'muted small' }, `Inclusive of GST · or ${inr(Math.ceil(p.price / 12))}/month with no-cost EMI`),
          h('div', { class: 'stock-line' },
            p.stock > 0 ? h('span', { class: p.stock < 10 ? 'low' : 'ok' }, p.stock < 10 ? `Only ${p.stock} left` : 'In stock') : h('span', { class: 'err' }, 'Out of stock'),
            h('span', { class: 'muted' }, p.express ? `Express delivery in ${(state.config.expressCities || []).length} cities` : `Free delivery by ${deliveryDate(false)}`)),
          h('div', { class: 'pin-check' }, pinIn, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: checkPin }, 'Check')),
          pinOut,
          nearBox,
          p.stock > 0 ? h('div', { class: 'buy-actions' },
            h('label', { class: 'qty' }, h('span', { class: 'sr-only' }, 'Quantity'), qtySel),
            h('button', { class: 'btn btn-primary', onclick: () => addToCart(p, Number(qtySel.value)) }, 'Add to bag'),
            h('button', { class: 'btn btn-outline', onclick: () => addToCart(p, Number(qtySel.value), true) }, 'Buy now')) : null,
          best ? h('div', { class: 'sold-by' }, 'Sold by ', sellerLink(best.seller),
            best.assured ? h('span', { class: 'assured-tag' }, 'Bazaario Assured') : null,
            p.authentic ? h('span', { class: 'hint' }, ' · Authentic: only brands and Bazaario sell this category') : null) : null,
          h('div', { class: 'buy-foot' }, wishBtn, best && best.extraDays ? h('span', { class: 'muted small' }, shipsText(best)) : null)),
        otherSellers,
        h('h3', null, 'Offers for you'),
        h('div', { class: 'offers' }, coupons.map(([c, d]) => h('div', { class: 'offer' }, h('b', null, c), h('span', null, d)))),
        h('h3', null, 'Highlights'),
        h('ul', { class: 'features' }, p.features.map((f) => h('li', null, f))),
        h('p', { class: 'muted' }, p.description),
        h('h3', null, 'Product details'), details)),
    h('section', { class: 'reviews', id: 'reviews' },
      h('div', { class: 'review-summary' }, h('h2', null, 'What shoppers say'),
        h('div', { class: 'big-rating' }, h('b', null, p.rating_avg.toFixed(1)), h('span', { class: 'muted' }, 'out of 5'), h('span', { class: 'muted' }, `${p.rating_count.toLocaleString('en-IN')} ratings`)),
        total ? distRows : h('p', { class: 'muted small' }, 'The star breakdown appears once shoppers post written reviews.'), h('hr'), reviewForm()),
      h('div', null, h('h3', null, 'Recent reviews'),
        data.reviews.length ? data.reviews.map((r) => h('div', { class: 'review' },
          h('div', { class: 'who' }, h('span', { class: 'avatar' }, r.author[0].toUpperCase()),
            h('div', null, h('b', null, r.author), h('div', { class: 'muted small' }, fmtDate(r.created_at)))),
          h('div', { class: 'review-title' }, h('span', { class: 'rating' }, `${r.rating} ★`), h('b', null, r.title),
            r.verified ? h('span', { class: 'verified' }, 'Verified buyer') : null),
          h('p', null, r.body))) : h('div', { class: 'empty small-empty' }, h('p', null, 'No reviews yet — be the first to share your thoughts.')))),
    data.related.length ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('div', null, h('h2', null, 'You may also like'), h('p', { class: 'tagline' }, `More from ${p.category_name}`))),
      h('div', { class: 'grid' }, data.related.map((r) => productCard(r)))) : null);
}

/** Seller details a buyer may see (Consumer Protection (E-Commerce) Rules 2020). */
function sellerDetails(s) {
  const modal = $('#modal');
  $('#modal-body').replaceChildren(h('h3', null, s.name),
    h('dl', { class: 'seller-dl' },
      h('dt', null, 'Type'), h('dd', null, LANE_LABEL[s.lane] || 'Seller'),
      h('dt', null, 'Registered name'), h('dd', null, s.legalName),
      h('dt', null, 'Ships from'), h('dd', null, [s.city, s.state].filter(Boolean).join(', ')),
      s.gstin ? [h('dt', null, 'GSTIN'), h('dd', null, s.gstin)] : null,
      h('dt', null, 'On Bazaario since'), h('dd', null, fmtDate(s.since)),
      h('dt', null, 'Performance'), h('dd', null, s.lane === 'direct' ? 'Bazaario\'s own stock' : scoreText(s.score))),
    h('p', { class: 'hint' }, 'Questions about an order from this seller? Our help centre handles them for you.'),
    h('button', { class: 'btn btn-outline', onclick: () => modal.close() }, 'Close'));
  modal.showModal();
}

// ---------- Cart ----------
async function viewCart() {
  let data;
  const pin = store.get('pin', '');
  if (state.user) data = await api('GET', '/cart' + (/^[1-9]\d{5}$/.test(pin) ? `?pin=${pin}` : ''));
  else {
    const items = guestCart();
    const prods = await Promise.all(items.map((i) => api('GET', `/products/${i.productId}`).then((d) => d.product).catch(() => null)));
    const lines = items.map((i, k) => {
      const p = prods[k];
      if (!p) return null;
      const o = (i.offerId && p.offers.find((x) => x.id === i.offerId)) || p.offers[0];
      const shared = i.shareCode && i.sharePrice && !i.offerId;
      return { product_id: i.productId, ...p, qty: Math.min(i.qty, o ? o.stock : p.stock), price: shared ? i.sharePrice : o ? o.price : p.price, stock: o ? o.stock : 0,
        seller_name: o ? o.seller.name : '', reseller_name: shared ? i.resellerName : '', nearby: null };
    }).filter(Boolean);
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    data = { lines, saved: [], subtotal, count: lines.reduce((s, l) => s + l.qty, 0), freeShippingThreshold: state.config.freeShippingThreshold };
  }

  const update = async (fn) => { try { await fn(); await updateCartCount(); route(); } catch (e) { fail(e); } };
  const setQty = (l, qty) => update(async () => {
    if (state.user) await api('PATCH', `/cart/${l.product_id}`, { qty });
    else setGuestCart(guestCart().map((i) => (i.productId === l.product_id ? { ...i, qty } : i)));
  });
  const remove = (l) => update(async () => {
    if (state.user) await api('DELETE', `/cart/${l.product_id}`);
    else setGuestCart(guestCart().filter((i) => i.productId !== l.product_id));
  });
  const saveLater = (l, flag) => update(async () => {
    if (!state.user) { location.hash = '#/login?next=%23%2Fcart'; return; }
    await api('PATCH', `/cart/${l.product_id}`, { savedForLater: flag });
  });

  const line = (l, saved) => h('div', { class: 'line' },
    h('a', { href: `#/p/${l.product_id}`, tabIndex: -1 }, pic(l, 'pimg')),
    h('div', null,
      h('a', { class: 'line-title', href: `#/p/${l.product_id}` }, l.title),
      l.stock > 0 ? h('div', { class: l.stock < 10 ? 'low' : 'ok' }, l.stock < 10 ? `Only ${l.stock} left` : 'In stock') : h('div', { class: 'err' }, 'Out of stock'),
      l.seller_name ? h('div', { class: 'muted small' }, `Sold by ${l.seller_name}`) : null,
      l.reseller_name ? h('div', { class: 'muted small' }, `Shared by ${l.reseller_name}`) : null,
      saved ? null : cartExpress(l, update),
      l.blocked ? h('div', { class: 'err small' }, l.blocked) : null,
      l.note ? h('div', { class: 'low small' }, l.note) : null,
      h('div', { class: 'muted small' }, 'Free delivery on orders above ₹499'),
      h('div', { class: 'line-actions' },
        saved ? null : h('select', { 'aria-label': 'Quantity', onchange: (e) => setQty(l, Number(e.target.value)) },
          Array.from({ length: Math.max(1, Math.min(l.stock, state.config.maxQtyPerItem || 10)) }, (_, i) =>
            h('option', { value: i + 1, selected: i + 1 === l.qty }, `Qty ${i + 1}`))),
        h('button', { class: 'link-btn', onclick: () => saveLater(l, !saved) }, saved ? 'Move to bag' : 'Save for later'),
        h('button', { class: 'link-btn danger', onclick: () => remove(l) }, 'Remove'))),
    h('div', { class: 'line-price' }, priceBlock(l)));

  const remaining = data.freeShippingThreshold - data.subtotal;
  const summary = h('div', { class: 'card' },
    data.lines.length ? (remaining > 0
      ? h('div', { class: 'ship-meter' }, h('p', { class: 'small' }, `You're ${inr(remaining)} away from free delivery`),
        h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, (data.subtotal / data.freeShippingThreshold) * 100)}%` } })))
      : h('div', { class: 'ship-meter done' }, h('p', { class: 'small' }, 'Your order qualifies for free delivery'))) : null,
    h('h3', null, 'Bag summary'),
    h('div', { class: 'sum-row' }, h('span', null, `Items (${data.count})`), h('b', null, inr(data.subtotal))),
    h('button', {
      class: 'btn btn-primary btn-block', disabled: !data.lines.length,
      onclick: () => { location.hash = state.user ? '#/checkout' : '#/login?next=%23%2Fcheckout'; },
    }, 'Checkout'),
    h('p', { class: 'muted small center' }, 'Secure checkout · UPI, cards and Cash on Delivery'));

  mount(h('h1', { class: 'page-title' }, 'Your bag'), h('div', { class: 'two-col' },
    h('div', null,
      h('div', { class: 'card' },
        data.lines.length ? null : h('div', { class: 'empty' }, h('h2', null, 'Your bag is empty'),
          h('p', null, 'Browse our deals to find something you like.'), h('a', { class: 'btn btn-primary', href: '#/s?deals=1' }, 'Browse deals')),
        data.lines.map((l) => line(l, false)),
        state.user ? null : h('div', { class: 'guest-note' }, h('span', null, 'Sign in to keep your bag on every device.'),
          h('a', { class: 'btn btn-outline btn-sm', href: '#/login?next=%23%2Fcart' }, 'Sign in'))),
      data.saved.length ? h('div', { class: 'card', style: { marginTop: '24px' } }, h('h2', null, `Saved for later (${data.saved.length})`),
        data.saved.map((l) => line(l, true))) : null),
    summary));
}

// ---------- Checkout ----------
function addressForm(onSaved, existing) {
  const f = {};
  const field = (name, label, attrs = {}, full) => {
    f[name] = h('input', { name, required: !attrs.optional, value: existing ? (existing[attrs.key || name] || '') : '', ...attrs, optional: undefined, key: undefined });
    return h('div', { class: full ? 'full' : '' }, h('label', null, label), f[name]);
  };
  const stateSel = h('select', { required: true }, h('option', { value: '' }, 'Choose a state'));
  api('GET', '/addresses/states').then((d) => d.states.forEach((s) => stateSel.append(h('option', { value: s, selected: existing && existing.state === s }, s))));
  const def = h('input', { type: 'checkbox', checked: existing ? !!existing.is_default : false });
  const err = h('div', { class: 'alert alert-err hidden' });
  return h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const body = {
        fullName: f.fullName.value, phone: f.phone.value, line1: f.line1.value, line2: f.line2.value,
        city: f.city.value, pincode: f.pincode.value, state: stateSel.value, isDefault: def.checked,
      };
      try {
        if (existing) await api('PUT', `/addresses/${existing.id}`, body);
        else await api('POST', '/addresses', body);
        onSaved();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    },
  }, err,
  h('div', { class: 'form-grid' },
    field('fullName', 'Full name (First and Last name)', { maxLength: 60, autocomplete: 'name', key: 'full_name' }, true),
    field('phone', 'Mobile number', { maxLength: 10, pattern: '[6-9][0-9]{9}', inputMode: 'numeric', autocomplete: 'tel-national', title: '10-digit Indian mobile number' }),
    field('pincode', 'PIN code', { maxLength: 6, pattern: '[1-9][0-9]{5}', inputMode: 'numeric', autocomplete: 'postal-code', title: '6-digit PIN code' }),
    field('line1', 'Flat, House no., Building, Company, Apartment', { maxLength: 120, autocomplete: 'address-line1' }, true),
    field('line2', 'Area, Street, Sector, Village', { maxLength: 120, optional: true, autocomplete: 'address-line2' }, true),
    field('city', 'Town/City', { maxLength: 60, autocomplete: 'address-level2' }),
    h('div', null, h('label', null, 'State'), stateSel)),
  h('label', { class: 'inline' }, def, 'Make this my default address'),
  h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, existing ? 'Save changes' : 'Use this address'));
}

async function viewCheckout() {
  if (!state.user) { location.hash = '#/login?next=%23%2Fcheckout'; return; }
  const [{ addresses }, cart] = await Promise.all([api('GET', '/addresses'), api('GET', '/cart')]);
  if (!cart.lines.length) { location.hash = '#/cart'; return; }

  const sel = { addressId: (addresses.find((a) => a.is_default) || addresses[0] || {}).id, method: 'upi', coupon: '', speed: 'standard', useWallet: false, emiMonths: 6 };
  const idempotencyKey = crypto.randomUUID();
  const summaryBox = h('div', { class: 'card summary' });
  const errBox = h('div', { class: 'alert alert-err hidden' });
  const speedBox = h('div');
  const itemsBox = h('div');
  const walletBox = h('div');
  const payBox = h('div');
  const coversNote = h('p', { class: 'alert alert-ok hidden' }, 'Your wallet balance covers this order. No other payment is needed.');

  // Address step
  const addrList = h('div', null, addresses.map((a) => h('label', { class: 'addr-opt' + (a.id === sel.addressId ? ' sel' : '') },
    h('input', { type: 'radio', name: 'addr', checked: a.id === sel.addressId, onchange: (e) => {
      sel.addressId = a.id;
      addrList.querySelectorAll('.addr-opt').forEach((x) => x.classList.remove('sel'));
      e.target.closest('.addr-opt').classList.add('sel');
      refreshQuote();
    } }),
    h('span', null, h('b', null, a.full_name), ` ${a.line1}, ${a.line2 ? a.line2 + ', ' : ''}${a.city}, ${a.state}, ${a.pincode}, India · Phone: ${a.phone}`))));
  const newAddr = h('div', { class: addresses.length ? 'hidden' : '' }, addressForm(() => route()));

  // Payment step
  const card = { number: h('input', { inputMode: 'numeric', maxLength: 23, autocomplete: 'cc-number', placeholder: '1234 5678 9012 3456' }),
    expiry: h('input', { placeholder: 'MM/YY', maxLength: 5, autocomplete: 'cc-exp' }),
    cvv: h('input', { type: 'password', inputMode: 'numeric', maxLength: 4, autocomplete: 'cc-csc', placeholder: 'CVV' }) };
  const upi = h('input', { placeholder: 'yourname@bank', maxLength: 100 });
  const emiSel = h('select', { 'aria-label': 'EMI plan', onchange: () => { sel.emiMonths = Number(emiSel.value); } });
  const cardFields = h('div', { class: 'pay-fields' }, h('label', null, 'Card number'), card.number,
    h('div', { class: 'form-grid' }, h('div', null, h('label', null, 'Expiry'), card.expiry), h('div', null, h('label', null, 'CVV'), card.cvv)),
    h('p', { class: 'hint' }, 'Only the last 4 digits of your card are kept.'));
  const payFields = {
    upi: h('div', { class: 'pay-fields' }, h('label', null, 'UPI ID'), upi, h('p', { class: 'hint' }, 'You will receive a payment request on your UPI app.')),
    card: h('div'),
    emi: h('div', { class: 'pay-fields' }, h('label', null, 'Choose a plan'), emiSel,
      h('p', { class: 'hint' }, 'No-cost EMI: you pay the order price in equal monthly parts, with no interest. Pay with a credit card.')),
    cod: h('div', { class: 'pay-fields' }, h('p', { class: 'hint' }, 'Pay with cash or UPI when your order is delivered.')),
  };
  const payReason = {};
  const radios = {};
  const showFields = () => {
    Object.entries(payFields).forEach(([k, el]) => el.classList.toggle('hidden', k !== sel.method));
    if (sel.method === 'card' || sel.method === 'emi') payFields[sel.method].append(cardFields); else cardFields.remove();
  };
  const payOpt = (m, label) => {
    radios[m] = h('input', { type: 'radio', name: 'pay', value: m, checked: sel.method === m, onchange: () => { sel.method = m; showFields(); refreshQuote(); } });
    payReason[m] = h('span', { class: 'hint muted' });
    return h('div', null, h('label', { class: 'inline' }, radios[m], h('b', null, label), ' ', payReason[m]), payFields[m]);
  };
  payBox.append(
    state.config.testMode && state.config.testMode.payments
      ? h('p', { class: 'alert alert-test' }, 'Test mode: payments are simulated and no money is charged. Test card: 4111 1111 1111 1111.') : null,
    payOpt('upi', 'UPI (Google Pay, PhonePe, Paytm and more)'), payOpt('card', 'Credit or debit card'),
    payOpt('emi', 'No-cost EMI on credit card'), payOpt('cod', 'Cash on Delivery'));
  showFields();

  const paintSpeeds = (q) => {
    if (!sel.addressId) { speedBox.replaceChildren(h('p', { class: 'muted' }, 'Add a delivery address to see delivery options.')); return; }
    const fee = (o) => (o.speed === 'express' ? inr(o.fee) : q.shipping ? inr(q.shipping) : 'Free');
    fill(speedBox,
      q.speeds.map((o) => h('label', { class: 'addr-opt' + (o.speed === q.speed ? ' sel' : '') },
        h('input', { type: 'radio', name: 'speed', checked: o.speed === q.speed, onchange: () => { sel.speed = o.speed; refreshQuote(); } }),
        h('span', null, h('b', null, o.speed === 'express' ? 'Express' : 'Standard'), ` · ${cap(promiseText(o))} · ${fee(o)}`,
          o.speed === 'express' ? h('div', { class: 'hint' }, q.shopPackages ? 'From a partner shop or Bazaario city store near you.' : 'From a Bazaario city store near you.') : null))),
      q.shopPackages ? h('p', { class: 'hint' }, q.shopPackages === q.packages.length
        ? 'Items from partner shops near you always come by Express.'
        : 'Items from partner shops near you always come by Express. Your choice here is for the other packages.') : null,
      q.speeds.some((o) => o.speed === 'express') || q.shopPackages ? null
        : h('p', { class: 'hint' }, `Express delivery in under 90 minutes is available in ${(state.config.expressCities || []).join(', ')} for items marked Express.`));
  };

  const paintWallet = (q) => {
    if (!q.walletBalance) { walletBox.replaceChildren(); return; }
    walletBox.replaceChildren(h('label', { class: 'addr-opt' + (sel.useWallet ? ' sel' : '') },
      h('input', { type: 'checkbox', checked: sel.useWallet, onchange: (e) => { sel.useWallet = e.target.checked; refreshQuote(); } }),
      h('span', null, h('b', null, 'Use Bazaario wallet'), ` · Balance ${inr(q.walletBalance)}`)));
  };

  const paintPay = (q) => {
    const covered = q.payable === 0;
    coversNote.classList.toggle('hidden', !covered);
    payBox.classList.toggle('hidden', covered);
    const block = (m, ok, why) => { radios[m].disabled = !ok; payReason[m].textContent = ok ? '' : why; };
    block('cod', q.cod.ok, q.cod.reason);
    block('emi', q.emi.ok, `Available on orders of ${inr(q.emi.minOrder)} and above.`);
    emiSel.replaceChildren(...q.emi.months.map((m) => h('option', { value: m, selected: m === sel.emiMonths }, `${m} months · ${inr(Math.ceil(q.payable / m))} a month`)));
    if (radios[sel.method].disabled) { sel.method = 'upi'; radios.upi.checked = true; showFields(); }
  };

  const refreshQuote = async () => {
    try {
      const q = await api('POST', '/checkout/quote', { addressId: sel.addressId, speed: sel.speed, useWallet: sel.useWallet, coupon: sel.coupon || undefined, paymentMethod: sel.method });
      sel.speed = q.speed;
      paintSpeeds(q); paintWallet(q); paintPay(q); paintItems(q);
      fill(summaryBox,
        placeBtn,
        h('p', { class: 'muted small center' }, 'By placing your order you agree to Bazaario\'s ', h('a', { href: '#/page/terms' }, 'terms'), ' and ', h('a', { href: '#/page/privacy' }, 'privacy notice'), '.'),
        h('hr'), h('h3', null, 'Order summary'),
        h('dl', null,
          h('dt', null, 'Items:'), h('dd', null, inr(q.subtotal)),
          h('dt', null, 'Delivery:'), h('dd', null, q.shipping ? inr(q.shipping) : 'Free'),
          q.expressFee ? [h('dt', null, 'Express delivery:'), h('dd', null, inr(q.expressFee))] : null,
          q.discount ? [h('dt', null, `Coupon (${q.coupon}):`), h('dd', { class: 'ok' }, '-' + inr(q.discount))] : null,
          q.walletApplied ? [h('dt', null, 'Order total:'), h('dd', null, inr(q.total)), h('dt', null, 'From wallet:'), h('dd', { class: 'ok' }, '-' + inr(q.walletApplied))] : null,
          h('dt', { class: 'total' }, 'To pay'), h('dd', { class: 'total' }, inr(q.payable))),
        q.promisedAt && q.packages.length === 1 ? h('p', { class: 'ok small' }, `Arrives ${promiseText({ speed: q.packages[0].speed || q.speed, promisedAt: q.packages[0].promisedAt || q.promisedAt })}`) : null,
        q.savings > 0 ? h('p', { class: 'savings' }, `You save ${inr(q.savings)} on this order`) : null);
      return true;
    } catch (e) {
      if (sel.coupon) { sel.coupon = ''; couponIn.value = ''; fail(e); return refreshQuote(); }
      fail(e); return false;
    }
  };

  const couponIn = h('input', { placeholder: 'Enter coupon code', maxLength: 20, style: { width: '200px' } });

  // Items from different sellers arrive as separate packages, each with its own date.
  const paintItems = (q) => {
    const byId = new Map(q.lines.map((l) => [l.product_id, l]));
    fill(itemsBox,
      q.blocked.length ? h('div', { class: 'alert alert-err' }, q.blocked.map((b) => h('div', null, b)), h('div', { class: 'small' }, 'Open the product to pick another seller, or change the address.')) : null,
      q.packages.map((pk, i) => h('div', { class: 'package' },
        q.packages.length > 1 || pk.lane !== 'direct' ? h('div', { class: 'package-head' },
          h('b', null, q.packages.length > 1 ? `Package ${i + 1} of ${q.packages.length}` : 'Your package'),
          h('span', { class: 'muted' }, `Sold by ${pk.sellerName}`),
          pk.speed === 'express' ? h('span', { class: 'speed-tag' }, 'Express') : null,
          pk.promisedAt ? h('span', { class: 'ok' }, `Arrives ${promiseText({ speed: pk.speed || q.speed, promisedAt: pk.promisedAt })}`) : null) : null,
        pk.lines.map((id) => byId.get(id)).map((l) => h('div', { class: 'order-item' }, pic(l, 'pimg'),
          h('div', null, h('b', null, l.title), h('div', { class: 'now-sm' }, inr(l.price)), h('div', { class: 'muted small' }, `Qty ${l.qty}`),
            l.express ? h('div', { class: 'hint' }, 'Express item') : null, l.blocked ? h('div', { class: 'err small' }, l.blocked) : null))))));
  };

  const placeBtn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
    errBox.classList.add('hidden');
    if (!sel.addressId) { errBox.textContent = 'Please add a delivery address.'; errBox.classList.remove('hidden'); return; }
    const cardData = { cardNumber: card.number.value, expiry: card.expiry.value, cvv: card.cvv.value };
    const payment = sel.method === 'card' ? cardData : sel.method === 'emi' ? { ...cardData, emiMonths: sel.emiMonths }
      : sel.method === 'upi' ? { upiId: upi.value } : {};
    placeBtn.disabled = true;
    placeBtn.textContent = 'Placing your order…';
    try {
      const r = await api('POST', '/orders', { addressId: sel.addressId, speed: sel.speed, useWallet: sel.useWallet, paymentMethod: sel.method, coupon: sel.coupon || undefined, payment, idempotencyKey });
      card.number.value = ''; card.cvv.value = '';
      await updateCartCount();
      location.hash = r.orders && r.orders.length > 1 ? `#/orders?placed=${r.checkoutRef}` : `#/orders/${r.orderId}?placed=1`;
    } catch (e) {
      errBox.textContent = e.message; errBox.classList.remove('hidden');
      placeBtn.disabled = false; placeBtn.textContent = 'Place your order';
      window.scrollTo(0, 0);
      refreshQuote();
    }
  } }, 'Place your order');

  const stepper = h('ol', { class: 'stepper', 'aria-label': 'Checkout progress' },
    ['Bag', 'Delivery & payment', 'Order placed'].map((t, i) => h('li', { class: i === 0 ? 'done' : i === 1 ? 'current' : '' }, h('span', null, i + 1), t)));
  mount(stepper, h('h1', { class: 'page-title' }, 'Checkout'), errBox,
    h('div', { class: 'two-col' },
      h('div', null,
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '1'), 'Where should we deliver?'),
          addrList,
          addresses.length ? h('button', { class: 'link-btn', onclick: () => newAddr.classList.toggle('hidden') }, '+ Add a new address') : null,
          newAddr),
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '2'), 'When should it arrive?'), speedBox),
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '3'), 'How would you like to pay?'),
          walletBox, coversNote, payBox,
          h('hr'), h('label', null, 'Apply a coupon'),
          h('div', { style: { display: 'flex', gap: '8px' } }, couponIn, h('button', { class: 'btn', onclick: async () => {
            sel.coupon = couponIn.value.trim();
            if (await refreshQuote() && sel.coupon) toast(`Coupon ${sel.coupon.toUpperCase()} applied.`);
          } }, 'Apply')),
          h('p', { class: 'hint' }, 'Try WELCOME10, SAVE100 or FESTIVE15')),
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '4'), 'Your items'), itemsBox)),
      summaryBox));
  await refreshQuote();
}

// ---------- Orders ----------
/** Where an order is in its journey, in one line. */
function orderLine(o) {
  if (o.status === 'placed' && (o.on_hold || o.hold_reason)) return 'We are checking a few details before sending your order.';
  if (o.status === 'delivered') return o.delivered_at ? `Delivered on ${fmtDate(o.delivered_at)}` : 'Delivered';
  if (['confirmed', 'placed', 'packed', 'shipped', 'out_for_delivery'].includes(o.status) && o.promised_at) {
    return `Arriving ${promiseText({ speed: o.delivery_speed, promisedAt: o.promised_at })}`;
  }
  if (o.status === 'delivery_failed') return 'We missed you. Choose a new delivery time.';
  return '';
}

function orderCard(o) {
  return h('div', { class: 'order' },
    h('div', { class: 'order-head' },
      h('div', null, 'ORDER PLACED', h('b', null, fmtDate(o.created_at))),
      h('div', null, 'TOTAL', h('b', null, inr(o.total))),
      h('div', null, 'PAYMENT', h('b', null, `${PAY_LABEL[o.payment_method] || o.payment_method} · ${o.payment_status}`)),
      h('div', { class: 'right' }, `ORDER ${o.order_no}`, h('b', null, h('a', { href: `#/orders/${o.id}` }, 'Track and manage')))),
    h('div', { class: 'order-body' },
      h('div', null, h('span', { class: `status ${o.status}` }, STATUS_LABEL[o.status]),
        o.delivery_speed === 'express' ? h('span', { class: 'speed-tag' }, 'Express') : null,
        o.seller_name ? h('span', { class: 'muted small' }, ` · Sold by ${o.seller_name}`) : null),
      orderLine(o) ? h('div', { class: o.status === 'delivery_failed' ? 'low' : 'ok' }, orderLine(o)) : null,
      o.items.map((it) => h('div', { class: 'order-item' },
        h('a', { href: `#/p/${it.product_id}` }, pic(it, 'pimg')),
        h('div', null, h('a', { href: `#/p/${it.product_id}` }, it.title), h('div', { class: 'hint' }, `Qty ${it.qty} · ${inr(it.price)}`),
          h('button', { class: 'btn btn-sm btn-outline', onclick: async () => addToCart({ id: it.product_id, title: it.title, stock: 10 }) }, 'Buy again'))))));
}

async function viewOrders(params) {
  if (!state.user) { location.hash = '#/login?next=%23%2Forders'; return; }
  const ref = new URLSearchParams(params).get('placed');
  const { orders } = await api('GET', '/orders' + (ref ? `?ref=${encodeURIComponent(ref)}` : ''));
  mount(ref && orders.length ? h('div', { class: 'alert alert-ok' }, h('b', null, 'Thank you. Your order is placed.'),
      ` It comes from ${orders.length} sellers, so it will arrive in ${orders.length} packages, each with its own tracking. We have sent the details to ${state.user.email}.`) : null,
    ref ? h('p', null, h('a', { href: '#/orders' }, 'All orders')) : null,
    h('h1', { class: 'page-title' }, ref ? 'Your new order' : 'Your orders'),
    orders.length ? orders.map(orderCard) : h('div', { class: 'card empty' }, h('h2', null, 'No orders yet'), h('p', null, 'When you place an order, you can track it here.'), h('a', { class: 'btn btn-primary', href: '#/' }, 'Start shopping')));
}

/** Newest updates first; long histories show the latest four with the rest folded away. */
function timeline(events) {
  const item = (e) => h('li', null, h('span', { class: 'hint muted' }, fmtWhen(e.created_at)),
    h('b', null, STATUS_LABEL[e.status] || e.status), e.note ? h('span', { class: 'hint' }, e.note) : null);
  const list = events.slice().reverse();
  return [h('ol', { class: 'timeline' }, list.slice(0, 4).map(item)),
    list.length > 4 ? h('details', { class: 'timeline-more' }, h('summary', null, `Show full history (${list.length - 4} earlier updates)`),
      h('ol', { class: 'timeline' }, list.slice(4).map(item))) : null];
}

const RETURN_STATUS = {
  requested: 'Return requested. We will confirm the pickup shortly.',
  pickup_scheduled: 'Return approved. Our delivery partner will pick it up within 2 working days. Please keep the item packed with its tags.',
  refunded: 'Return complete and refunded.',
  rejected: 'We could not accept this return.',
};

async function viewOrder(id, params) {
  if (!state.user) { location.hash = '#/login'; return; }
  const { order: o } = await api('GET', `/orders/${encodeURIComponent(id)}`);
  const express = o.delivery_speed === 'express';
  const steps = express ? ['confirmed', 'packed', 'shipped', 'delivered'] : ['confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
  const stepLabel = (s) => (express && s === 'shipped' ? 'Picked up' : express && s === 'packed' ? 'Packed, rider coming' : STATUS_LABEL[s]);
  const at = { placed: 0, delivery_failed: steps.indexOf('out_for_delivery'), return_requested: steps.length - 1, returned: steps.length - 1 };
  const reached = o.status in at ? at[o.status] : steps.indexOf(o.status);
  const done = async (path, body, msg) => {
    try { await api('POST', `/orders/${o.id}/${path}`, body); toast(msg); route(); } catch (e) { fail(e); }
  };

  // Failed delivery: the buyer picks a new time (NDR).
  const ndr = () => {
    const when = h('select', null, h('option', { value: 'tomorrow' }, 'Tomorrow'), h('option', { value: 'evening' }, 'Tomorrow evening (after 5 pm)'), h('option', { value: 'weekend' }, 'This weekend'));
    const note = h('input', { maxLength: 200, placeholder: 'For example: call before coming, leave with the guard' });
    const asked = o.events.filter((e) => e.status === 'reattempt_requested').at(-1);
    return h('div', { class: 'card ndr' }, h('h3', null, 'We could not deliver your order'),
      h('p', null, 'Tell us when to come back. Our delivery partner will try again at that time.'),
      asked ? h('p', { class: 'ok small' }, `Requested: ${asked.note}`) : null,
      h('div', { class: 'form-grid' }, h('div', null, h('label', null, 'When should we try again?'), when), h('div', null, h('label', null, 'Note for the delivery partner (optional)'), note)),
      h('button', { class: 'btn btn-primary', style: { marginTop: '10px' }, onclick: () => done('reattempt', { when: when.value, note: note.value }, 'Thanks. We will try again at the time you chose.') }, 'Request another attempt'),
      h('p', { class: 'hint' }, 'After three failed attempts the order comes back to us and any payment is refunded.'));
  };

  // Return request form.
  const windowOpen = o.status === 'delivered' && o.delivered_at && Date.now() - o.delivered_at < (state.config.returnWindowDays || 10) * 86400000;
  const returnBox = h('div', { class: 'card hidden' });
  const openReturn = async () => {
    const { reasons } = await api('GET', '/returns/reasons');
    const reason = h('select', { required: true }, h('option', { value: '' }, 'Choose a reason'), reasons.map((r) => h('option', { value: r }, r)));
    const comment = h('textarea', { rows: 3, maxLength: 1000, placeholder: 'Anything that helps us, for example what is damaged' });
    const cashLike = o.payment_method === 'cod' || o.payment_method === 'wallet';
    let refundTo = 'wallet';
    const refundOpt = (val, label, hint) => h('label', { class: 'inline' },
      h('input', { type: 'radio', name: 'refund', value: val, checked: val === refundTo, onchange: () => { refundTo = val; } }), h('b', null, label), ' ', h('span', { class: 'hint muted' }, hint));
    returnBox.replaceChildren(h('h3', null, 'Return items'),
      h('form', { onsubmit: (e) => { e.preventDefault(); done('return', { reason: reason.value, comment: comment.value, refundTo }, 'Return requested.'); } },
        h('label', null, 'Why are you returning this?'), reason, h('label', null, 'Details (optional)'), comment,
        h('label', null, 'Where should the refund go?'),
        cashLike ? h('p', { class: 'hint' }, 'Orders paid in cash or from the wallet are refunded to your Bazaario wallet, as soon as we receive the item.')
          : [refundOpt('wallet', 'Bazaario wallet', 'instant, once we receive the item'), refundOpt('source', 'Original payment method', '5-7 working days')],
        h('p', { class: 'hint' }, 'We pick the item up from your delivery address. Please pack it with its tags and accessories.'),
        h('button', { class: 'btn btn-outline' }, 'Request return')));
    returnBox.classList.remove('hidden');
    returnBox.scrollIntoView();
  };

  mount(
    new URLSearchParams(params).get('placed') ? h('div', { class: 'alert alert-ok' }, h('b', null, 'Thank you. Your order is confirmed.'),
      ` We have sent the details to ${state.user.email}. Order # ${o.order_no}`) : null,
    h('p', null, h('a', { href: '#/orders' }, 'All orders')),
    h('h1', { class: 'page-title' }, 'Order details'),
    h('p', { class: 'muted' }, `Ordered on ${fmtDate(o.created_at)} | Order# ${o.order_no}`,
      o.seller ? [' | Sold by ', h('button', { type: 'button', class: 'link-btn', onclick: () => sellerDetails(o.seller) }, o.seller.name)] : null,
      o.packages > 1 ? h('span', null, ` | Part of a ${o.packages}-package order (`, h('a', { href: `#/orders?placed=${o.checkout_ref}` }, 'see all'), ')') : null),
    o.status === 'placed' && !o.hold_reason && o.seller && o.seller.lane !== 'direct' ? h('p', { class: 'hint' }, `${o.seller.name} will confirm your order shortly. If they cannot, we move it to another seller at no extra cost.`) : null,
    h('div', { class: 'card' },
      h('div', null, h('span', { class: `status ${o.status}` }, STATUS_LABEL[o.status]), express ? h('span', { class: 'speed-tag' }, 'Express') : null),
      orderLine(o) ? h('div', { class: o.status === 'delivery_failed' ? 'low' : 'ok' }, orderLine(o)) : null,
      o.awb ? h('p', { class: 'hint' }, `${o.courier} · Tracking number ${o.awb}`) : null,
      reached >= 0 && !['cancelled', 'rto'].includes(o.status) ? h('div', { class: 'tracker' }, steps.map((s, i) => h('div', { class: i <= reached ? 'done' : '' }, stepLabel(s)))) : null,
      timeline(o.events)),
    o.rider ? liveTracking(o) : null,
    o.status === 'delivery_failed' ? ndr() : null,
    o.return ? h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Your return'),
      h('p', { class: o.return.status === 'rejected' ? 'low' : 'ok' }, RETURN_STATUS[o.return.status]),
      h('p', { class: 'hint' }, `Reason: ${o.return.reason}${o.return.note ? ' · ' + o.return.note : ''}`),
      h('p', { class: 'hint' }, `Refund to: ${o.return.refund_to === 'wallet' ? 'Bazaario wallet' : 'original payment method'}`)) : null,
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'form-grid' },
        h('div', null, h('h3', null, 'Delivering to'), h('div', null, o.address.fullName), h('div', null, o.address.line1),
          o.address.line2 ? h('div', null, o.address.line2) : null, h('div', null, `${o.address.city}, ${o.address.state} ${o.address.pincode}`), h('div', null, `Phone: ${o.address.phone}`)),
        h('div', { class: 'summary' }, h('h3', null, 'Payment summary'),
          h('dl', null,
            h('dt', null, 'Item(s) Subtotal:'), h('dd', null, inr(o.subtotal)),
            h('dt', null, 'Delivery:'), h('dd', null, o.shipping ? inr(o.shipping) : 'Free'),
            o.discount ? [h('dt', null, `Promotion (${o.coupon_code}):`), h('dd', null, '-' + inr(o.discount))] : null,
            o.wallet_used ? [h('dt', null, 'Paid from wallet:'), h('dd', null, inr(o.wallet_used))] : null,
            h('dt', { class: 'total' }, 'Order total'), h('dd', { class: 'total' }, inr(o.total))),
          h('p', { class: 'hint' }, `Payment: ${PAY_LABEL[o.payment_method] || o.payment_method}${o.emi_months ? ` (${o.emi_months} months)` : ''} · ${o.payment_status}${o.payment_ref ? ' · Ref ' + o.payment_ref : ''}`)))),
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('h3', null, 'Items'),
      o.items.map((it) => h('div', { class: 'order-item' }, pic(it, 'pimg'),
        h('div', null, h('a', { href: `#/p/${it.product_id}` }, it.title), h('div', { class: 'muted small' }, `Qty ${it.qty} · `, h('b', { class: 'now-sm' }, inr(it.price))),
          o.status === 'delivered' ? h('a', { class: 'btn btn-sm btn-outline', href: `#/p/${it.product_id}#reviews` }, 'Review this item') : null))),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        ['placed', 'confirmed', 'packed'].includes(o.status) ? h('button', { class: 'btn btn-outline', onclick: async () => {
          if (await askConfirm('Cancel this order?', 'Yes, cancel it')) done('cancel', undefined, 'Order cancelled.');
        } }, 'Cancel order') : null,
        windowOpen && !o.return ? h('button', { class: 'btn btn-outline', onclick: openReturn }, 'Return items') : null,
        ['shipped', 'out_for_delivery', 'delivery_failed', 'delivered', 'return_requested', 'returned'].includes(o.status)
          ? h('a', { class: 'btn btn-outline', href: `#/doc/invoice/${o.id}` }, 'Invoice') : null,
        h('a', { href: `#/help?order=${o.id}` }, 'Need help with this order?'))),
    returnBox);
}

// ---------- Wallet ----------
async function viewWallet() {
  if (!state.user) { location.hash = '#/login?next=%23%2Fwallet'; return; }
  const w = await api('GET', '/wallet');
  mount(h('h1', { class: 'page-title' }, 'Bazaario wallet'),
    h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Balance'), h('b', null, inr(w.balance)))),
    h('p', { class: 'muted' }, 'Refunds you choose to take in the wallet arrive here instantly. Use the balance at checkout.'),
    w.entries.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Date', 'Details', 'Amount'].map((t) => h('th', null, t))),
      w.entries.map((e) => h('tr', null, h('td', null, fmtDate(e.created_at)), h('td', null, e.reason),
        h('td', { class: e.amount > 0 ? 'ok' : '' }, (e.amount > 0 ? '+' : '-') + inr(Math.abs(e.amount)))))))
      : h('div', { class: 'card empty' }, h('p', null, 'No wallet activity yet.')));
}

// ---------- Wishlist ----------
async function viewWishlist() {
  if (!state.user) { location.hash = '#/login?next=%23%2Fwishlist'; return; }
  const { items } = await api('GET', '/wishlist');
  mount(h('h1', { class: 'page-title' }, 'Your wishlist'),
    items.length ? h('div', { class: 'grid' }, items.map((p) => {
      const c = productCard(p);
      c.querySelector('.pbody').append(h('button', { class: 'link-btn danger', onclick: async () => { try { await api('DELETE', `/wishlist/${p.id}`); state.wish.delete(p.id); toast('Removed from your wishlist'); } catch (e) { fail(e); } route(); } }, 'Remove from wishlist'));
      return c;
    })) : h('div', { class: 'card empty' }, h('h2', null, 'Nothing saved yet'), h('p', null, 'Tap the heart on any product to keep it here.'), h('a', { class: 'btn btn-primary', href: '#/' }, 'Explore the bazaar')));
}

// ---------- Auth ----------
async function viewLogin(params) {
  if (state.user) { location.hash = '#/'; return; }
  try { if ((await api('GET', '/auth/setup')).needed) return viewSetup(); } catch { /* fall through to normal sign in */ }
  const qp = new URLSearchParams(params);
  const next = qp.get('next');
  const safeNext = next && next.startsWith('#/') ? next : '#/';
  const useOtp = qp.get('with') === 'otp' && state.config.otpSignIn;
  const err = h('div', { class: 'alert alert-err hidden', role: 'alert' });
  const showErr = (m) => { err.textContent = m; err.classList.remove('hidden'); };
  const switchTo = (mode) => {
    const n = new URLSearchParams(qp);
    if (mode === 'otp') n.set('with', 'otp'); else n.delete('with');
    location.hash = '#/login' + (n.toString() ? '?' + n.toString() : '');
  };

  let form;
  if (useOtp) {
    // Mobile number first, then the 6-digit code we send by SMS.
    const phone = h('input', { required: true, maxLength: 10, inputMode: 'numeric', pattern: '[6-9][0-9]{9}', autocomplete: 'tel-national', placeholder: '10-digit mobile number' });
    const code = h('input', { maxLength: 6, inputMode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code' });
    const codeRow = h('div', { class: 'hidden' }, h('label', null, 'Code'), code, h('p', { class: 'hint' }));
    const btn = h('button', { class: 'btn btn-primary btn-block' }, 'Send code');
    let sent = false;
    form = h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden'); btn.disabled = true;
      try {
        if (!sent) {
          const r = await api('POST', '/auth/otp/request', { phone: phone.value });
          sent = true;
          phone.readOnly = true;
          codeRow.classList.remove('hidden');
          codeRow.querySelector('.hint').textContent = r.testCode ? `Test mode: no SMS is sent. Your code is ${r.testCode}.` : r.message;
          btn.textContent = 'Sign in';
          code.required = true;
          code.focus();
        } else {
          await afterLogin(await api('POST', '/auth/otp/verify', { phone: phone.value, code: code.value }), safeNext);
        }
      } catch (ex) { showErr(ex.message); code.value = ''; }
      btn.disabled = false;
    } }, h('label', null, 'Mobile number'), phone, codeRow, btn,
    h('p', { class: 'hint' }, 'Works for accounts with a mobile number. Add one under Profile and security.'));
  } else {
    const email = h('input', { type: 'email', required: true, autocomplete: 'username', maxLength: 254 });
    const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', maxLength: 128 });
    const btn = h('button', { class: 'btn btn-primary btn-block' }, 'Sign in');
    form = h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hidden'); btn.disabled = true;
      try { await afterLogin(await api('POST', '/auth/login', { email: email.value, password: pw.value }), safeNext); }
      catch (ex) { showErr(ex.message); btn.disabled = false; pw.value = ''; }
    } }, h('label', null, 'Email'), email, h('label', null, 'Password'), pw, btn);
  }
  mount(h('div', { class: 'auth' },
    h('div', { class: 'auth-side' }, h('h2', null, 'Welcome back'),
      h('p', null, 'Track orders, keep your wishlist and check out faster.')),
    h('div', { class: 'card' }, h('h1', null, 'Sign in'),
      state.config.otpSignIn ? h('div', { class: 'tabs' },
        h('button', { type: 'button', class: useOtp ? '' : 'on', onclick: () => switchTo('email') }, 'Email'),
        h('button', { type: 'button', class: useOtp ? 'on' : '', onclick: () => switchTo('otp') }, 'Mobile OTP')) : null,
      err, form,
      h('p', { class: 'muted small' }, 'By continuing you agree to Bazaario\'s ', h('a', { href: '#/page/terms' }, 'terms'), ' and ', h('a', { href: '#/page/privacy' }, 'privacy notice'), '.'),
      h('div', { class: 'divider' }, h('span', null, 'New to Bazaario?')),
      h('a', { class: 'btn btn-outline btn-block', href: '#/register' + (next ? '?next=' + encodeURIComponent(next) : '') }, 'Create an account'))));
}

// First visit after install: the store has no owner yet, so Sign in becomes "set up your store".
function viewSetup() {
  const name = h('input', { required: true, maxLength: 60, autocomplete: 'name', placeholder: 'First and last name' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', maxLength: 254 });
  const pw = h('input', { type: 'password', required: true, minLength: 8, maxLength: 128, autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const pw2 = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
  const err = h('div', { class: 'alert alert-err hidden', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '16px' } }, 'Create owner account');
  mount(h('div', { class: 'auth' },
    h('div', { class: 'auth-side' }, h('h2', null, 'Welcome to your new store'),
      h('p', null, 'Create the owner account to run Bazaario Studio: products, photos, prices, stock and orders. You only do this once.')),
    h('div', { class: 'card' }, h('h1', null, 'Set up your store'), err,
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); err.classList.add('hidden');
        if (pw.value !== pw2.value) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
        btn.disabled = true;
        try {
          await afterLogin(await api('POST', '/auth/setup', { name: name.value, email: email.value, password: pw.value }), '#/admin');
          toast('Your store is ready. Welcome to Bazaario Studio!');
        } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; }
      } },
      h('label', null, 'Your name'), name, h('label', null, 'Email'), email,
      h('label', null, 'Password'), pw, h('div', { class: 'muted small' }, 'At least 8 characters, with letters and numbers.'),
      h('label', null, 'Re-enter password'), pw2, btn))));
}

function viewRegister(params) {
  if (state.user) { location.hash = '#/'; return; }
  const next = new URLSearchParams(params).get('next');
  const name = h('input', { required: true, maxLength: 60, autocomplete: 'name', placeholder: 'First and last name' });
  const phone = h('input', { maxLength: 10, inputMode: 'numeric', pattern: '[6-9][0-9]{9}', autocomplete: 'tel-national', placeholder: 'Optional', title: '10-digit Indian mobile number' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', maxLength: 254 });
  const pw = h('input', { type: 'password', required: true, minLength: 8, maxLength: 128, autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const pw2 = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
  const err = h('div', { class: 'alert alert-err hidden', role: 'alert' });
  mount(h('div', { class: 'auth' },
    h('div', { class: 'auth-side' }, h('h2', null, 'Create your account'),
      h('p', null, 'Get 10% off your first order with WELCOME10, plus wishlists and order tracking.')),
    h('div', { class: 'card' }, h('h1', null, 'Create account'), err,
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); err.classList.add('hidden');
        if (pw.value !== pw2.value) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
        try {
          await afterLogin(await api('POST', '/auth/register', { name: name.value, phone: phone.value, email: email.value, password: pw.value }),
            next && next.startsWith('#/') ? next : '#/');
          toast('Welcome to Bazaario! Use code WELCOME10 on your first order.');
        } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      } },
      h('label', null, 'Your name'), name, h('label', null, 'Mobile number'), phone, h('label', null, 'Email'), email,
      h('label', null, 'Password'), pw, h('div', { class: 'muted small' }, 'At least 8 characters, with letters and numbers.'),
      h('label', null, 'Re-enter password'), pw2,
      h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '16px' } }, 'Create account')),
      h('p', { class: 'muted small' }, 'Already have an account? ', h('a', { href: '#/login' }, 'Sign in')))));
}

// ---------- Account ----------
async function viewAccount() {
  if (!state.user) { location.hash = '#/login?next=%23%2Faccount'; return; }
  const tile = (href, title, desc) => h('a', { class: 'acc-tile', href }, h('div', null, h('h3', null, title), h('div', { class: 'muted small' }, desc)));
  mount(h('h1', { class: 'page-title' }, 'My account'),
    h('p', { class: 'tagline' }, `Signed in as ${state.user.email}`),
    h('div', { class: 'acc-grid' },
      tile('#/orders', 'Orders', 'Track, return or buy again'),
      tile('#/security', 'Profile & security', 'Name, mobile number and password'),
      tile('#/addresses', 'Addresses', 'Manage delivery addresses'),
      tile('#/wishlist', 'Wishlist', 'Things you have saved'),
      tile('#/wallet', 'Wallet', 'Refunds and balance'),
      tile('#/help', 'Help centre', 'Questions and your requests'),
      tile('#/s?deals=1', 'Deals', 'Limited-time offers'),
      tile('#/seller', 'Seller Hub', 'Sell on Bazaario: listings, orders and payouts'),
      tile('#/shop', 'Shop Partner', 'Your neighbourhood shop on Bazaario Express'),
      tile('#/resell', 'Resell and earn', 'Share products on WhatsApp with your own margin'),
      state.user.role === 'admin' ? tile('#/admin', 'Bazaario Studio', 'Products, orders, customers, coupons') : null),
    h('p', null, h('button', { class: 'btn btn-outline', onclick: logout }, 'Sign out')));
}

async function viewSecurity() {
  if (!state.user) { location.hash = '#/login'; return; }
  const name = h('input', { value: state.user.name, maxLength: 60, required: true });
  const phone = h('input', { value: state.user.phone || '', maxLength: 10, pattern: '[6-9][0-9]{9}', inputMode: 'numeric' });
  const cur = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const np = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password' });
  mount(h('h1', { class: 'page-title' }, 'Profile & security'),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' },
        h('form', { onsubmit: async (e) => {
          e.preventDefault();
          try { state.user = (await api('PATCH', '/auth/profile', { name: name.value, phone: phone.value })).user; renderHeader(); toast('Profile updated.'); } catch (ex) { fail(ex); }
        } }, h('h3', null, 'Profile'), h('label', null, 'Name'), name, h('label', null, 'Email'), h('input', { value: state.user.email, disabled: true }),
          h('label', null, 'Mobile number'), phone, h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Save')),
        h('hr'),
        h('form', { onsubmit: async (e) => {
          e.preventDefault();
          try { const r = await api('POST', '/auth/change-password', { currentPassword: cur.value, newPassword: np.value }); state.csrf = r.csrfToken; cur.value = np.value = ''; toast('Password changed. Other devices were signed out.'); } catch (ex) { fail(ex); }
        } }, h('h3', null, 'Change password'), h('label', null, 'Current password'), cur, h('label', null, 'New password'), np,
          h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Change password'))),
      h('div', { class: 'card' }, h('h3', null, 'Account security'),
        h('ul', { class: 'hint' }, h('li', null, 'Passwords are hashed with scrypt and never stored in plain text.'),
          h('li', null, 'Accounts lock for 15 minutes after 5 failed sign-in attempts.'),
          h('li', null, 'Changing your password signs out every other device.'),
          h('li', null, 'Card numbers are never stored — only the last 4 digits.')))));
}

async function viewAddresses() {
  if (!state.user) { location.hash = '#/login'; return; }
  const { addresses } = await api('GET', '/addresses');
  const formBox = h('div', { class: 'card hidden', style: { marginBottom: '16px' } });
  const openForm = (a) => { formBox.replaceChildren(h('h3', null, a ? 'Edit address' : 'Add a new address'), addressForm(() => route(), a)); formBox.classList.remove('hidden'); formBox.scrollIntoView(); };
  mount(h('h1', { class: 'page-title' }, 'Your addresses'), formBox,
    h('div', { class: 'acc-grid' },
      h('button', { class: 'acc-tile add-tile', onclick: () => openForm() }, 'Add a new address'),
      addresses.map((a) => h('div', { class: 'acc-tile', style: { flexDirection: 'column', gap: '2px' } },
        a.is_default ? h('div', { class: 'hint' }, 'Default') : null,
        h('b', null, a.full_name), h('div', null, a.line1), a.line2 ? h('div', null, a.line2) : null,
        h('div', null, `${a.city}, ${a.state} ${a.pincode}`), h('div', null, `Phone: ${a.phone}`),
        h('div', { class: 'line-actions' },
          h('button', { class: 'link-btn', onclick: () => openForm(a) }, 'Edit'), h('span', { class: 'sep' }, '|'),
          h('button', { class: 'link-btn', onclick: async () => { if (await askConfirm('Remove this address?', 'Remove')) { await api('DELETE', `/addresses/${a.id}`).catch(fail); route(); } } }, 'Remove'))))));
}

// ---------- Admin ----------
async function viewAdmin(params) {
  if (!state.user) { location.hash = '#/login?next=%23%2Fadmin'; return; }
  if (state.user.role !== 'admin') { mount(h('div', { class: 'card' }, h('h1', null, 'Access denied'), h('p', null, 'This area is restricted to store administrators.'))); return; }
  const qp = new URLSearchParams(params);
  const tab = qp.get('tab') || 'dashboard';
  const tabs = h('div', { class: 'tabs' }, [['dashboard', 'Dashboard'], ['orders', 'Orders'], ['returns', 'Returns'], ['helpdesk', 'Help desk'], ['messages', 'Messages'],
    ['products', 'Products'], ['sellers', 'Sellers'], ['qc', 'Catalog check'], ['claims', 'Claims'], ['settlement', 'Settlement'],
    ['express', 'Express'], ['riders', 'Riders'], ['resellers', 'Resellers'],
    ['customers', 'Customers'], ['coupons', 'Coupons'], ['audit', 'Audit log']]
    .map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { location.hash = `#/admin?tab=${k}`; } }, l)));
  const body = h('div');
  const test = state.config.testMode || {};
  mount(h('h1', { class: 'page-title' }, 'Bazaario Studio'), h('p', { class: 'tagline' }, 'Orders, sellers, deliveries, returns, help desk, catalog and payouts'),
    test.payments || test.courier || test.sms ? h('p', { class: 'alert alert-test' },
      'Test mode: payments are simulated, tracking numbers are generated here, and SMS and email messages are recorded under Messages instead of being sent. Connect real partner accounts to go live.') : null,
    tabs, body);

  if (tab === 'dashboard') {
    const s = await api('GET', '/admin/stats');
    const tile = (l, val, href, alert) => h(href ? 'a' : 'div', { class: 'stat' + (alert ? ' stat-alert' : ''), href }, h('span', { class: 'hint' }, l), h('b', null, val));
    add(body, h('div', { class: 'stats' },
      tile('Revenue', inr(s.revenue)), tile('Orders', s.orders), tile('Open orders', s.pending, '#/admin?tab=orders'),
      tile('Failed deliveries', s.failedDeliveries, '#/admin?tab=orders&status=delivery_failed', s.failedDeliveries > 0),
      tile('Open returns', s.returns, '#/admin?tab=returns', s.returns > 0),
      tile('Open requests', s.overdueTickets ? `${s.tickets} (${s.overdueTickets} late)` : s.tickets, '#/admin?tab=helpdesk', s.overdueTickets > 0),
      tile('Orders on hold', s.held, '#/admin?tab=orders&status=held', s.held > 0),
      tile('Seller applications', s.sellerApplications, '#/admin?tab=sellers&status=pending', s.sellerApplications > 0),
      tile('Listings to check', s.qcQueue, '#/admin?tab=qc', s.qcQueue > 0),
      tile('Open claims', s.claims, '#/admin?tab=claims', s.claims > 0),
      tile('Sellers', s.sellers, '#/admin?tab=sellers'),
      tile('Customers', s.customers), tile('Active products', s.products)),
    h('div', { class: 'card' }, h('h3', null, 'Low stock (under 20)'),
      s.lowStock.length ? h('table', null, h('tr', null, h('th', null, 'Product'), h('th', null, 'Stock')),
        s.lowStock.map((p) => h('tr', null, h('td', null, p.title), h('td', { class: 'err' }, p.stock)))) : h('p', { class: 'muted' }, 'All products are well stocked.')));
  }

  if (tab === 'orders') {
    const status = qp.get('status');
    const { orders, transitions } = await api('GET', '/admin/orders' + (status ? `?status=${encodeURIComponent(status)}` : ''));
    const filter = h('select', { 'aria-label': 'Show orders', style: { width: 'auto' }, onchange: (e) => { location.hash = '#/admin?tab=orders' + (e.target.value ? `&status=${e.target.value}` : ''); } },
      h('option', { value: '' }, 'All orders'), h('option', { value: 'held', selected: status === 'held' }, 'On hold for review'),
      Object.keys(transitions).map((k) => h('option', { value: k, selected: k === status }, STATUS_LABEL[k])));
    const release = async (o) => {
      try { await api('POST', `/admin/orders/${o.id}/release`); toast('Order released to its seller.'); route(); } catch (ex) { fail(ex); }
    };
    // Who has the order and why (routing), and who moves it: Bazaario for its own and Fulfilled stock, the seller otherwise.
    const sellerCell = (o) => h('td', null, o.seller || '—',
      o.route_reason ? h('div', { class: 'hint' }, o.route_reason) : null,
      o.status === 'placed' && !o.hold_reason && o.accept_by ? h('div', { class: 'hint low' }, `Seller to accept by ${fmtWhen(o.accept_by)}`) : null,
      o.seller_lane && o.seller_lane !== 'direct' && o.seller_fulfilment !== 'fulfilled' ? h('div', { class: 'hint' }, 'Seller ships') : null);
    add(body, h('p', null, h('label', { class: 'inline' }, 'Show: ', filter)),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Order #', 'Placed', 'Customer', 'Seller', 'Delivery', 'Total', 'Payment', 'Status', 'Update'].map((t) => h('th', null, t))),
        orders.map((o) => h('tr', null, h('td', null, o.order_no, o.status !== 'placed' && o.status !== 'cancelled'
          ? h('div', null, h('a', { class: 'hint', href: `#/doc/invoice/${o.id}?as=admin` }, 'Invoice'), ' · ', h('a', { class: 'hint', href: `#/doc/label/${o.id}?as=admin` }, 'Label')) : null),
          h('td', null, fmtDate(o.created_at)), h('td', null, o.customer, h('div', { class: 'hint' }, o.email)), sellerCell(o),
          h('td', null, o.delivery_speed === 'express' ? h('span', { class: 'speed-tag' }, 'Express') : 'Standard',
            o.promised_at ? h('div', { class: 'hint' }, `Promised ${fmtWhen(o.promised_at)}`) : null, o.awb ? h('div', { class: 'hint' }, o.awb) : null),
          h('td', null, inr(o.total)), h('td', null, `${PAY_LABEL[o.payment_method] || o.payment_method} · ${o.payment_status}`),
          h('td', null, o.hold_reason && o.status === 'placed' ? h('b', { class: 'low' }, 'On hold') : STATUS_LABEL[o.status],
            o.hold_reason && o.status === 'placed' ? h('div', { class: 'hint' }, o.hold_reason) : null,
            o.status === 'delivery_failed' && o.reattempt ? h('div', { class: 'hint ok' }, `Buyer asked: ${o.reattempt}`) : null),
          h('td', null, o.hold_reason && o.status === 'placed' ? h('button', { class: 'btn btn-sm btn-outline', onclick: () => release(o) }, 'Checked: release') : null,
            transitions[o.status].length ? h('select', { onchange: async (e) => {
            if (!e.target.value) return;
            try { await api('PATCH', `/admin/orders/${o.id}`, { status: e.target.value }); toast('Order updated. The buyer has been told.'); route(); } catch (ex) { fail(ex); }
          } }, h('option', { value: '' }, 'Move to…'), transitions[o.status].map((t) => h('option', { value: t }, STATUS_LABEL[t]))) : '—'))))));
  }

  if (tab === 'returns') {
    const { returns } = await api('GET', '/admin/returns');
    const actOn = async (r, action, note) => {
      try { await api('PATCH', `/admin/returns/${r.id}`, { action, note }); toast('Return updated. The buyer has been told.'); route(); } catch (ex) { fail(ex); }
    };
    const reject = (r) => {
      const modal = $('#modal');
      const note = h('input', { maxLength: 300, required: true, placeholder: 'For example: item was used' });
      $('#modal-body').replaceChildren(h('h3', null, `Reject return for ${r.order_no}?`), h('p', { class: 'muted small' }, 'The buyer sees this reason.'),
        h('form', { onsubmit: (e) => { e.preventDefault(); modal.close(); actOn(r, 'reject', note.value); } }, h('label', null, 'Reason'), note,
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('button', { class: 'btn btn-outline' }, 'Reject return'),
            h('button', { type: 'button', class: 'btn', onclick: () => modal.close() }, 'Go back'))));
      modal.showModal();
    };
    const RS = { requested: 'New', pickup_scheduled: 'Pickup scheduled', refunded: 'Refunded', rejected: 'Rejected' };
    add(body, returns.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Order #', 'Customer', 'Reason', 'Refund to', 'Status', 'Action'].map((t) => h('th', null, t))),
      returns.map((r) => h('tr', null, h('td', null, r.order_no, h('div', { class: 'hint' }, inr(r.total))), h('td', null, r.customer, h('div', { class: 'hint' }, r.email)),
        h('td', null, r.reason, r.comment ? h('div', { class: 'hint' }, r.comment) : null),
        h('td', null, r.refund_to === 'wallet' ? 'Wallet' : 'Original payment'), h('td', null, RS[r.status], r.note ? h('div', { class: 'hint' }, r.note) : null),
        h('td', null, h('div', { class: 'line-actions' },
          r.status === 'requested' ? h('button', { class: 'btn btn-sm btn-outline', onclick: () => actOn(r, 'approve') }, 'Approve pickup') : null,
          r.status === 'pickup_scheduled' ? h('button', { class: 'btn btn-sm btn-outline', onclick: () => actOn(r, 'refund') }, 'Item received: refund') : null,
          ['requested', 'pickup_scheduled'].includes(r.status) ? h('button', { class: 'link-btn danger', onclick: () => reject(r) }, 'Reject') : null)))))) 
      : h('div', { class: 'card empty' }, h('p', null, 'No returns yet.')));
  }

  if (tab === 'helpdesk') {
    const { tickets, categories } = await api('GET', '/admin/tickets');
    const open = qp.get('ticket');
    if (open) {
      const { ticket: t } = await api('GET', `/admin/tickets/${encodeURIComponent(open)}`);
      const reply = h('textarea', { rows: 3, maxLength: 4000, required: true, placeholder: 'Write your reply to the buyer' });
      const send = async (close) => {
        try { await api('POST', `/admin/tickets/${t.id}/reply`, { message: reply.value, close }); toast('Reply sent.'); location.hash = '#/admin?tab=helpdesk'; } catch (ex) { fail(ex); }
      };
      const who = { customer: t.customer, agent: 'Bazaario support', system: 'Automatic message' };
      add(body, h('div', { class: 'card', style: { marginBottom: '16px' } },
        h('p', null, h('a', { href: '#/admin?tab=helpdesk' }, 'All requests')),
        h('h3', null, `${t.ticket_no} · ${t.subject}`),
        h('p', { class: 'hint' }, `${categories[t.category]} · ${t.customer} (${t.email})${t.order_no ? ' · Order ' + t.order_no : ''} · ${TICKET_STATUS[t.status]}`),
        h('div', { class: 'thread' }, t.messages.map((m) => h('div', { class: 'msg ' + m.author },
          h('div', { class: 'hint' }, h('b', null, who[m.author]), ' · ', fmtWhen(m.created_at)), h('p', null, m.body)))),
        t.status === 'closed' ? h('p', { class: 'muted' }, 'This request is closed.') : [h('label', null, 'Reply'), reply,
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
            h('button', { class: 'btn btn-outline', onclick: () => send(false) }, 'Send reply'),
            h('button', { class: 'btn', onclick: () => send(true) }, 'Reply and close'))]));
    }
    const now = Date.now();
    add(body, tickets.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Request', 'Topic', 'Customer', 'Subject', 'Status', 'Reply due'].map((t) => h('th', null, t))),
      tickets.map((t) => h('tr', null, h('td', null, h('a', { href: `#/admin?tab=helpdesk&ticket=${t.id}` }, t.ticket_no)),
        h('td', null, categories[t.category]), h('td', null, t.customer), h('td', null, t.subject), h('td', null, TICKET_STATUS[t.status]),
        h('td', { class: t.status === 'open' && t.due_at < now ? 'err' : '' }, t.status === 'open' ? (t.due_at < now ? `Late since ${fmtWhen(t.due_at)}` : fmtWhen(t.due_at)) : '—')))))
      : h('div', { class: 'card empty' }, h('p', null, 'No requests yet.')));
  }

  if (tab === 'messages') {
    const { messages } = await api('GET', '/admin/messages');
    add(body, h('p', { class: 'muted' }, 'Every SMS and email Bazaario sends to buyers. In test mode they are recorded here instead of being delivered.'),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Time', 'Channel', 'To', 'Order', 'Message'].map((t) => h('th', null, t))),
        messages.map((m) => h('tr', null, h('td', null, fmtWhen(m.created_at)), h('td', null, m.channel.toUpperCase(), h('div', { class: 'hint' }, m.provider)),
          h('td', null, m.recipient), h('td', null, m.order_no || '—'), h('td', null, m.body))))));
  }

  if (tab === 'products') {
    const { products } = await api('GET', '/admin/products');
    const formBox = h('div', { class: 'card hidden', style: { marginBottom: '16px' } });
    const openForm = (p) => {
      const f = {};
      const inp = (k, label, attrs) => { f[k] = h(attrs.tag || 'input', { ...attrs, tag: undefined }); return h('div', { class: attrs.full ? 'full' : '' }, h('label', null, label), f[k]); };
      const catSel = h('select', null, state.categories.map((c) => h('option', { value: c.id, selected: p && p.category_id === c.id }, c.name)));
      const chk = (label, on) => { const c = h('input', { type: 'checkbox', checked: on }); return [c, h('label', { class: 'inline' }, c, label)]; };
      const [exp, expL] = chk('Express delivery', p ? !!p.express : false);
      const [deal, dealL] = chk('Deal', p ? !!p.is_deal : false);
      const [act, actL] = chk('Active (visible in store)', p ? !!p.active : true);
      formBox.replaceChildren(h('h3', null, p ? `Edit product #${p.id}` : 'Add a product'),
        h('form', { onsubmit: async (e) => {
          e.preventDefault();
          const payload = { title: f.title.value, brand: f.brand.value, categoryId: Number(catSel.value), price: Number(f.price.value), mrp: Number(f.mrp.value),
            stock: Number(f.stock.value), image: f.image.value, emoji: f.emoji.value, color: f.color.value, description: f.description.value, features: f.features.value,
            express: exp.checked, isDeal: deal.checked, active: act.checked };
          try { if (p) await api('PUT', `/admin/products/${p.id}`, payload); else await api('POST', '/admin/products', payload); toast('Product saved.'); route(); } catch (ex) { fail(ex); }
        } }, h('div', { class: 'form-grid' },
          inp('title', 'Title', { value: p ? p.title : '', required: true, maxLength: 200, full: true }),
          inp('brand', 'Brand', { value: p ? p.brand : '', required: true, maxLength: 60 }),
          h('div', null, h('label', null, 'Category'), catSel),
          inp('price', 'Selling price (₹)', { type: 'number', min: 1, value: p ? p.price / 100 : '', required: true }),
          inp('mrp', 'MRP (₹)', { type: 'number', min: 1, value: p ? p.mrp / 100 : '', required: true }),
          inp('stock', 'Stock', { type: 'number', min: 0, value: p ? p.stock : 0, required: true }),
          photoField(f, p),
          inp('emoji', 'Icon shown when there is no photo (emoji)', { value: p ? p.emoji : '📦', maxLength: 8 }),
          inp('color', 'Background colour', { type: 'color', value: p ? p.color : '#e3e6e6' }),
          inp('description', 'Description', { tag: 'textarea', rows: 3, value: p ? p.description : '', maxLength: 4000, full: true }),
          inp('features', 'Key features (one per line)', { tag: 'textarea', rows: 4, value: p ? p.features.join('\n') : '', full: true })),
        expL, dealL, actL, h('button', { class: 'btn btn-primary' }, 'Save product'), ' ',
        h('button', { type: 'button', class: 'btn btn-outline', onclick: () => formBox.classList.add('hidden') }, 'Cancel')));
      formBox.classList.remove('hidden');
      formBox.scrollIntoView();
    };
    add(body, h('p', null, h('button', { class: 'btn btn-primary', onclick: () => openForm() }, 'Add a product')), formBox,
      h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['', 'Product', 'Category', 'Price', 'MRP', 'Stock', 'Status', ''].map((t) => h('th', null, t))),
        products.map((p) => h('tr', null, h('td', null, pic(p, 'pimg thumb')), h('td', null, h('a', { href: `#/p/${p.id}` }, p.title), h('div', { class: 'hint' }, p.brand)),
          h('td', null, p.category_name), h('td', null, inr(p.price)), h('td', null, inr(p.mrp)),
          h('td', { class: p.stock < 20 ? 'err' : '' }, p.stock), h('td', null, p.active ? 'Active' : 'Inactive'),
          h('td', null, h('button', { class: 'btn btn-sm btn-outline', onclick: () => openForm(p) }, 'Edit')))))));
  }

  if (['sellers', 'qc', 'claims', 'settlement'].includes(tab)) await studioMarket(tab, body, qp);
  if (['express', 'riders'].includes(tab)) await studioExpress(tab, body);
  if (tab === 'resellers') await studioResellers(body);

  if (tab === 'customers') {
    const { users } = await api('GET', '/admin/users');
    add(body, h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Name', 'Email', 'Mobile', 'Role', 'Orders', 'Joined', 'Status'].map((t) => h('th', null, t))),
      users.map((u) => h('tr', null, h('td', null, u.name), h('td', null, u.email), h('td', null, u.phone || '—'), h('td', null, u.role),
        h('td', null, u.orders), h('td', null, fmtDate(u.created_at)), h('td', null, u.locked_until > Date.now() ? 'Locked' : 'Active'))))));
  }

  if (tab === 'coupons') {
    const { coupons } = await api('GET', '/admin/coupons');
    const code = h('input', { required: true, maxLength: 20, pattern: '[A-Za-z0-9]+' });
    const kind = h('select', null, h('option', { value: 'percent' }, 'Percent'), h('option', { value: 'flat' }, 'Flat ₹'));
    const value = h('input', { type: 'number', required: true, min: 1 });
    const maxD = h('input', { type: 'number', min: 1, placeholder: 'Optional' });
    const minO = h('input', { type: 'number', min: 0, value: 0 });
    const desc = h('input', { maxLength: 200 });
    add(body, h('div', { class: 'card', style: { marginBottom: '16px' } }, h('h3', null, 'Create / update coupon'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/admin/coupons', { code: code.value, kind: kind.value, value: Number(value.value), maxDiscount: maxD.value ? Number(maxD.value) : undefined, minOrder: Number(minO.value), description: desc.value }); toast('Coupon saved.'); route(); } catch (ex) { fail(ex); }
      } }, h('div', { class: 'form-grid' },
        h('div', null, h('label', null, 'Code'), code), h('div', null, h('label', null, 'Type'), kind),
        h('div', null, h('label', null, 'Value (% or ₹)'), value), h('div', null, h('label', null, 'Max discount (₹)'), maxD),
        h('div', null, h('label', null, 'Min order (₹)'), minO), h('div', null, h('label', null, 'Description'), desc)),
      h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Save coupon'))),
    h('table', null, h('tr', null, ['Code', 'Type', 'Value', 'Max', 'Min order', 'Status', ''].map((t) => h('th', null, t))),
      coupons.map((c) => h('tr', null, h('td', null, h('b', null, c.code)), h('td', null, c.kind), h('td', null, c.kind === 'percent' ? `${c.value}%` : inr(c.value)),
        h('td', null, c.max_discount ? inr(c.max_discount) : '—'), h('td', null, inr(c.min_order)), h('td', null, c.active ? 'Active' : 'Disabled'),
        h('td', null, c.active ? h('button', { class: 'btn btn-sm btn-outline', onclick: async () => { await api('DELETE', `/admin/coupons/${encodeURIComponent(c.code)}`).catch(fail); route(); } }, 'Disable') : null)))));
  }

  if (tab === 'audit') {
    const { entries } = await api('GET', '/admin/audit');
    add(body, h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Time', 'User', 'Action', 'Detail', 'IP'].map((t) => h('th', null, t))),
      entries.map((a) => h('tr', null, h('td', null, new Date(a.created_at).toLocaleString('en-IN')), h('td', null, a.email || '—'),
        h('td', null, a.action), h('td', { class: 'hint' }, a.detail || ''), h('td', null, a.ip))))));
  }
}

/** Shrinks a chosen photo in the browser so uploads stay small and fast (longest side 1000px, JPEG). */
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

/** Bazaario Studio photo picker: upload from the device or paste a link to an image. */
function photoField(f, p, uploadPath = '/admin/uploads') {
  f.image = h('input', { type: 'text', inputMode: 'url', value: p ? p.image || '' : '', placeholder: 'https://… (or upload a photo)', maxLength: 1000 });
  const preview = h('div', { class: 'photo-preview' });
  const paint = () => preview.replaceChildren(f.image.value ? h('img', { src: f.image.value, alt: 'Product photo preview' }) : h('span', { class: 'muted small' }, 'No photo yet'));
  f.image.addEventListener('input', paint);
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: 'photo-file' });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    try {
      toast('Uploading photo…');
      const { url } = await api('POST', uploadPath, { dataUrl: await shrinkPhoto(file.files[0]) });
      f.image.value = url; paint(); toast('Photo added. Save the product to keep it.');
    } catch (e) { fail(e); }
    file.value = '';
  });
  paint();
  return h('div', { class: 'full photo-field' }, h('label', null, 'Product photo'),
    h('div', { class: 'photo-row' }, preview,
      h('div', { class: 'photo-actions' },
        h('label', { class: 'btn btn-outline btn-sm', for: 'photo-file' }, 'Upload photo'), file,
        h('button', { type: 'button', class: 'link-btn danger', onclick: () => { f.image.value = ''; paint(); } }, 'Remove photo'),
        h('span', { class: 'muted small' }, 'Or paste a link to an image:'), f.image,
        h('span', { class: 'muted small' }, 'Square photos on a plain background look best.'))));
}

// ---------- Help centre (blueprint stage 11) ----------
const FAQ = [
  ['Orders and delivery', [
    ['When will my order arrive?', 'The product page and checkout show the delivery date for your PIN code. Express orders arrive in under 90 minutes in partner cities; Standard orders take 2 to 7 days depending on where you live.'],
    ['How do I track my order?', 'Open Your orders and choose Track and manage. You will see each step, the courier and the tracking number. We also send SMS and email updates.'],
    ['I missed my delivery. What now?', 'Open the order and choose a new delivery time. We try up to three times before the order comes back to us.'],
    ['Can I cancel an order?', 'Yes, until it ships. Open the order and choose Cancel order. Any payment is refunded straight away.'],
  ]],
  ['Payments', [
    ['Which payment methods can I use?', 'UPI, credit and debit cards, no-cost EMI on orders of ₹3,000 and above, your Bazaario wallet, and Cash on Delivery.'],
    ['Why is Cash on Delivery not available for me?', 'COD is not offered on the islands or above ₹50,000, and it is paused for accounts where earlier COD deliveries were refused. You can always pay online.'],
    ['Is my card safe?', 'Card payments go through a licensed payment gateway. Bazaario never stores your card number; we keep only its last 4 digits.'],
  ]],
  ['Returns and refunds', [
    ['How do I return an item?', 'Within 10 days of delivery, open the order and choose Return items. Pick a reason and we will arrange a pickup from your address.'],
    ['When do I get my refund?', 'Wallet refunds are instant once we receive the item. Refunds to a card, UPI or bank take 5 to 7 working days. Cash on Delivery orders are refunded to the wallet.'],
  ]],
  ['Your account', [
    ['How do I sign in with my mobile number?', 'Add your mobile number under Profile and security, then choose Mobile OTP on the sign-in page.'],
    ['How do I change my address?', 'Go to My account, then Addresses.'],
  ]],
];

async function viewHelp(params) {
  const q = new URLSearchParams(params);
  const g = state.config.grievanceOfficer || {};
  const faq = h('div', { class: 'card' }, h('h2', null, 'Common questions'),
    FAQ.map(([group, items]) => [h('h4', null, group), items.map(([qq, a]) => h('details', { class: 'faq' }, h('summary', null, qq), h('p', null, a)))]));

  let contact;
  let mine = null;
  if (!state.user) {
    contact = h('div', { class: 'card' }, h('h2', null, 'Contact us'), h('p', null, 'Sign in to raise a request about an order and follow our reply here.'),
      h('a', { class: 'btn btn-outline', href: '#/login?next=' + encodeURIComponent('#/help') }, 'Sign in'));
  } else {
    const [{ categories }, { orders }, { tickets }] = await Promise.all([api('GET', '/support/categories'), api('GET', '/orders'), api('GET', '/tickets')]);
    const pre = q.get('order');
    const cat = h('select', { required: true }, Object.entries(categories).map(([k, l]) => h('option', { value: k, selected: q.get('topic') === k || (pre && k === 'order') }, l)));
    const ord = h('select', null, h('option', { value: '' }, 'Not about a specific order'),
      orders.map((o) => h('option', { value: o.id, selected: String(o.id) === pre }, `${o.order_no} · ${fmtDate(o.created_at)} · ${STATUS_LABEL[o.status]}`)));
    const subject = h('input', { required: true, minLength: 4, maxLength: 120, placeholder: 'For example: parcel not delivered' });
    const msg = h('textarea', { required: true, minLength: 10, maxLength: 4000, rows: 4, placeholder: 'Tell us what happened' });
    contact = h('div', { class: 'card' }, h('h2', null, 'Contact us'),
      h('p', { class: 'muted small' }, `We reply within ${24} hours. Complaints to the Grievance Officer are resolved within 30 days.`),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { ticket } = await api('POST', '/tickets', { category: cat.value, orderId: ord.value || undefined, subject: subject.value, message: msg.value });
          toast(`Request ${ticket.ticket_no} sent.`);
          location.hash = `#/help/t/${ticket.id}`;
        } catch (ex) { fail(ex); }
      } }, h('label', null, 'What is it about?'), cat, h('label', null, 'Order'), ord, h('label', null, 'Subject'), subject,
      h('label', null, 'Message'), msg, h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Send request')));
    mine = h('div', { class: 'card' }, h('h2', null, 'My requests'),
      tickets.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Request', 'Subject', 'Status', 'Updated'].map((t) => h('th', null, t))),
        tickets.map((t) => h('tr', null, h('td', null, h('a', { href: `#/help/t/${t.id}` }, t.ticket_no)), h('td', null, t.subject),
          h('td', null, TICKET_STATUS[t.status]), h('td', null, fmtDate(t.updated_at)))))) : h('p', { class: 'muted' }, 'You have not raised any requests.'));
  }

  mount(h('h1', { class: 'page-title' }, 'Help centre'),
    h('div', { class: 'acc-grid' },
      h('a', { class: 'acc-tile', href: '#/orders' }, h('h3', null, 'Track, cancel or return'), h('div', { class: 'muted small' }, 'Everything about an order starts from Your orders')),
      h('a', { class: 'acc-tile', href: '#/wallet' }, h('h3', null, 'Refunds and wallet'), h('div', { class: 'muted small' }, 'See refunds and your wallet balance')),
      h('a', { class: 'acc-tile', href: '#/page/returns' }, h('h3', null, 'Return policy'), h('div', { class: 'muted small' }, 'What can be returned and how')),
      h('a', { class: 'acc-tile', href: '#/page/grievance' }, h('h3', null, 'Grievance Officer'), h('div', { class: 'muted small' }, 'Raise a formal complaint'))),
    h('div', { class: 'two-col help-cols' }, h('div', null, faq, mine), contact));
}

const TICKET_STATUS = { open: 'Waiting for our reply', answered: 'Replied', closed: 'Closed' };

async function viewTicket(id) {
  if (!state.user) { location.hash = '#/login?next=' + encodeURIComponent(location.hash); return; }
  const { ticket: t } = await api('GET', `/tickets/${encodeURIComponent(id)}`);
  const reply = h('textarea', { rows: 3, maxLength: 4000, placeholder: 'Write a reply' });
  const who = { customer: 'You', agent: 'Bazaario support', system: 'Bazaario' };
  mount(h('p', null, h('a', { href: '#/help' }, 'Help centre')),
    h('h1', { class: 'page-title' }, t.subject),
    h('p', { class: 'muted' }, `Request ${t.ticket_no} · ${TICKET_STATUS[t.status]}${t.order_no ? ' · Order ' + t.order_no : ''}`),
    h('div', { class: 'card thread' }, t.messages.map((m) => h('div', { class: 'msg ' + m.author },
      h('div', { class: 'hint' }, h('b', null, who[m.author]), ' · ', fmtWhen(m.created_at)), h('p', null, m.body)))),
    t.status === 'closed' ? h('p', { class: 'muted' }, 'This request is closed. ', h('a', { href: '#/help' }, 'Start a new one')) : h('div', { class: 'card' },
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', `/tickets/${t.id}/messages`, { message: reply.value }); toast('Reply sent.'); route(); } catch (ex) { fail(ex); }
      } }, h('label', null, 'Reply'), reply,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
        h('button', { class: 'btn btn-primary' }, 'Send reply'),
        h('button', { type: 'button', class: 'btn btn-outline', onclick: async () => { await api('POST', `/tickets/${t.id}/close`).catch(fail); route(); } }, 'My issue is solved')))));
}

// ---------- Policy and info pages ----------
// Plain-language policies a store must show under the Consumer Protection (E-Commerce) Rules 2020.
// Company details come from settings; replace the placeholders before going live.
function policyPages() {
  const g = state.config.grievanceOfficer || {};
  const co = state.config.companyName || 'Bazaario';
  const days = state.config.returnWindowDays || 10;
  return {
    about: ['Our story', [['', 'Bazaario brings the warmth of an Indian bazaar online: handpicked brands, honest prices and delivery to your doorstep, from Express deliveries in under 90 minutes to every PIN code in India.']]],
    careers: ['Careers', [['', 'We are hiring engineers, designers and operations specialists across India.']]],
    sell: ['Sell on Bazaario', [['', 'Brands, sellers and small manufacturers can register in a few minutes from the Sell on Bazaario page. Local shops join with Express delivery soon.']]],
    protection: ['Buyer protection', [['', 'Secure payments, genuine products and easy returns. If an item arrives damaged or different from what you ordered, return it within the return window for a full refund.']]],
    terms: ['Terms of use', [
      ['Who we are', `This store is run by ${co}. By using it you agree to these terms.`],
      ['Prices and payment', 'All prices are in Indian rupees and include GST. The price you pay is the price shown at checkout. We may cancel an order if a price was shown wrongly, and refund you in full.'],
      ['Orders', 'An order is confirmed when you receive the confirmation message. We may cancel an order if the item is out of stock or the address cannot be served, and refund any payment.'],
      ['Reviews', 'Reviews must be honest and about the product. We remove reviews that are fake, abusive or paid for.'],
      ['Complaints', `If something goes wrong, contact us through the Help centre, or write to our Grievance Officer at ${g.email || 'the address on the Grievance Officer page'}.`],
    ]],
    privacy: ['Privacy notice', [
      ['What we collect', 'Your name, contact details, delivery addresses, orders and payment references. We never store full card numbers.'],
      ['Why', 'To deliver your orders, take payments, give refunds, answer your requests and, if you agree, send offers.'],
      ['Who we share it with', 'Only the partners needed to complete your order: the payment gateway, courier and SMS or email service.'],
      ['Your rights', 'Under the Digital Personal Data Protection Act 2023 you can ask to see, correct or delete your data. Write to us through the Help centre.'],
      ['Security', 'Passwords are hashed, sessions use secure cookies, and access to your data is limited to staff who need it.'],
    ]],
    returns: ['Return and refund policy', [
      ['Return window', `Most items can be returned within ${days} days of delivery. Open the order and choose Return items.`],
      ['Items that cannot be returned', 'Innerwear, personal care and beauty products once opened, food and grocery, and items marked non-returnable on the product page.'],
      ['Pickup', 'We collect the item from your delivery address. Please pack it with its tags, accessories and invoice.'],
      ['Refunds', 'Once the item is received and checked, wallet refunds are instant and refunds to a card, UPI or bank take 5 to 7 working days. Cash on Delivery orders are refunded to your Bazaario wallet.'],
      ['Damaged or wrong items', 'Choose the matching reason and add details. These returns are always accepted within the window.'],
    ]],
    shipping: ['Shipping and delivery', [
      ['Express', `Under 90 minutes from partner stores in ${(state.config.expressCities || []).join(', ')}, for items marked Express, between 8 am and 7:30 pm. Express costs ${inr(state.config.expressFee || 4900)}.`],
      ['Standard', `2 days in major cities, 3 days in most of India, 5 days in the North East and Jammu, Kashmir and Ladakh, and 7 days to the islands. Free on orders above ${inr(state.config.freeShippingThreshold || 49900)}, otherwise ${inr(state.config.shippingFee || 4000)}.`],
      ['Cash on Delivery', 'Available on orders up to ₹50,000, except on the Andaman and Nicobar and Lakshadweep islands.'],
      ['Missed deliveries', 'If we miss you, choose a new delivery time from the order page. After three failed attempts the order comes back to us and any payment is refunded.'],
    ]],
    cancellation: ['Cancellation policy', [
      ['Before shipping', 'You can cancel any order until it ships, from the order page. Payments are refunded straight away; wallet money returns to your wallet.'],
      ['After shipping', 'Once shipped, an order cannot be cancelled, but you can return it after delivery.'],
    ]],
    grievance: ['Grievance Officer', [
      ['', 'As required by the Consumer Protection (E-Commerce) Rules 2020, you can raise a complaint with our Grievance Officer. We acknowledge every complaint within 48 hours and resolve it within one month.'],
      ['Name', g.name || ''],
      ['Email', g.email || ''],
      g.phone ? ['Phone', g.phone] : null,
      ['Address', g.address || ''],
      ['Raise a complaint', 'Use the Help centre and choose "Complaint to the Grievance Officer", so you can follow our reply there.'],
    ].filter(Boolean)],
  };
}

function viewPage(slug) {
  if (slug === 'help') { location.hash = '#/help'; return; }
  const p = policyPages()[slug];
  if (!p) { mount(h('div', { class: 'card prose' }, h('h1', null, 'Page not found'), h('p', null, 'The page you requested does not exist.'))); return; }
  document.title = `${p[0]} - Bazaario`;
  mount(h('div', { class: 'card prose' }, h('h1', null, p[0]),
    p[1].map(([head, text]) => [head ? h('h3', null, head) : null, h('p', null, text)]),
    slug === 'grievance' ? h('a', { class: 'btn btn-outline', href: '#/help?topic=grievance' }, 'Raise a complaint') : null));
}

// ---------- Install as an app (Android, Windows, macOS) ----------
let installPrompt = null; // Chrome/Edge hand us this event when the store can be installed
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (location.hash === '#/app') route();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Bazaario is installed. Open it from your home screen, Start menu or Dock.');
  if (location.hash === '#/app') route();
});
window.addEventListener('offline', () => toast('You are offline. Prices, stock and orders will update when you reconnect.', true));
window.addEventListener('online', () => { toast('Back online.'); route(); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* site still works without it */ }));
}

function viewApp() {
  document.title = 'Get the app - Bazaario';
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const steps = (title, items) => h('div', { class: 'card' }, h('h3', null, title), h('ol', null, items.map((t) => h('li', null, t))));
  mount(h('div', { class: 'prose' },
    h('div', { class: 'card' },
      h('h1', null, 'Get the Bazaario app'),
      h('p', null, installed
        ? 'You are using the Bazaario app. Your bag, wishlist and orders stay in sync with the website.'
        : 'Install Bazaario on your phone or computer. It opens in its own window with an icon on your home screen, Start menu or Dock, and needs no app store.'),
      installPrompt && !installed ? h('button', { class: 'btn btn-primary', onclick: async () => {
        const p = installPrompt;
        installPrompt = null;
        await p.prompt();
        route();
      } }, 'Install Bazaario') : null),
    installed ? null : h('div', { class: 'app-steps' },
      steps('Android', ['Open this site in Chrome.', 'Tap the three-dot menu, then Install app (or Add to Home screen).', 'Tap Install. Bazaario appears in your app drawer.']),
      steps('Windows', ['Open this site in Microsoft Edge or Chrome.', 'Click the install icon at the right of the address bar (or the three-dot menu, then Apps, then Install this site as an app).', 'Click Install. Bazaario is added to the Start menu and can be pinned to the taskbar.']),
      steps('Mac', ['In Safari (macOS Sonoma or later): choose File, then Add to Dock.', 'In Chrome or Edge: click the install icon in the address bar, then Install.', 'Bazaario opens from the Dock, Launchpad and Spotlight.']),
      steps('iPhone and iPad', ['Open this site in Safari.', 'Tap Share, then Add to Home Screen.', 'Tap Add.']))));
}

// ---------------- Router ----------------
async function route() {
  state.timers.forEach(clearInterval);
  state.timers = [];
  document.title = 'Bazaario - Your Online Bazaar';
  const [raw = '/', anchor] = location.hash.slice(1).split('#');
  const [path, query = ''] = (raw || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const routes = {
    '': () => viewHome(),
    s: () => viewSearch(query),
    p: () => viewProduct(parts[1]),
    cart: () => viewCart(),
    checkout: () => viewCheckout(),
    orders: () => (parts[1] ? viewOrder(parts[1], query) : viewOrders(query)),
    wishlist: () => viewWishlist(),
    login: () => viewLogin(query),
    register: () => viewRegister(query),
    account: () => viewAccount(),
    security: () => viewSecurity(),
    addresses: () => viewAddresses(),
    admin: () => viewAdmin(query),
    page: () => viewPage(parts[1]),
    help: () => (parts[1] === 't' ? viewTicket(parts[2]) : viewHelp(query)),
    wallet: () => viewWallet(),
    app: () => viewApp(),
    sell: () => viewSell(),
    seller: () => viewSellerHub(query),
    doc: () => viewDocument(parts[1], parts[2], query),
    partner: () => viewPartner(),
    shop: () => viewShop(query),
    resell: () => viewResell(query),
    r: () => viewShare(parts[1]),
  };
  const view = routes[parts[0] || ''];
  if (!view) { viewPage('missing'); return; }
  try {
    await view();
    const target = anchor && document.getElementById(anchor);
    if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
  } catch (e) {
    if (e.status === 401) { location.hash = '#/login?next=' + encodeURIComponent('#' + raw); return; }
    mount(h('div', { class: 'card empty' }, h('h1', null, e.status === 404 ? 'Page not found' : 'Something went wrong'),
      h('p', null, e.message), h('a', { class: 'btn btn-primary', href: '#/' }, 'Go to home page')));
  }
}

// ---------------- Header behaviour ----------------
function setupSearch() {
  const form = $('#search-form');
  const input = $('#search-input');
  const catSel = $('#search-cat');
  const list = $('#suggest');
  state.categories.forEach((c) => catSel.append(h('option', { value: c.slug }, c.name)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    list.hidden = true;
    const p = new URLSearchParams();
    if (input.value.trim()) p.set('q', input.value.trim());
    if (catSel.value) p.set('category', catSel.value);
    location.hash = '#/s?' + p.toString();
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      const { suggestions } = await api('GET', '/products/suggest?q=' + encodeURIComponent(q)).catch(() => ({ suggestions: [] }));
      list.replaceChildren(...suggestions.map((s) => h('li', { onmousedown: () => { list.hidden = true; input.value = ''; location.hash = `#/p/${s.id}`; } }, s.title)));
      list.hidden = !suggestions.length;
    }, 200);
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

function setupDeliver() {
  $('#deliver-btn').addEventListener('click', () => {
    const modal = $('#modal');
    const pin = h('input', { maxLength: 6, inputMode: 'numeric', value: store.get('pin', ''), placeholder: 'Enter a 6-digit PIN code' });
    const err = h('div', { class: 'err hint' });
    $('#modal-body').replaceChildren(h('h3', null, 'Where should we deliver?'),
      h('p', { class: 'muted small' }, 'Delivery dates and Cash on Delivery depend on your PIN code.'),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        if (!/^[1-9]\d{5}$/.test(pin.value)) { err.textContent = 'Please enter a valid PIN code.'; return; }
        store.set('pin', pin.value); renderHeader(); modal.close(); toast(`Delivering to ${pin.value}`);
      } }, pin, err, h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn btn-primary' }, 'Save PIN'), h('button', { type: 'button', class: 'btn btn-outline', onclick: () => modal.close() }, 'Cancel'))));
    modal.showModal();
  });
}

async function init() {
  try {
    const [cfg, cats] = await Promise.all([api('GET', '/config'), api('GET', '/categories'), refreshSession()]);
    state.config = cfg;
    state.categories = cats.categories;
  } catch { /* render anyway */ }
  const sub = $('#subnav');
  state.categories.forEach((c) => sub.append(h('a', { class: 'chip', href: `#/s?category=${c.slug}` }, c.name)));
  $('#newsletter').addEventListener('submit', (e) => {
    e.preventDefault();
    e.target.reset();
    toast('Thanks! You are subscribed to our offers.');
  });
  setupSearch();
  setupDeliver();
  renderHeader();
  window.addEventListener('hashchange', route);
  route();
}

init();
