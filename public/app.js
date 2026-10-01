/* Bazaario storefront - vanilla JS single-page app.
 * Security note: all dynamic content is rendered with textContent / DOM APIs (never innerHTML),
 * so product data, reviews and user input cannot inject markup (XSS-safe by construction). */
'use strict';

const state = { user: null, csrf: null, categories: [], config: {}, cartCount: 0, timers: [] };
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
const mount = (...nodes) => { app.replaceChildren(...nodes); app.focus({ preventScroll: true }); };

// ---------------- Formatting ----------------
const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
const pct = (p) => Math.round(((p.mrp - p.price) / p.mrp) * 100);
const stars = (r) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));
const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const deliveryDate = (express) => {
  const d = new Date(Date.now() + (express ? 1 : 4) * 86400000);
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
};
const STATUS_LABEL = {
  placed: 'Order placed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered',
  cancelled: 'Cancelled', return_requested: 'Return requested', returned: 'Returned & refunded',
};

function priceBlock(p, big) {
  const rupees = Math.floor(p.price / 100);
  return h('div', null,
    p.mrp > p.price ? h('span', { class: 'off' }, `-${pct(p)}%`) : null,
    h('span', { class: big ? 'price' : 'price-sm' }, h('sup', null, '₹'), rupees.toLocaleString('en-IN')),
    p.mrp > p.price ? h('div', { class: 'muted' }, 'M.R.P.: ', h('span', { class: 'mrp' }, inr(p.mrp))) : null);
}

// ---------------- API client ----------------
async function api(method, path, body) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (state.csrf && method !== 'GET') opts.headers['X-CSRF-Token'] = state.csrf;
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
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
}

async function updateCartCount() {
  if (state.user) {
    try { state.cartCount = (await api('GET', '/cart')).count; } catch { state.cartCount = 0; }
  } else {
    state.cartCount = guestCart().reduce((s, i) => s + i.qty, 0);
  }
  $('#cart-count').textContent = state.cartCount;
}

function renderHeader() {
  const link = $('#account-link');
  $('#hello').textContent = state.user ? `Hello, ${state.user.name.split(' ')[0]}` : 'Hello, sign in';
  link.href = state.user ? '#/account' : '#/login';
  const pin = store.get('pin', '');
  $('#deliver-pin').textContent = pin ? `📍 ${pin}` : '📍 Select PIN code';
  updateCartCount();
}

async function afterLogin(data, redirect) {
  state.user = data.user;
  state.csrf = data.csrfToken;
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
  state.user = null; state.csrf = null;
  renderHeader();
  toast('You have been signed out.');
  location.hash = '#/';
}

// ---------------- Cart actions ----------------
async function addToCart(product, qty = 1, buyNow = false) {
  try {
    if (state.user) {
      await api('POST', '/cart', { productId: product.id, qty });
    } else {
      const items = guestCart();
      const ex = items.find((i) => i.productId === product.id);
      const max = Math.min(product.stock, state.config.maxQtyPerItem || 10);
      if (ex) ex.qty = Math.min(ex.qty + qty, max); else items.unshift({ productId: product.id, qty: Math.min(qty, max) });
      setGuestCart(items);
    }
    await updateCartCount();
    if (buyNow) {
      location.hash = state.user ? '#/checkout' : '#/login?next=' + encodeURIComponent('#/checkout');
    } else toast(`Added to cart: ${product.title.slice(0, 50)}`);
  } catch (e) { fail(e); }
}

async function toggleWishlist(product, btn) {
  if (!state.user) { location.hash = '#/login?next=' + encodeURIComponent(location.hash); return; }
  try {
    await api('POST', '/wishlist', { productId: product.id });
    toast('Added to your Wish List');
    if (btn) btn.textContent = '♥ In your Wish List';
  } catch (e) { fail(e); }
}

// ---------------- Product card ----------------
function productCard(p, { compact } = {}) {
  const url = `#/p/${p.id}`;
  return h('div', { class: 'pcard' },
    h('a', { href: url, 'aria-label': p.title },
      h('div', { class: 'pimg', style: { background: p.color } },
        p.is_deal ? h('span', { class: 'badge badge-deal' }, 'Limited time deal') : null, p.emoji)),
    h('a', { class: 'title', href: url }, p.title),
    h('div', null, h('span', { class: 'stars' }, stars(p.rating_avg)), ' ',
      h('a', { href: url + '#reviews', class: 'muted' }, p.rating_count.toLocaleString('en-IN'))),
    priceBlock(p),
    p.express ? h('div', null, h('span', { class: 'badge badge-express' }, '⚡ Express'), ' ', h('span', { class: 'muted' }, 'Get it by tomorrow')) : h('div', { class: 'muted' }, `FREE delivery ${deliveryDate(false).split(',')[0]}`),
    p.stock === 0 ? h('div', { class: 'err' }, 'Currently unavailable') : p.stock < 10 ? h('div', { class: 'err' }, `Only ${p.stock} left in stock.`) : null,
    compact || p.stock === 0 ? null : h('button', { class: 'btn btn-primary btn-sm', onclick: () => addToCart(p) }, 'Add to cart'));
}

// ---------------- Views ----------------
const SLIDES = [
  { bg: 'linear-gradient(110deg,#0b3d2e,#1f7a5c)', title: 'Great Festive Sale is LIVE', text: 'Up to 70% off on electronics, fashion & home. Extra 10% off with code WELCOME10.', big: '🎉', link: '#/s?deals=1' },
  { bg: 'linear-gradient(110deg,#3b1d6e,#7e3fbf)', title: 'Smartphones from ₹7,499', text: 'No-cost EMI · Exchange offers · Express delivery in 1 day', big: '📱', link: '#/s?category=mobiles' },
  { bg: 'linear-gradient(110deg,#8a3b00,#e07a1f)', title: 'Kitchen upgrades under ₹2,999', text: 'Air fryers, mixer grinders, cookware and more', big: '🍳', link: '#/s?category=home-kitchen' },
];

async function viewHome() {
  let idx = 0;
  const slides = SLIDES.map((s, i) => h('a', { class: 'slide' + (i === 0 ? ' active' : ''), href: s.link, style: { background: s.bg } },
    h('h2', null, s.title), h('p', null, s.text), h('span', { class: 'big' }, s.big)));
  const show = (n) => { slides[idx].classList.remove('active'); idx = (n + slides.length) % slides.length; slides[idx].classList.add('active'); };
  const hero = h('div', { class: 'hero' }, slides,
    h('button', { class: 'hero-nav prev', 'aria-label': 'Previous', onclick: () => show(idx - 1) }, '‹'),
    h('button', { class: 'hero-nav next', 'aria-label': 'Next', onclick: () => show(idx + 1) }, '›'));
  state.timers.push(setInterval(() => show(idx + 1), 5000));

  const [deals, best, all] = await Promise.all([
    api('GET', '/products?deals=1&limit=12&sort=discount'),
    api('GET', '/products?sort=rating&limit=12'),
    api('GET', '/products?limit=48'),
  ]);
  const byCat = {};
  for (const p of all.items) (byCat[p.category] ||= []).push(p);
  const tiles = state.categories.slice(0, 8).map((c) => {
    const ps = (byCat[c.slug] || []).slice(0, 4);
    return h('div', { class: 'card tile' },
      h('h3', null, `${c.icon} ${c.name}`),
      h('div', { class: 'tile-grid' }, ps.map((p) => h('a', { href: `#/p/${p.id}` },
        h('div', { class: 'tile-img', style: { background: p.color } }, p.emoji), p.title.split(' ').slice(0, 3).join(' ')))),
      h('p', null, h('a', { href: `#/s?category=${c.slug}` }, 'See more')));
  });

  const recentIds = store.get('recent', []);
  const recent = all.items.filter((p) => recentIds.includes(p.id)).sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));

  mount(hero,
    h('div', { class: 'tiles' }, tiles),
    h('div', { class: 'card row-card' }, h('div', { class: 'section-title' }, h('h2', null, "Today's Deals"), h('a', { href: '#/s?deals=1' }, 'See all deals')),
      h('div', { class: 'scroller' }, deals.items.map((p) => productCard(p, { compact: true })))),
    h('div', { class: 'card row-card' }, h('h2', null, 'Top rated by customers'),
      h('div', { class: 'scroller' }, best.items.map((p) => productCard(p, { compact: true })))),
    recent.length ? h('div', { class: 'card row-card' }, h('h2', null, 'Your browsing history'),
      h('div', { class: 'scroller' }, recent.map((p) => productCard(p, { compact: true })))) : null,
    state.user ? null : h('div', { class: 'card', style: { textAlign: 'center' } },
      h('p', null, 'See personalized recommendations'),
      h('a', { class: 'btn btn-primary', href: '#/login', style: { width: '240px' } }, 'Sign in'),
      h('p', { class: 'hint' }, 'New customer? ', h('a', { href: '#/register' }, 'Start here.'))));
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
  const heading = q.get('q') ? `"${q.get('q')}"` : cat ? cat.name : q.get('deals') ? "Today's Deals" : 'All products';

  const minIn = h('input', { type: 'number', min: 0, placeholder: 'Min', value: q.get('min') || '' });
  const maxIn = h('input', { type: 'number', min: 0, placeholder: 'Max', value: q.get('max') || '' });

  const filters = h('aside', { class: 'filters', 'aria-label': 'Filters' },
    h('h4', null, 'Delivery'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('express') === '1', onchange: (e) => go({ express: e.target.checked ? '1' : null }) }), '⚡ Express (1-day)'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('instock') === '1', onchange: (e) => go({ instock: e.target.checked ? '1' : null }) }), 'Include in-stock only'),
    h('h4', null, 'Category'),
    h('button', { class: 'f' + (!q.get('category') ? ' sel' : ''), onclick: () => go({ category: null }) }, 'Any category'),
    state.categories.map((c) => h('button', { class: 'f' + (c.slug === q.get('category') ? ' sel' : ''), onclick: () => go({ category: c.slug }) }, c.name)),
    h('h4', null, 'Customer Review'),
    [4, 3, 2].map((r) => h('button', { class: 'f' + (q.get('rating') === String(r) ? ' sel' : ''), onclick: () => go({ rating: q.get('rating') === String(r) ? null : r }) },
      h('span', { class: 'stars' }, stars(r)), ' & Up')),
    data.brands.length ? h('h4', null, 'Brands') : null,
    data.brands.map((b) => h('label', { class: 'inline' }, h('input', {
      type: 'checkbox', checked: brandsSel.includes(b.brand),
      onchange: (e) => {
        const next = e.target.checked ? [...brandsSel, b.brand] : brandsSel.filter((x) => x !== b.brand);
        go({ brand: next.join(',') || null });
      },
    }), `${b.brand} (${b.n})`)),
    h('h4', null, 'Price'),
    [[0, 500], [500, 1000], [1000, 5000], [5000, 20000], [20000, null]].map(([a, b]) =>
      h('button', { class: 'f', onclick: () => go({ min: a || null, max: b }) }, b ? `₹${a.toLocaleString('en-IN')} - ₹${b.toLocaleString('en-IN')}` : `Over ₹${a.toLocaleString('en-IN')}`)),
    h('div', { class: 'price-range' }, minIn, maxIn, h('button', { class: 'btn btn-sm', onclick: () => go({ min: minIn.value || null, max: maxIn.value || null }) }, 'Go')),
    h('h4', null, 'Deals & Discounts'),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: q.get('deals') === '1', onchange: (e) => go({ deals: e.target.checked ? '1' : null }) }), "Today's Deals"),
    h('p', null, h('a', { href: '#/s' }, 'Clear all filters')));

  const start = (data.page - 1) * data.pageSize + 1;
  const sortSel = h('select', { 'aria-label': 'Sort by', onchange: (e) => go({ sort: e.target.value }) },
    [['relevance', 'Featured'], ['price-asc', 'Price: Low to High'], ['price-desc', 'Price: High to Low'], ['rating', 'Avg. Customer Review'], ['newest', 'Newest Arrivals'], ['discount', 'Discount']]
      .map(([v, l]) => h('option', { value: v, selected: (q.get('sort') || 'relevance') === v }, l)));

  const pager = data.pages > 1 ? h('div', { class: 'pager' },
    h('button', { class: 'btn', disabled: data.page <= 1, onclick: () => go({ page: data.page - 1 }) }, '‹ Previous'),
    Array.from({ length: data.pages }, (_, i) => h('button', { class: 'btn' + (i + 1 === data.page ? ' cur' : ''), onclick: () => go({ page: i + 1 }) }, i + 1)),
    h('button', { class: 'btn', disabled: data.page >= data.pages, onclick: () => go({ page: data.page + 1 }) }, 'Next ›')) : null;

  mount(h('div', { class: 'search-layout' }, filters,
    h('section', null,
      h('div', { class: 'results-bar' },
        h('span', null, data.total ? `${start}-${Math.min(start + data.pageSize - 1, data.total)} of ${data.total} results for ` : 'No results for ', h('b', { class: 'err' }, heading)),
        h('label', { class: 'inline' }, 'Sort by: ', sortSel)),
      data.items.length ? h('div', { class: 'grid' }, data.items.map((p) => productCard(p)))
        : h('div', { class: 'card' }, h('h2', null, 'No results found'), h('p', null, 'Try checking your spelling or use more general terms.')),
      pager)));
}

async function viewProduct(id) {
  const data = await api('GET', `/products/${encodeURIComponent(id)}`);
  const p = data.product;
  pushRecent(p.id);
  document.title = `${p.title} : Bazaario.in`;
  const maxQty = Math.min(p.stock, state.config.maxQtyPerItem || 10);
  const qtySel = h('select', { 'aria-label': 'Quantity' }, Array.from({ length: Math.max(1, maxQty) }, (_, i) => h('option', { value: i + 1 }, i + 1)));

  const pin = store.get('pin', '');
  const pinIn = h('input', { value: pin, maxLength: 6, placeholder: 'Enter PIN code', inputMode: 'numeric', style: { width: '130px' } });
  const pinOut = h('div', { class: 'hint' });
  const checkPin = () => {
    if (!/^[1-9]\d{5}$/.test(pinIn.value)) { pinOut.className = 'err'; pinOut.textContent = 'Please enter a valid 6-digit PIN code.'; return; }
    store.set('pin', pinIn.value); renderHeader();
    pinOut.className = 'ok';
    pinOut.textContent = `Delivery to ${pinIn.value} by ${deliveryDate(p.express)}. Cash on Delivery available.`;
  };
  if (pin) setTimeout(checkPin);

  const coupons = [['WELCOME10', '10% off up to ₹200 on orders above ₹499'], ['SAVE100', '₹100 off on orders above ₹999'], ['FESTIVE15', '15% off up to ₹1,500 above ₹2,999']];

  const total = data.ratingDistribution.reduce((s, r) => s + r.n, 0);
  const distRows = [5, 4, 3, 2, 1].map((star) => {
    const n = (data.ratingDistribution.find((r) => r.rating === star) || { n: 0 }).n;
    const share = total ? Math.round((n / total) * 100) : 0;
    return h('div', { class: 'bar-row' }, h('span', null, `${star} star`), h('div', { class: 'bar' }, h('i', { style: { width: share + '%' } })), h('span', null, share + '%'));
  });

  const reviewForm = () => {
    if (!state.user) return h('p', null, h('a', { href: '#/login?next=' + encodeURIComponent(location.hash) }, 'Sign in'), ' to write a review.');
    if (!data.canReview) return h('p', { class: 'muted' }, 'Thank you — you have reviewed this product.');
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
    }, h('h3', null, 'Review this product'), h('div', { class: 'star-input' }, starBtns),
      h('label', null, 'Add a headline'), title, h('label', null, 'Add a written review'), body,
      h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Submit'));
  };

  const wishBtn = h('button', { class: 'btn btn-block', onclick: (e) => toggleWishlist(p, e.target) }, '♡ Add to Wish List');

  mount(
    h('p', { class: 'hint' }, h('a', { href: `#/s?category=${p.category}` }, p.category_name), ' › ', p.brand),
    h('div', { class: 'pdp' },
      h('div', null, h('div', { class: 'pdp-img', style: { background: p.color }, role: 'img', 'aria-label': p.title }, p.emoji)),
      h('div', null,
        h('h1', null, p.title),
        h('a', { href: `#/s?q=${encodeURIComponent(p.brand)}` }, `Visit the ${p.brand} Store`),
        h('div', null, `${p.rating_avg} `, h('span', { class: 'stars' }, stars(p.rating_avg)), ' ',
          h('a', { href: '#reviews', onclick: (e) => { e.preventDefault(); $('#reviews').scrollIntoView(); } }, `${p.rating_count.toLocaleString('en-IN')} ratings`)),
        h('div', { class: 'muted' }, `${p.sold_count.toLocaleString('en-IN')}+ bought in past month`),
        h('hr'),
        p.is_deal ? h('span', { class: 'badge badge-deal' }, 'Limited time deal') : null,
        priceBlock(p, true),
        h('div', null, 'Inclusive of all taxes'),
        h('div', { class: 'muted' }, `EMI starts at ${inr(Math.ceil(p.price / 12))}/month. No Cost EMI available.`),
        h('hr'),
        h('h3', null, '🏷️ Offers'),
        h('div', { class: 'offers' }, coupons.map(([c, d]) => h('div', { class: 'offer' }, h('b', null, 'Coupon ' + c), h('div', null, d)))),
        h('div', { class: 'trust' },
          h('div', null, h('span', null, '↩️'), `${state.config.returnWindowDays || 10} days Replacement`),
          h('div', null, h('span', null, '🚚'), 'Free Delivery'),
          h('div', null, h('span', null, '💵'), 'Pay on Delivery'),
          h('div', null, h('span', null, '🔒'), 'Secure transaction'),
          h('div', null, h('span', null, '🏆'), 'Top Brand')),
        h('hr'),
        h('h3', null, 'About this item'),
        h('ul', { class: 'features' }, p.features.map((f) => h('li', null, f))),
        h('p', null, p.description)),
      h('div', { class: 'buybox' },
        priceBlock(p),
        h('p', null, p.express ? h('b', null, '⚡ Express: FREE delivery Tomorrow') : `FREE delivery ${deliveryDate(false)}`),
        h('div', { style: { display: 'flex', gap: '6px' } }, pinIn, h('button', { class: 'btn btn-sm', onclick: checkPin }, 'Check')),
        pinOut,
        p.stock > 0 ? h('p', { class: 'ok', style: { fontSize: '18px' } }, p.stock < 10 ? `Only ${p.stock} left in stock.` : 'In stock')
          : h('p', { class: 'err', style: { fontSize: '18px' } }, 'Currently unavailable.'),
        h('p', { class: 'hint' }, 'Ships from & sold by Bazaario Retail'),
        p.stock > 0 ? [
          h('label', { class: 'inline' }, 'Quantity: ', qtySel),
          h('button', { class: 'btn btn-primary btn-block', onclick: () => addToCart(p, Number(qtySel.value)) }, 'Add to Cart'),
          h('button', { class: 'btn btn-buy btn-block', onclick: () => addToCart(p, Number(qtySel.value), true) }, 'Buy Now'),
        ] : null,
        h('p', { class: 'hint' }, '🔒 Secure transaction'),
        h('hr'), wishBtn)),
    h('section', { class: 'reviews', id: 'reviews' },
      h('div', null, h('h2', null, 'Customer reviews'),
        h('div', null, h('span', { class: 'stars', style: { fontSize: '20px' } }, stars(p.rating_avg)), ` ${p.rating_avg} out of 5`),
        h('p', { class: 'muted' }, `${p.rating_count.toLocaleString('en-IN')} global ratings`),
        distRows, h('hr'), reviewForm()),
      h('div', null, h('h3', null, 'Top reviews'),
        data.reviews.length ? data.reviews.map((r) => h('div', { class: 'review' },
          h('div', { class: 'who' }, h('span', { class: 'avatar' }, r.author[0].toUpperCase()), r.author),
          h('div', null, h('span', { class: 'stars' }, stars(r.rating)), ' ', h('b', null, r.title)),
          h('div', { class: 'hint' }, `Reviewed in India on ${fmtDate(r.created_at)}`),
          r.verified ? h('div', { style: { color: '#c45500', fontSize: '12px', fontWeight: 700 } }, 'Verified Purchase') : null,
          h('p', null, r.body))) : h('p', { class: 'muted' }, 'No written reviews yet. Be the first to review this product.'))),
    data.related.length ? h('div', { class: 'card row-card', style: { marginTop: '18px' } }, h('h2', null, 'Products related to this item'),
      h('div', { class: 'scroller' }, data.related.map((r) => productCard(r, { compact: true })))) : null);
}

// ---------- Cart ----------
async function viewCart() {
  let data;
  if (state.user) data = await api('GET', '/cart');
  else {
    const items = guestCart();
    const prods = await Promise.all(items.map((i) => api('GET', `/products/${i.productId}`).then((d) => d.product).catch(() => null)));
    const lines = items.map((i, k) => prods[k] && { product_id: i.productId, qty: Math.min(i.qty, prods[k].stock), ...prods[k] }).filter(Boolean);
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
    h('a', { href: `#/p/${l.product_id}` }, h('div', { class: 'pimg', style: { background: l.color } }, l.emoji)),
    h('div', null,
      h('a', { href: `#/p/${l.product_id}`, style: { color: 'var(--text)', fontSize: '17px' } }, l.title),
      l.stock > 0 ? h('div', { class: 'ok' }, l.stock < 10 ? `Only ${l.stock} left in stock` : 'In stock') : h('div', { class: 'err' }, 'Out of stock'),
      h('div', { class: 'hint' }, 'Eligible for FREE Shipping'),
      h('div', { class: 'line-actions' },
        saved ? null : h('select', { 'aria-label': 'Quantity', onchange: (e) => setQty(l, Number(e.target.value)) },
          Array.from({ length: Math.max(1, Math.min(l.stock, state.config.maxQtyPerItem || 10)) }, (_, i) =>
            h('option', { value: i + 1, selected: i + 1 === l.qty }, `Qty: ${i + 1}`))),
        h('span', { class: 'sep' }, '|'),
        h('button', { class: 'link-btn', onclick: () => remove(l) }, 'Delete'),
        h('span', { class: 'sep' }, '|'),
        h('button', { class: 'link-btn', onclick: () => saveLater(l, !saved) }, saved ? 'Move to cart' : 'Save for later'))),
    h('div', { style: { textAlign: 'right' } }, h('b', { class: 'price-sm' }, inr(l.price)),
      l.mrp > l.price ? h('div', { class: 'mrp hint' }, inr(l.mrp)) : null));

  const remaining = data.freeShippingThreshold - data.subtotal;
  const summary = h('div', { class: 'card' },
    data.lines.length ? (remaining > 0
      ? h('div', null, h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, (data.subtotal / data.freeShippingThreshold) * 100)}%` } })),
        h('p', { class: 'hint' }, `Add ${inr(remaining)} of eligible items to get FREE delivery.`))
      : h('p', { class: 'ok' }, '✔ Your order is eligible for FREE Delivery.')) : null,
    h('p', { style: { fontSize: '18px' } }, `Subtotal (${data.count} item${data.count === 1 ? '' : 's'}): `, h('b', null, inr(data.subtotal))),
    h('button', {
      class: 'btn btn-primary btn-block', disabled: !data.lines.length,
      onclick: () => { location.hash = state.user ? '#/checkout' : '#/login?next=%23%2Fcheckout'; },
    }, 'Proceed to Buy'));

  mount(h('div', { class: 'two-col' },
    h('div', null,
      h('div', { class: 'card' },
        h('h1', null, data.lines.length ? 'Shopping Cart' : 'Your Bazaario Cart is empty'),
        data.lines.length ? h('div', { class: 'hint', style: { textAlign: 'right' } }, 'Price') : h('p', null, h('a', { href: '#/s?deals=1' }, "Shop today's deals")),
        data.lines.map((l) => line(l, false)),
        data.lines.length ? h('p', { style: { textAlign: 'right', fontSize: '18px' } }, `Subtotal (${data.count} items): `, h('b', null, inr(data.subtotal))) : null,
        state.user ? null : h('p', null, h('a', { class: 'btn btn-primary', href: '#/login?next=%23%2Fcart' }, 'Sign in to your account'), ' ',
          h('a', { class: 'btn', href: '#/register' }, 'Sign up now'))),
      data.saved.length ? h('div', { class: 'card', style: { marginTop: '18px' } }, h('h2', null, `Saved for later (${data.saved.length} item${data.saved.length === 1 ? '' : 's'})`),
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

  const sel = { addressId: (addresses.find((a) => a.is_default) || addresses[0] || {}).id, method: 'upi', coupon: '' };
  const idempotencyKey = crypto.randomUUID();
  const summaryBox = h('div', { class: 'card summary' });
  const errBox = h('div', { class: 'alert alert-err hidden' });

  const refreshQuote = async () => {
    try {
      const q = await api('POST', '/checkout/quote', { coupon: sel.coupon || undefined, paymentMethod: sel.method });
      summaryBox.replaceChildren(
        placeBtn,
        h('p', { class: 'hint', style: { textAlign: 'center' } }, 'By placing your order, you agree to Bazaario\'s privacy notice and conditions of use.'),
        h('hr'), h('h3', null, 'Order Summary'),
        h('dl', null,
          h('dt', null, 'Items:'), h('dd', null, inr(q.subtotal)),
          h('dt', null, 'Delivery:'), h('dd', null, q.shipping ? inr(q.shipping) : 'FREE'),
          q.discount ? [h('dt', null, `Coupon (${q.coupon}):`), h('dd', { class: 'ok' }, '-' + inr(q.discount))] : null,
          h('dt', { class: 'total' }, 'Order Total:'), h('dd', { class: 'total' }, inr(q.total))),
        q.savings > 0 ? h('p', { class: 'ok' }, `Your Savings: ${inr(q.savings)}`) : null);
      return true;
    } catch (e) {
      if (sel.coupon) { sel.coupon = ''; couponIn.value = ''; fail(e); return refreshQuote(); }
      fail(e); return false;
    }
  };

  // Address step
  const addrList = h('div', null, addresses.map((a) => h('label', { class: 'addr-opt' + (a.id === sel.addressId ? ' sel' : '') },
    h('input', { type: 'radio', name: 'addr', checked: a.id === sel.addressId, onchange: (e) => {
      sel.addressId = a.id;
      addrList.querySelectorAll('.addr-opt').forEach((x) => x.classList.remove('sel'));
      e.target.closest('.addr-opt').classList.add('sel');
    } }),
    h('span', null, h('b', null, a.full_name), ` ${a.line1}, ${a.line2 ? a.line2 + ', ' : ''}${a.city}, ${a.state}, ${a.pincode}, India · Phone: ${a.phone}`))));
  const newAddr = h('div', { class: addresses.length ? 'hidden' : '' }, addressForm(() => route()));

  // Payment step
  const card = { number: h('input', { inputMode: 'numeric', maxLength: 23, autocomplete: 'cc-number', placeholder: '1234 5678 9012 3456' }),
    expiry: h('input', { placeholder: 'MM/YY', maxLength: 5, autocomplete: 'cc-exp' }),
    cvv: h('input', { type: 'password', inputMode: 'numeric', maxLength: 4, autocomplete: 'cc-csc', placeholder: 'CVV' }) };
  const upi = h('input', { placeholder: 'yourname@bank', maxLength: 100 });
  const payFields = {
    upi: h('div', { class: 'pay-fields' }, h('label', null, 'UPI ID'), upi, h('p', { class: 'hint' }, 'You will receive a payment request on your UPI app.')),
    card: h('div', { class: 'pay-fields hidden' }, h('label', null, 'Card number'), card.number,
      h('div', { class: 'form-grid' }, h('div', null, h('label', null, 'Expiry'), card.expiry), h('div', null, h('label', null, 'CVV'), card.cvv)),
      h('p', { class: 'hint' }, '🔒 Card details are validated and only the last 4 digits are kept. Demo mode — no real charge. Test card: 4111 1111 1111 1111')),
    cod: h('div', { class: 'pay-fields hidden' }, h('p', { class: 'hint' }, 'Pay with cash or UPI when your order is delivered. Available for orders up to ₹50,000.')),
  };
  const payOpt = (m, label) => h('div', null, h('label', { class: 'inline' },
    h('input', { type: 'radio', name: 'pay', value: m, checked: sel.method === m, onchange: () => {
      sel.method = m;
      Object.entries(payFields).forEach(([k, el]) => el.classList.toggle('hidden', k !== m));
      refreshQuote();
    } }), h('b', null, label)), payFields[m]);

  const couponIn = h('input', { placeholder: 'Enter coupon code', maxLength: 20, style: { width: '200px' } });

  const placeBtn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
    errBox.classList.add('hidden');
    if (!sel.addressId) { errBox.textContent = 'Please add a delivery address.'; errBox.classList.remove('hidden'); return; }
    const payment = sel.method === 'card' ? { cardNumber: card.number.value, expiry: card.expiry.value, cvv: card.cvv.value }
      : sel.method === 'upi' ? { upiId: upi.value } : {};
    placeBtn.disabled = true;
    placeBtn.textContent = 'Placing your order…';
    try {
      const r = await api('POST', '/orders', { addressId: sel.addressId, paymentMethod: sel.method, coupon: sel.coupon || undefined, payment, idempotencyKey });
      card.number.value = ''; card.cvv.value = '';
      await updateCartCount();
      location.hash = `#/orders/${r.orderId}?placed=1`;
    } catch (e) {
      errBox.textContent = e.message; errBox.classList.remove('hidden');
      placeBtn.disabled = false; placeBtn.textContent = 'Place your order';
      window.scrollTo(0, 0);
    }
  } }, 'Place your order');

  mount(h('h1', null, 'Checkout'), errBox,
    h('div', { class: 'two-col' },
      h('div', null,
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '1'), 'Select a delivery address'),
          addrList,
          addresses.length ? h('button', { class: 'link-btn', onclick: () => newAddr.classList.toggle('hidden') }, '+ Add a new address') : null,
          newAddr),
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '2'), 'Payment method'),
          payOpt('upi', 'UPI (Google Pay, PhonePe, Paytm & more)'), payOpt('card', 'Credit or debit card'), payOpt('cod', 'Cash on Delivery / Pay on Delivery'),
          h('hr'), h('label', null, 'Apply a coupon'),
          h('div', { style: { display: 'flex', gap: '8px' } }, couponIn, h('button', { class: 'btn', onclick: async () => {
            sel.coupon = couponIn.value.trim();
            if (await refreshQuote() && sel.coupon) toast(`Coupon ${sel.coupon.toUpperCase()} applied!`);
          } }, 'Apply')),
          h('p', { class: 'hint' }, 'Try WELCOME10, SAVE100 or FESTIVE15')),
        h('div', { class: 'step' }, h('h2', null, h('span', { class: 'n' }, '3'), 'Review items and delivery'),
          cart.lines.map((l) => h('div', { class: 'order-item' }, h('div', { class: 'pimg', style: { background: l.color } }, l.emoji),
            h('div', null, h('b', null, l.title), h('div', { class: 'price-sm', style: { color: 'var(--price)' } }, inr(l.price)), h('div', null, `Qty: ${l.qty}`),
              h('div', { class: 'ok' }, `Delivery: ${deliveryDate(l.express)}`)))))),
      summaryBox));
  await refreshQuote();
}

// ---------- Orders ----------
function orderCard(o) {
  return h('div', { class: 'order' },
    h('div', { class: 'order-head' },
      h('div', null, 'ORDER PLACED', h('b', null, fmtDate(o.created_at))),
      h('div', null, 'TOTAL', h('b', null, inr(o.total))),
      h('div', null, 'PAYMENT', h('b', null, `${o.payment_method.toUpperCase()} · ${o.payment_status}`)),
      h('div', { class: 'right' }, `ORDER # ${o.order_no}`, h('b', null, h('a', { href: `#/orders/${o.id}` }, 'View order details')))),
    h('div', { class: 'order-body' },
      h('div', { class: `status ${o.status}` }, STATUS_LABEL[o.status]),
      o.items.map((it) => h('div', { class: 'order-item' },
        h('a', { href: `#/p/${it.product_id}` }, h('div', { class: 'pimg', style: { background: '#f3f3f3' } }, it.emoji)),
        h('div', null, h('a', { href: `#/p/${it.product_id}` }, it.title), h('div', { class: 'hint' }, `Qty ${it.qty} · ${inr(it.price)}`),
          h('button', { class: 'btn btn-sm btn-primary', onclick: async () => addToCart({ id: it.product_id, title: it.title, stock: 10 }) }, '↻ Buy it again'))))));
}

async function viewOrders() {
  if (!state.user) { location.hash = '#/login?next=%23%2Forders'; return; }
  const { orders } = await api('GET', '/orders');
  mount(h('h1', null, 'Your Orders'),
    orders.length ? orders.map(orderCard) : h('div', { class: 'card' }, h('p', null, 'You have not placed any orders yet. '), h('a', { href: '#/' }, 'Continue shopping')));
}

async function viewOrder(id, params) {
  if (!state.user) { location.hash = '#/login'; return; }
  const { order: o } = await api('GET', `/orders/${encodeURIComponent(id)}`);
  const steps = ['placed', 'packed', 'shipped', 'delivered'];
  const reached = steps.indexOf(o.status);
  const act = async (path, confirmMsg) => {
    if (!confirm(confirmMsg)) return;
    try { await api('POST', `/orders/${o.id}/${path}`); toast('Request submitted.'); route(); } catch (e) { fail(e); }
  };
  mount(
    new URLSearchParams(params).get('placed') ? h('div', { class: 'alert alert-ok' }, h('b', null, '✔ Order placed, thank you!'),
      ` Confirmation will be sent to ${state.user.email}. Order # ${o.order_no}`) : null,
    h('p', null, h('a', { href: '#/orders' }, '‹ Your Orders')),
    h('h1', null, 'Order Details'),
    h('p', { class: 'muted' }, `Ordered on ${fmtDate(o.created_at)} | Order# ${o.order_no}`),
    h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        h('div', null, h('h3', null, 'Shipping Address'), h('div', null, o.address.fullName), h('div', null, o.address.line1),
          o.address.line2 ? h('div', null, o.address.line2) : null, h('div', null, `${o.address.city}, ${o.address.state} ${o.address.pincode}`), h('div', null, `Phone: ${o.address.phone}`)),
        h('div', { class: 'summary' }, h('h3', null, 'Order Summary'),
          h('dl', null,
            h('dt', null, 'Item(s) Subtotal:'), h('dd', null, inr(o.subtotal)),
            h('dt', null, 'Shipping:'), h('dd', null, inr(o.shipping)),
            o.discount ? [h('dt', null, `Promotion (${o.coupon_code}):`), h('dd', null, '-' + inr(o.discount))] : null,
            h('dt', { class: 'total' }, 'Grand Total:'), h('dd', { class: 'total' }, inr(o.total))),
          h('p', { class: 'hint' }, `Payment: ${o.payment_method.toUpperCase()} (${o.payment_status})${o.payment_ref ? ' · Ref ' + o.payment_ref : ''}`)))),
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: `status ${o.status}` }, STATUS_LABEL[o.status]),
      reached >= 0 ? h('div', { class: 'tracker' }, steps.map((s, i) => h('div', { class: i <= reached ? 'done' : '' }, STATUS_LABEL[s]))) : null,
      o.items.map((it) => h('div', { class: 'order-item' }, h('div', { class: 'pimg', style: { background: '#f3f3f3' } }, it.emoji),
        h('div', null, h('a', { href: `#/p/${it.product_id}` }, it.title), h('div', null, `Qty: ${it.qty} · `, h('b', { style: { color: 'var(--price)' } }, inr(it.price))),
          o.status === 'delivered' ? h('a', { class: 'btn btn-sm', href: `#/p/${it.product_id}#reviews` }, 'Write a product review') : null))),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px' } },
        ['placed', 'packed'].includes(o.status) ? h('button', { class: 'btn', onclick: () => act('cancel', 'Cancel this order?') }, 'Cancel order') : null,
        o.status === 'delivered' ? h('button', { class: 'btn', onclick: () => act('return', 'Request a return for this order?') }, 'Return or replace items') : null)));
}

// ---------- Wishlist ----------
async function viewWishlist() {
  if (!state.user) { location.hash = '#/login?next=%23%2Fwishlist'; return; }
  const { items } = await api('GET', '/wishlist');
  mount(h('h1', null, 'Your Wish List'),
    items.length ? h('div', { class: 'grid' }, items.map((p) => {
      const c = productCard(p);
      c.append(h('button', { class: 'link-btn', onclick: async () => { await api('DELETE', `/wishlist/${p.id}`).catch(fail); route(); } }, 'Remove from list'));
      return c;
    })) : h('div', { class: 'card' }, h('p', null, 'Your Wish List is empty. Tap ♡ on any product to save it here.')));
}

// ---------- Auth ----------
function viewLogin(params) {
  if (state.user) { location.hash = '#/'; return; }
  const next = new URLSearchParams(params).get('next');
  const safeNext = next && next.startsWith('#/') ? next : '#/';
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', maxLength: 254 });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', maxLength: 128 });
  const err = h('div', { class: 'alert alert-err hidden', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block' }, 'Sign in');
  mount(h('div', { class: 'auth' },
    h('a', { class: 'logo-dark', href: '#/' }, 'bazaario.in'),
    h('div', { class: 'card' }, h('h1', null, 'Sign in'), err,
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); err.classList.add('hidden'); btn.disabled = true;
        try { await afterLogin(await api('POST', '/auth/login', { email: email.value, password: pw.value }), safeNext); }
        catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; pw.value = ''; }
      } }, h('label', null, 'Email'), email, h('label', null, 'Password'), pw, btn),
      h('p', { class: 'hint' }, 'By continuing, you agree to Bazaario\'s Conditions of Use and Privacy Notice.')),
    h('div', { class: 'divider' }, h('span', null, 'New to Bazaario?')),
    h('a', { class: 'btn btn-block', href: '#/register' + (next ? '?next=' + encodeURIComponent(next) : '') }, 'Create your Bazaario account')));
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
    h('a', { class: 'logo-dark', href: '#/' }, 'bazaario.in'),
    h('div', { class: 'card' }, h('h1', null, 'Create Account'), err,
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
      h('label', null, 'Password'), pw, h('div', { class: 'hint' }, 'ⓘ Passwords must be at least 8 characters with letters and numbers.'),
      h('label', null, 'Re-enter password'), pw2,
      h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '14px' } }, 'Continue')),
      h('p', { class: 'hint' }, 'Already have an account? ', h('a', { href: '#/login' }, 'Sign in ›')))));
}

// ---------- Account ----------
async function viewAccount() {
  if (!state.user) { location.hash = '#/login?next=%23%2Faccount'; return; }
  const tile = (href, icon, title, desc) => h('a', { class: 'acc-tile', href }, h('span', { class: 'ic' }, icon), h('div', null, h('h3', null, title), h('div', { class: 'hint' }, desc)));
  mount(h('h1', null, 'Your Account'),
    h('div', { class: 'acc-grid' },
      tile('#/orders', '📦', 'Your Orders', 'Track, return, or buy things again'),
      tile('#/security', '🔐', 'Login & security', 'Edit name, mobile number and password'),
      tile('#/addresses', '📍', 'Your Addresses', 'Edit addresses for orders'),
      tile('#/wishlist', '♡', 'Your Lists', 'View and manage your Wish List'),
      tile('#/s?deals=1', '🏷️', "Today's Deals", 'Limited time offers'),
      state.user.role === 'admin' ? tile('#/admin', '🛠️', 'Seller / Admin Central', 'Products, orders, customers, coupons') : null),
    h('p', null, h('button', { class: 'btn', onclick: logout }, 'Sign Out')));
}

async function viewSecurity() {
  if (!state.user) { location.hash = '#/login'; return; }
  const name = h('input', { value: state.user.name, maxLength: 60, required: true });
  const phone = h('input', { value: state.user.phone || '', maxLength: 10, pattern: '[6-9][0-9]{9}', inputMode: 'numeric' });
  const cur = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const np = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password' });
  mount(h('h1', null, 'Login & Security'),
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
      h('div', { class: 'card' }, h('h3', null, '🔒 Your security'),
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
  mount(h('h1', null, 'Your Addresses'), formBox,
    h('div', { class: 'acc-grid' },
      h('button', { class: 'acc-tile', style: { justifyContent: 'center', alignItems: 'center', minHeight: '180px', cursor: 'pointer', fontSize: '18px' }, onclick: () => openForm() }, '＋ Add address'),
      addresses.map((a) => h('div', { class: 'acc-tile', style: { flexDirection: 'column', gap: '2px' } },
        a.is_default ? h('div', { class: 'hint' }, 'Default') : null,
        h('b', null, a.full_name), h('div', null, a.line1), a.line2 ? h('div', null, a.line2) : null,
        h('div', null, `${a.city}, ${a.state} ${a.pincode}`), h('div', null, `Phone: ${a.phone}`),
        h('div', { class: 'line-actions' },
          h('button', { class: 'link-btn', onclick: () => openForm(a) }, 'Edit'), h('span', { class: 'sep' }, '|'),
          h('button', { class: 'link-btn', onclick: async () => { if (confirm('Remove this address?')) { await api('DELETE', `/addresses/${a.id}`).catch(fail); route(); } } }, 'Remove'))))));
}

// ---------- Admin ----------
async function viewAdmin(params) {
  if (!state.user) { location.hash = '#/login?next=%23%2Fadmin'; return; }
  if (state.user.role !== 'admin') { mount(h('div', { class: 'card' }, h('h1', null, 'Access denied'), h('p', null, 'This area is restricted to store administrators.'))); return; }
  const tab = new URLSearchParams(params).get('tab') || 'dashboard';
  const tabs = h('div', { class: 'tabs' }, [['dashboard', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'], ['customers', 'Customers'], ['coupons', 'Coupons'], ['audit', 'Audit log']]
    .map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { location.hash = `#/admin?tab=${k}`; } }, l)));
  const body = h('div');
  mount(h('h1', null, '🛠️ Seller Central'), tabs, body);

  if (tab === 'dashboard') {
    const s = await api('GET', '/admin/stats');
    body.append(h('div', { class: 'stats' },
      [['Revenue', inr(s.revenue)], ['Orders', s.orders], ['Open orders', s.pending], ['Customers', s.customers], ['Active products', s.products]]
        .map(([l, val]) => h('div', { class: 'stat' }, h('span', { class: 'hint' }, l), h('b', null, val)))),
    h('div', { class: 'card' }, h('h3', null, '⚠️ Low stock (under 20)'),
      s.lowStock.length ? h('table', null, h('tr', null, h('th', null, 'Product'), h('th', null, 'Stock')),
        s.lowStock.map((p) => h('tr', null, h('td', null, p.title), h('td', { class: 'err' }, p.stock)))) : h('p', { class: 'muted' }, 'All products are well stocked.')));
  }

  if (tab === 'orders') {
    const { orders, transitions } = await api('GET', '/admin/orders');
    body.append(h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Order #', 'Date', 'Customer', 'Total', 'Payment', 'Status', 'Update'].map((t) => h('th', null, t))),
      orders.map((o) => h('tr', null, h('td', null, o.order_no), h('td', null, fmtDate(o.created_at)), h('td', null, o.customer, h('div', { class: 'hint' }, o.email)),
        h('td', null, inr(o.total)), h('td', null, `${o.payment_method.toUpperCase()} · ${o.payment_status}`), h('td', null, STATUS_LABEL[o.status]),
        h('td', null, transitions[o.status].length ? h('select', { onchange: async (e) => {
          if (!e.target.value) return;
          try { await api('PATCH', `/admin/orders/${o.id}`, { status: e.target.value }); toast('Order updated.'); route(); } catch (ex) { fail(ex); }
        } }, h('option', { value: '' }, 'Move to…'), transitions[o.status].map((t) => h('option', { value: t }, STATUS_LABEL[t]))) : '—'))))));
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
      const [deal, dealL] = chk("Today's Deal", p ? !!p.is_deal : false);
      const [act, actL] = chk('Active (visible in store)', p ? !!p.active : true);
      formBox.replaceChildren(h('h3', null, p ? `Edit product #${p.id}` : 'Add a product'),
        h('form', { onsubmit: async (e) => {
          e.preventDefault();
          const payload = { title: f.title.value, brand: f.brand.value, categoryId: Number(catSel.value), price: Number(f.price.value), mrp: Number(f.mrp.value),
            stock: Number(f.stock.value), emoji: f.emoji.value, color: f.color.value, description: f.description.value, features: f.features.value,
            express: exp.checked, isDeal: deal.checked, active: act.checked };
          try { if (p) await api('PUT', `/admin/products/${p.id}`, payload); else await api('POST', '/admin/products', payload); toast('Product saved.'); route(); } catch (ex) { fail(ex); }
        } }, h('div', { class: 'form-grid' },
          inp('title', 'Title', { value: p ? p.title : '', required: true, maxLength: 200, full: true }),
          inp('brand', 'Brand', { value: p ? p.brand : '', required: true, maxLength: 60 }),
          h('div', null, h('label', null, 'Category'), catSel),
          inp('price', 'Selling price (₹)', { type: 'number', min: 1, value: p ? p.price / 100 : '', required: true }),
          inp('mrp', 'MRP (₹)', { type: 'number', min: 1, value: p ? p.mrp / 100 : '', required: true }),
          inp('stock', 'Stock', { type: 'number', min: 0, value: p ? p.stock : 0, required: true }),
          inp('emoji', 'Icon (emoji)', { value: p ? p.emoji : '📦', maxLength: 8 }),
          inp('color', 'Background colour', { type: 'color', value: p ? p.color : '#e3e6e6' }),
          inp('description', 'Description', { tag: 'textarea', rows: 3, value: p ? p.description : '', maxLength: 4000, full: true }),
          inp('features', 'Key features (one per line)', { tag: 'textarea', rows: 4, value: p ? p.features.join('\n') : '', full: true })),
        expL, dealL, actL, h('button', { class: 'btn btn-primary' }, 'Save product'), ' ',
        h('button', { type: 'button', class: 'btn', onclick: () => formBox.classList.add('hidden') }, 'Cancel')));
      formBox.classList.remove('hidden');
      formBox.scrollIntoView();
    };
    body.append(h('p', null, h('button', { class: 'btn btn-dark', onclick: () => openForm() }, '＋ Add a product')), formBox,
      h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['', 'Product', 'Category', 'Price', 'MRP', 'Stock', 'Status', ''].map((t) => h('th', null, t))),
        products.map((p) => h('tr', null, h('td', null, p.emoji), h('td', null, h('a', { href: `#/p/${p.id}` }, p.title), h('div', { class: 'hint' }, p.brand)),
          h('td', null, p.category_name), h('td', null, inr(p.price)), h('td', null, inr(p.mrp)),
          h('td', { class: p.stock < 20 ? 'err' : '' }, p.stock), h('td', null, p.active ? 'Active' : 'Inactive'),
          h('td', null, h('button', { class: 'btn btn-sm', onclick: () => openForm(p) }, 'Edit')))))));
  }

  if (tab === 'customers') {
    const { users } = await api('GET', '/admin/users');
    body.append(h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Name', 'Email', 'Mobile', 'Role', 'Orders', 'Joined', 'Status'].map((t) => h('th', null, t))),
      users.map((u) => h('tr', null, h('td', null, u.name), h('td', null, u.email), h('td', null, u.phone || '—'), h('td', null, u.role),
        h('td', null, u.orders), h('td', null, fmtDate(u.created_at)), h('td', null, u.locked_until > Date.now() ? '🔒 Locked' : 'Active'))))));
  }

  if (tab === 'coupons') {
    const { coupons } = await api('GET', '/admin/coupons');
    const code = h('input', { required: true, maxLength: 20, pattern: '[A-Za-z0-9]+' });
    const kind = h('select', null, h('option', { value: 'percent' }, 'Percent'), h('option', { value: 'flat' }, 'Flat ₹'));
    const value = h('input', { type: 'number', required: true, min: 1 });
    const maxD = h('input', { type: 'number', min: 1, placeholder: 'Optional' });
    const minO = h('input', { type: 'number', min: 0, value: 0 });
    const desc = h('input', { maxLength: 200 });
    body.append(h('div', { class: 'card', style: { marginBottom: '16px' } }, h('h3', null, 'Create / update coupon'),
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
        h('td', null, c.active ? h('button', { class: 'btn btn-sm', onclick: async () => { await api('DELETE', `/admin/coupons/${encodeURIComponent(c.code)}`).catch(fail); route(); } }, 'Disable') : null)))));
  }

  if (tab === 'audit') {
    const { entries } = await api('GET', '/admin/audit');
    body.append(h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Time', 'User', 'Action', 'Detail', 'IP'].map((t) => h('th', null, t))),
      entries.map((a) => h('tr', null, h('td', null, new Date(a.created_at).toLocaleString('en-IN')), h('td', null, a.email || '—'),
        h('td', null, a.action), h('td', { class: 'hint' }, a.detail || ''), h('td', null, a.ip))))));
  }
}

// ---------- Static info pages ----------
const PAGES = {
  about: ['About Bazaario', 'Bazaario is an online marketplace offering millions of products across categories with fast delivery, easy returns and secure payments.'],
  careers: ['Careers', 'We are hiring engineers, designers and operations specialists across India.'],
  press: ['Press Releases', 'For media enquiries please contact press@bazaario.example.'],
  sell: ['Sell on Bazaario', 'Reach crores of customers. Register as a seller, list products, and let us handle delivery and payments.'],
  affiliate: ['Become an Affiliate', 'Earn up to 10% commission by recommending products to your audience.'],
  ads: ['Advertise Your Products', 'Sponsored product listings help shoppers discover your brand.'],
  protection: ['100% Purchase Protection', 'Secure payments, genuine products and easy returns — or your money back.'],
  help: ['Help', 'Track orders from Your Orders, request returns within the return window, and manage addresses from Your Account.'],
  privacy: ['Privacy Notice', 'We collect only the data needed to process your orders. Passwords are hashed, card numbers are never stored, and session cookies are HttpOnly.'],
  terms: ['Conditions of Use', 'By using Bazaario you agree to our terms of sale, return policy and acceptable use policy.'],
  returns: ['Return Policy', 'Most items can be returned within 10 days of delivery for a full refund to the original payment method.'],
};
function viewPage(slug) {
  const p = PAGES[slug];
  mount(h('div', { class: 'card' }, h('h1', null, p ? p[0] : 'Page not found'), h('p', null, p ? p[1] : 'The page you requested does not exist.')));
}

// ---------------- Router ----------------
async function route() {
  state.timers.forEach(clearInterval);
  state.timers = [];
  document.title = 'Bazaario - Online Shopping for Everything';
  const [raw = '/', anchor] = location.hash.slice(1).split('#');
  const [path, query = ''] = (raw || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const routes = {
    '': () => viewHome(),
    s: () => viewSearch(query),
    p: () => viewProduct(parts[1]),
    cart: () => viewCart(),
    checkout: () => viewCheckout(),
    orders: () => (parts[1] ? viewOrder(parts[1], query) : viewOrders()),
    wishlist: () => viewWishlist(),
    login: () => viewLogin(query),
    register: () => viewRegister(query),
    account: () => viewAccount(),
    security: () => viewSecurity(),
    addresses: () => viewAddresses(),
    admin: () => viewAdmin(query),
    page: () => viewPage(parts[1]),
  };
  const view = routes[parts[0] || ''];
  if (!view) { viewPage('missing'); return; }
  try {
    await view();
    const target = anchor && document.getElementById(anchor);
    if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
  } catch (e) {
    if (e.status === 401) { location.hash = '#/login?next=' + encodeURIComponent('#' + raw); return; }
    mount(h('div', { class: 'card' }, h('h1', null, e.status === 404 ? 'Sorry! We couldn\'t find that page' : 'Something went wrong'),
      h('p', null, e.message), h('a', { href: '#/' }, 'Go to the Bazaario home page')));
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
      list.replaceChildren(...suggestions.map((s) => h('li', { onmousedown: () => { list.hidden = true; input.value = ''; location.hash = `#/p/${s.id}`; } }, '🔍 ', s.title)));
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
    $('#modal-body').replaceChildren(h('h3', null, 'Choose your location'),
      h('p', { class: 'hint' }, 'Delivery options and delivery speeds may vary for different locations.'),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        if (!/^[1-9]\d{5}$/.test(pin.value)) { err.textContent = 'Please enter a valid PIN code.'; return; }
        store.set('pin', pin.value); renderHeader(); modal.close(); toast(`Delivering to ${pin.value}`);
      } }, pin, err, h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn btn-primary' }, 'Apply'), h('button', { type: 'button', class: 'btn', onclick: () => modal.close() }, 'Cancel'))));
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
  state.categories.forEach((c) => sub.append(h('a', { href: `#/s?category=${c.slug}` }, c.name)));
  sub.append(h('a', { href: '#/page/sell' }, 'Sell'), h('a', { href: '#/page/help' }, 'Customer Service'));
  $('#back-top').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo(0, 0); });
  setupSearch();
  setupDeliver();
  renderHeader();
  window.addEventListener('hashchange', route);
  route();
}

init();
