/* Bazaario Express: partner shops near the buyer, the Shop Partner app, live rider tracking and the Studio Express board.
 * Loaded after app.js and seller.js and uses their helpers (h, fill, api, inr, route, applyForm). */
'use strict';

const minsText = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const clock = (ts) => new Date(ts).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const hourText = (hr) => (hr === 24 ? 'midnight' : `${hr % 12 || 12} ${hr < 12 ? 'am' : 'pm'}`);

// ---------------- Product page and bag ----------------
/** "Express near you": partner shops that can bring this item to the buyer's PIN code, nearest first. */
function expressNear(p, list) {
  if (!list.length) return null;
  const open = list.filter((n) => n.ok);
  return h('div', { class: 'near' },
    h('div', { class: 'near-head' }, h('b', null, 'Express near you'), h('span', { class: 'hint' }, open.length ? 'From a partner shop in your area' : 'Partner shops nearby are closed now')),
    list.map((n) => h('div', { class: 'near-row' + (n.ok ? '' : ' near-off') },
      h('div', null, h('b', { class: 'now-sm' }, inr(n.price)), ' ', h('span', null, n.sellerName),
        h('div', { class: 'hint' }, n.ok ? `Arrives in about ${minsText(n.mins)} · ${n.km} km away` : n.reason)),
      n.ok ? h('button', { class: 'btn btn-outline btn-sm', onclick: () => addToCart({ ...p, price: n.price, stock: n.stock }, 1, false, n.offerId) }, 'Add from this shop') : null)));
}

/** Bag line: how a partner shop line arrives, or a nearby shop that could bring it faster. */
function cartExpress(l, update) {
  if (l.lane === 'shop' && l.shop && l.shop.mins) {
    return h('div', { class: 'ok small' }, `Express from this shop · about ${minsText(l.shop.mins)} · ${l.shop.km} km away`);
  }
  if (l.lane === 'shop') return h('div', { class: 'hint' }, 'Express from a partner shop. Add your PIN code to see the delivery time.');
  if (!l.nearby) return null;
  const n = l.nearby;
  return h('div', { class: 'near-switch' }, h('span', { class: 'small' }, `Get it in about ${minsText(n.mins)} from ${n.sellerName} for ${inr(n.price)}`),
    h('button', { class: 'link-btn', onclick: () => update(() => api('POST', '/cart', { productId: l.product_id, qty: l.qty, offerId: n.offerId })) }, 'Switch to Express'));
}

// ---------------- Live tracking on the order page ----------------
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, val] of Object.entries(attrs || {})) if (val !== null && val !== undefined) el.setAttribute(k, val);
  for (const c of kids.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/**
 * A schematic map of the trip: where the rider started, the shop or city store, the buyer's home and the rider now.
 * Drawn as SVG from the route points (no map tiles, so nothing loads from outside Bazaario).
 */
function tripMap(route, at, phase) {
  const W = 360;
  const H = 210;
  const pad = 34;
  const picked = phase !== 'to_pickup' && phase !== 'at_pickup';
  // Once the parcel is collected, the map zooms to the trip from the shop to the buyer.
  const pts = [picked ? null : route.start, route.shop, route.home, at].filter(Boolean);
  const lats = pts.map((x) => x.lat);
  const lngs = pts.map((x) => x.lng);
  const cosLat = Math.cos((route.home.lat * Math.PI) / 180);
  const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * cosLat, 0.004);
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 0.004);
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const cx = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  const cy = (Math.max(...lats) + Math.min(...lats)) / 2;
  const xy = (p) => [W / 2 + (p.lng - cx) * cosLat * scale, H / 2 - (p.lat - cy) * scale];
  const [sx, sy] = xy(route.start);
  const [px, py] = xy(route.shop);
  const [hx, hy] = xy(route.home);
  const [rx, ry] = at ? xy(at) : [px, py];
  // 1 km scale bar.
  const km = scale / 111.32;
  const bar = Math.min(km, 120);
  const grid = [];
  for (let gx = 0; gx <= W; gx += 30) grid.push(svg('line', { x1: gx, y1: 0, x2: gx, y2: H, class: 'map-grid' }));
  for (let gy = 0; gy <= H; gy += 30) grid.push(svg('line', { x1: 0, y1: gy, x2: W, y2: gy, class: 'map-grid' }));
  const label = (x, y, text, anchor = 'middle') => svg('text', { x, y, 'text-anchor': anchor, class: 'map-label' }, text);
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trip-map', role: 'img', 'aria-label': `Map: rider ${picked ? 'on the way to you' : 'on the way to the shop'}` },
    svg('rect', { x: 0, y: 0, width: W, height: H, class: 'map-bg' }), grid,
    picked ? null : svg('line', { x1: sx, y1: sy, x2: px, y2: py, class: 'map-path map-path-pickup' }),
    svg('line', { x1: px, y1: py, x2: hx, y2: hy, class: 'map-path' + (picked ? ' map-path-live' : '') }),
    svg('rect', { x: px - 7, y: py - 7, width: 14, height: 14, rx: 2, class: 'map-shop' }), label(px, py - 12, route.shop.name.length > 28 ? 'Shop' : route.shop.name),
    svg('circle', { cx: hx, cy: hy, r: 7, class: 'map-home' }), label(hx, hy + 20, 'You'),
    phase === 'delivered' ? null : [svg('circle', { cx: rx, cy: ry, r: 13, class: 'map-rider-ring' }), svg('circle', { cx: rx, cy: ry, r: 6, class: 'map-rider' })],
    bar > 20 ? [svg('line', { x1: 12, y1: H - 12, x2: 12 + bar, y2: H - 12, class: 'map-scale' }), label(12, H - 18, bar >= km ? '1 km' : `${Math.round((bar / km) * 10) / 10} km`, 'start')] : null);
}

function trackingText(o) {
  const r = o.rider;
  const p = r.position || { phase: 'to_pickup' };
  if (o.status === 'delivered') return { head: 'Delivered', line: o.delivered_at ? `Handed over at ${clock(o.delivered_at)} by ${r.name}` : `Handed over by ${r.name}` };
  if (['cancelled', 'returned', 'rto'].includes(o.status)) return null;
  const left = (ts) => Math.max(1, Math.round((ts - Date.now()) / 60000));
  if (p.phase === 'to_pickup') return { head: `Arriving in about ${minsText(left(r.etaDrop))}`, line: `${r.name} is on the way to ${r.route.shop.name} to collect your order (about ${minsText(left(r.etaPickup))}).` };
  if (p.phase === 'at_pickup') return { head: `Arriving in about ${minsText(left(r.etaDrop))}`, line: `${r.name} is collecting your order at ${r.route.shop.name}.` };
  if (p.phase === 'arriving') return { head: 'Arriving now', line: `${r.name} is at your door or very close. Please keep your phone handy.` };
  const away = Math.max(0.1, Math.round(r.route.km * (1 - (p.progress || 0)) * 10) / 10);
  return { head: `Arriving in about ${minsText(left(r.etaDrop))}`, line: `${r.name} has your order and is about ${away} km away.` };
}

/** Live Express tracking card: the map, the rider and the expected time, refreshed every 15 seconds. */
function liveTracking(order) {
  const box = h('div', { class: 'card track-card' });
  const paint = (o) => {
    const t = trackingText(o);
    if (!t) { box.remove(); return; }
    fill(box,
      h('div', { class: 'track-head' }, h('div', null, h('h3', null, t.head), h('p', { class: 'small' }, t.line)),
        h('div', { class: 'rider-chip' }, h('span', { class: 'avatar' }, o.rider.name[0]), h('div', null, h('b', null, o.rider.name), h('div', { class: 'hint' }, 'Bazaario Express rider')),
          o.rider.phone && o.status !== 'delivered' ? h('a', { class: 'btn btn-outline btn-sm', href: `tel:+91${o.rider.phone}` }, 'Call') : null)),
      tripMap(o.rider.route, o.rider.position && o.rider.position.at, o.rider.position ? o.rider.position.phase : 'to_pickup'),
      h('p', { class: 'hint' }, `From ${o.rider.route.shop.name} · ${o.rider.route.km} km trip`, o.status === 'delivered' ? null : ' · Updates every 15 seconds'));
  };
  paint(order);
  if (order.status !== 'delivered') {
    const id = order.id;
    const timer = setInterval(async () => {
      if (!box.isConnected) { clearInterval(timer); return; }
      try {
        const { order: fresh } = await api('GET', `/orders/${id}`);
        if (fresh.status !== order.status) { route(); return; }
        if (fresh.rider) paint(fresh);
      } catch { /* keep the last picture */ }
    }, 15000);
    state.timers.push(timer);
  }
  return box;
}

// ---------------- Shop Partner: sign-up ----------------
async function viewPartner() {
  document.title = 'Partner shops · Bazaario';
  const me = state.user ? await api('GET', '/seller/me') : null;
  const s = me && me.seller;
  if (s && s.lane === 'shop' && s.status === 'approved') { location.hash = '#/shop'; return; }
  const plans = me ? me.plans : null;
  const intro = [
    h('h1', { class: 'page-title' }, 'Bazaario partner shops'),
    h('p', { class: 'tagline' }, 'Your shop, delivering to your neighbourhood in minutes. Bazaario brings the buyers and the riders.'),
    h('div', { class: 'lane-grid' },
      h('div', { class: 'card lane' }, h('h3', null, 'More orders, same shop'), h('p', { class: 'small' }, 'Buyers within your delivery radius see your price as "Express near you" on Bazaario.')),
      h('div', { class: 'card lane' }, h('h3', null, 'Riders included'), h('p', { class: 'small' }, 'Accept within 2 minutes and pack. A Bazaario Express rider collects the order and brings it to the buyer.')),
      h('div', { class: 'card lane' }, h('h3', null, 'Paid the next day'), h('p', { class: 'small' }, `${plans ? plans.shopCommission : 10}% commission and no other fees. Money reaches your bank the day after delivery.`))),
    h('div', { class: 'card steps-card' }, h('h3', null, 'How it works'),
      h('ol', { class: 'plain-steps' },
        h('li', null, h('b', null, 'Register. '), 'Shop address, delivery radius (2 to 5 km), opening hours, PAN or GSTIN, and a bank account.'),
        h('li', null, h('b', null, 'List. '), 'Add your price and stock to products already on Bazaario from the Seller Hub.'),
        h('li', null, h('b', null, 'Accept and pack. '), 'Each order rings in the Shop Partner app. Accept within 2 minutes or it goes to the next shop.'),
        h('li', null, h('b', null, 'Hand over. '), 'The rider collects it. You see your earnings for the day as you go.'))),
  ];
  if (!state.user) {
    mount(intro, h('p', null, h('a', { class: 'btn btn-primary', href: '#/login?next=' + encodeURIComponent('#/partner') }, 'Sign in to register your shop'),
      ' ', h('a', { class: 'btn btn-outline', href: '#/register?next=' + encodeURIComponent('#/partner') }, 'Create an account')));
    return;
  }
  if (s && s.status !== 'rejected') {
    mount(h('h1', { class: 'page-title' }, 'Bazaario partner shops'), h('div', { class: 'card' }, h('h3', null, `${s.displayName} · ${s.laneName}`),
      h('p', null, sellerStatusText[s.status]), s.statusNote ? h('p', { class: 'low' }, s.statusNote) : null,
      s.lane !== 'shop' ? h('p', { class: 'hint' }, 'This account already sells on Bazaario. Use another account to register a partner shop.') : null));
    return;
  }
  mount(intro, s ? h('div', { class: 'alert alert-err' }, h('b', null, `${sellerStatusText.rejected} `), s.statusNote, ' Correct your details below and apply again.') : null,
    h('p', { class: 'hint' }, `Express runs in ${(state.config.expressCities || []).join(', ')}.`),
    applyForm(me, s, { shop: true }));
}

// ---------------- Shop Partner app ----------------
const SHOP_TABS = [['orders', 'Orders'], ['stock', 'Stock'], ['earnings', 'Earnings'], ['settings', 'Shop settings']];

async function viewShop(params) {
  if (!state.user) { location.hash = '#/login?next=' + encodeURIComponent('#/shop'); return; }
  let me;
  try { me = await api('GET', '/shop/me'); } catch (e) {
    if (e.status !== 403) throw e;
    mount(h('h1', { class: 'page-title' }, 'Shop Partner'), h('div', { class: 'card' }, h('p', null, e.message),
      h('a', { class: 'btn btn-outline', href: '#/partner' }, 'Partner shops')));
    return;
  }
  document.title = 'Shop Partner · Bazaario';
  const qp = new URLSearchParams(params);
  const tab = SHOP_TABS.some(([k]) => k === qp.get('tab')) ? qp.get('tab') : 'orders';
  const sh = me.shop;
  const toggle = async () => {
    try { await api('PATCH', '/shop/settings', { accepting: !sh.accepting }); toast(sh.accepting ? 'Shop paused. Buyers will not see it until you open again.' : 'Shop open for orders.'); route(); } catch (ex) { fail(ex); }
  };
  const tabs = h('div', { class: 'tabs' }, SHOP_TABS.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { location.hash = `#/shop?tab=${k}`; } }, l)));
  const body = h('div');
  mount(
    h('div', { class: 'shop-head' },
      h('div', null, h('h1', { class: 'page-title' }, sh.name), h('p', { class: 'tagline' }, `${sh.city} ${sh.pincode} · delivers within ${sh.radiusKm} km · ${sh.hours}`)),
      h('div', { class: 'shop-state' }, h('span', { class: 'status ' + (sh.open ? 'delivered' : 'cancelled') }, sh.open ? 'Open for orders' : 'Closed'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: toggle }, sh.accepting ? 'Pause orders' : 'Open shop'))),
    sh.open ? null : h('p', { class: 'alert alert-err' }, sh.reason),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Orders today'), h('b', null, me.today.orders)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Delivered today'), h('b', null, me.today.delivered)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Earned today'), h('b', null, inr(me.today.earned))),
      h('div', { class: 'stat' + (me.today.missed ? ' stat-alert' : '') }, h('span', { class: 'hint', title: 'Moved to another shop because they were not accepted in time' }, 'Missed orders'), h('b', null, me.today.missed))),
    me.lowStock.length ? h('p', { class: 'alert alert-test' }, 'Running low: ', me.lowStock.map((x, i) => `${i ? ', ' : ''}${x.title} (${x.stock})`).join('')) : null,
    tabs, body);
  await ({ orders: shopOrders, stock: shopStock, earnings: shopEarnings, settings: shopSettings })[tab](body, me);
}

async function shopOrders(body, me) {
  const act = async (o, path, payload, msg) => {
    try { await api('POST', `/seller/orders/${o.id}/${path}`, payload); toast(msg); paint(); } catch (ex) { fail(ex); paint(); }
  };
  const reject = async (o) => {
    const reason = await askText(`Say no to order ${o.orderNo}?`, { placeholder: 'For example: out of stock', yes: 'Say no',
      hint: 'The order moves to the next shop near the buyer. Saying no often lowers your score.' });
    if (reason) act(o, 'reject', { reason }, 'The order has moved to another shop.');
  };
  const items = (o) => h('div', { class: 'small' }, o.items.map((it) => h('div', null, `${it.qty} × ${it.title}`)));
  const countdown = (o) => h('b', { class: 'countdown', dataset: { until: o.acceptBy } }, '');
  const section = (title, list, row, empty) => h('div', { class: 'card shop-col' }, h('h3', null, title, list.length ? h('span', { class: 'tab-count' }, list.length) : null),
    list.length ? list.map(row) : h('p', { class: 'hint' }, empty));
  let first = true;
  const render = (d) => fill(body, h('div', { class: 'shop-board' },
    section('New orders', d.waiting, (o) => {
      // Only the oldest waiting order gets the clay button: one primary action on the screen.
      const primary = first; first = false;
      return h('div', { class: 'shop-order shop-order-new' },
        h('div', { class: 'shop-order-top' }, h('b', null, o.orderNo), countdown(o)),
        items(o), h('div', { class: 'hint' }, `${inr(o.value)} · to ${o.area}`),
        h('div', { class: 'line-actions' }, h('button', { class: primary ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm', onclick: () => act(o, 'accept', undefined, 'Accepted. Please pack it now.') }, 'Accept'),
          h('button', { class: 'link-btn danger', onclick: () => reject(o) }, 'Say no')));
    }, `New orders ring here. Accept each one within ${d.acceptMins} minutes.`),
    section('Packing', d.preparing, (o) => h('div', { class: 'shop-order' },
      h('div', { class: 'shop-order-top' }, h('b', null, `${o.orderNo} · ${o.name}`), o.readyBy ? h('span', { class: o.readyBy < Date.now() ? 'low small' : 'hint' }, `Pack by ${clock(o.readyBy)}`) : null),
      items(o), h('button', { class: 'btn btn-outline btn-sm', onclick: () => act(o, 'pack', undefined, 'Packed. A rider is on the way.') }, 'Packed: call rider')), 'Accepted orders to pack appear here.'),
    section('With rider', d.rider, (o) => h('div', { class: 'shop-order' },
      h('div', { class: 'shop-order-top' }, h('b', null, `${o.orderNo} · ${o.name}`), h('span', { class: 'hint' }, STATUS_LABEL[o.status])),
      items(o),
      o.rider ? h('div', { class: 'hint' }, o.rider.pickedAt ? `${o.rider.name} collected it. Drop by ${clock(o.rider.etaDrop)} (${o.rider.km} km).`
        : `${o.rider.name} arrives at your shop by ${clock(o.rider.etaPickup)}. Keep the parcel ready.`) : h('div', { class: 'low small' }, 'Finding a rider…')), 'Packed orders wait here for the rider.'),
    section('Done today', d.done, (o) => h('div', { class: 'shop-order shop-order-done' },
      h('div', { class: 'shop-order-top' }, h('b', null, o.orderNo), h('span', { class: 'hint' }, STATUS_LABEL[o.status])), h('div', { class: 'hint' }, `${inr(o.value)} · ${o.items.length} item(s)`)), 'Nothing yet today.')));
  const tickDown = () => body.querySelectorAll('.countdown').forEach((el) => {
    const left = Math.max(0, Number(el.dataset.until) - Date.now());
    el.textContent = left ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left` : 'Time up';
    el.classList.toggle('err', left < 30000);
  });
  const paint = async () => {
    try { first = true; render(await api('GET', '/shop/orders')); tickDown(); } catch (ex) { fail(ex); }
  };
  await paint();
  state.timers.push(setInterval(tickDown, 1000), setInterval(paint, 10000));
}

async function shopStock(body) {
  const { listings } = await api('GET', '/seller/listings');
  const save = async (l, stock, price) => {
    try { await api('PATCH', `/seller/offers/${l.offer_id || l.id}`, { stock: Number(stock), price: Number(price) }); toast('Saved.'); } catch (ex) { fail(ex); }
  };
  fill(body, h('p', { class: 'muted' }, 'Keep stock right so buyers only see what you have. Add new items from the ', h('a', { href: '#/seller?tab=add' }, 'Seller Hub'), '.'),
    listings.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Item', 'Your price (₹)', 'Stock', ''].map((t) => h('th', null, t))),
      listings.map((l) => {
        const price = h('input', { type: 'number', min: 1, value: Math.round(l.price / 100), style: { width: '90px' }, 'aria-label': 'Price' });
        const stock = h('input', { type: 'number', min: 0, value: l.stock, style: { width: '80px' }, 'aria-label': 'Stock' });
        return h('tr', null, h('td', null, l.title, h('div', { class: 'hint' }, `MRP ${inr(l.mrp)}`)), h('td', null, price), h('td', null, stock),
          h('td', null, h('button', { class: 'btn btn-outline btn-sm', onclick: () => save(l, stock.value, price.value) }, 'Save')));
      }))) : h('div', { class: 'card empty' }, h('p', null, 'No items yet.'), h('a', { class: 'btn btn-outline', href: '#/seller?tab=add' }, 'Add your first item')));
}

async function shopEarnings(body) {
  const e = await api('GET', '/shop/earnings');
  const max = Math.max(1, ...e.days.map((x) => x.net));
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  fill(body,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Last 14 days'), h('b', null, inr(e.days.reduce((s, x) => s + x.net, 0)))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'On its way to your bank'), h('b', null, inr(e.upcoming)))),
    h('div', { class: 'card' }, h('h3', null, 'By day'),
      h('div', { class: 'earn-chart' }, e.days.map((x) => h('div', { class: 'earn-bar', title: `${fmtDay(x.day)}: ${inr(x.net)}` },
        h('i', { style: { height: `${Math.round((x.net / max) * 100)}%` } }), h('span', null, new Date(x.day).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric' }))))),
      h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Day', 'Orders', 'Sales', 'Commission and GST', 'You earn'].map((t) => h('th', null, t))),
        e.days.slice().reverse().filter((x) => x.orders).map((x) => h('tr', null, h('td', null, fmtDay(x.day)), h('td', null, x.orders), h('td', null, inr(x.sales)),
          h('td', null, inr(x.commission)), h('td', null, h('b', null, inr(x.net))))))),
      h('p', { class: 'hint' }, `Paid ${e.payoutDays} day after delivery. TDS of 0.1% (section 194-O) is deducted as the law requires.`)),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Payouts'),
      e.payouts.length ? h('table', null, h('tr', null, ['Date', 'Payout', 'Amount', 'UTR'].map((t) => h('th', null, t))),
        e.payouts.map((p) => h('tr', null, h('td', null, fmtDate(p.created_at)), h('td', null, p.payout_no), h('td', null, h('b', null, inr(p.net))), h('td', { class: 'hint' }, p.utr || '—'))))
        : h('p', { class: 'muted' }, 'Your first payout arrives the day after your first delivery.')));
}

function shopSettings(body, me) {
  const sh = me.shop;
  const R = me.rules.radius;
  const radius = h('select', null, Array.from({ length: R.max - R.min + 1 }, (_, i) => R.min + i).map((km) => h('option', { value: km, selected: km === sh.radiusKm }, `${km} km`)));
  const hourSel = (pick, from) => h('select', null, Array.from({ length: 24 }, (_, i) => i + from).map((hr) => h('option', { value: hr, selected: hr === pick }, hourText(hr))));
  const open = hourSel(sh.openHour, 0);
  const close = hourSel(sh.closeHour, 1);
  fill(body, h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    try { await api('PATCH', '/shop/settings', { radiusKm: Number(radius.value), openHour: Number(open.value), closeHour: Number(close.value) }); toast('Shop settings saved.'); route(); } catch (ex) { fail(ex); }
  } },
  h('h3', null, 'Delivery area and hours'),
  h('div', { class: 'form-grid' }, field('Delivery radius', radius, { hint: 'A smaller radius means faster deliveries and fewer orders.' }), h('div'), field('Opens at', open), field('Closes at', close)),
  h('p', null, h('button', { class: 'btn btn-outline' }, 'Save settings')),
  h('table', { class: 'details' },
    h('tr', null, h('th', null, 'Accept orders within'), h('td', null, `${me.rules.acceptMins} minutes`)),
    h('tr', null, h('th', null, 'Pack within'), h('td', null, `${me.rules.prepMins} minutes of accepting`)),
    h('tr', null, h('th', null, 'Commission'), h('td', null, `${me.rules.commission}% of the item price, no other fees`)),
    h('tr', null, h('th', null, 'Payout'), h('td', null, `${me.rules.payoutDays} day after delivery`)),
    sh.fssai ? h('tr', null, h('th', null, 'FSSAI licence'), h('td', null, sh.fssai)) : null)));
}

// ---------------- Studio: Express board and riders ----------------
async function studioExpress(tab, body) {
  if (tab === 'express') {
    const d = await api('GET', '/admin/express');
    const step = async (o, s, msg) => {
      try { await api('POST', `/admin/express/${o.id}/${s}`); toast(msg); route(); } catch (ex) { fail(ex); }
    };
    const PH = { to_pickup: 'Going to the shop', at_pickup: 'At the shop', to_drop: 'On the way to the buyer', arriving: 'Arriving' };
    fill(body, h('p', { class: 'muted' }, 'Every Express order still moving. Riders are assigned when an order is packed; in test mode they pick up and deliver on their own.'),
      d.orders.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Order', 'From', 'To', 'Status', 'Rider', 'Promised', ''].map((t) => h('th', null, t))),
        d.orders.map((o) => h('tr', null, h('td', null, o.orderNo, h('div', { class: 'hint' }, fmtWhen(o.createdAt))), h('td', null, o.from), h('td', null, o.to),
          h('td', null, STATUS_LABEL[o.status], o.status === 'placed' && o.acceptBy ? h('div', { class: 'hint low' }, `Accept by ${clock(o.acceptBy)}`) : null),
          h('td', null, o.rider || '—', o.position ? h('div', { class: 'hint' }, PH[o.position.phase] || '') : null,
            o.km ? h('div', { class: 'hint' }, `${o.km} km · fee ${inr(o.riderFee)}`) : null),
          h('td', { class: o.late ? 'err' : '' }, o.promisedAt ? clock(o.promisedAt) : '—', o.late ? h('div', { class: 'hint err' }, 'Late') : null),
          h('td', null, h('div', { class: 'line-actions' },
            o.status === 'packed' ? h('button', { class: 'link-btn', onclick: () => step(o, 'assign', 'Rider assigned.') }, o.rider ? 'Reassign rider' : 'Assign rider') : null,
            o.status === 'packed' && o.rider ? h('button', { class: 'btn btn-outline btn-sm', onclick: () => step(o, 'pickup', 'Marked as picked up.') }, 'Picked up') : null,
            o.status === 'out_for_delivery' ? h('button', { class: 'btn btn-outline btn-sm', onclick: () => step(o, 'deliver', 'Marked as delivered.') }, 'Delivered') : null))))))
        : h('div', { class: 'card empty' }, h('p', null, 'No Express orders on the move.')));
  }
  if (tab === 'riders') {
    const d = await api('GET', '/admin/riders');
    const name = h('input', { maxLength: 60, required: true, placeholder: 'Full name' });
    const phone = h('input', { maxLength: 10, required: true, inputMode: 'numeric', placeholder: '10-digit mobile' });
    const city = h('select', null, d.cities.map((c) => h('option', { value: c }, c)));
    const toggle = async (r) => { try { await api('PATCH', `/admin/riders/${r.id}`, { active: !r.active }); route(); } catch (ex) { fail(ex); } };
    const payAll = async () => {
      if (!(await askConfirm('Pay every rider for their delivered trips?', 'Pay riders'))) return;
      try { const r = await api('POST', '/admin/riders/pay'); toast(r.payouts.length ? `${r.payouts.length} rider(s) paid.` : 'Nothing was due.'); route(); } catch (ex) { fail(ex); }
    };
    const unpaid = d.riders.reduce((s, r) => s + r.unpaid, 0);
    fill(body, h('p', { class: 'muted' }, `Riders carry up to ${d.rules.maxLoad} orders at a time and earn ${inr(d.rules.feeBase)} per trip plus ${inr(d.rules.feePerKm)} per km.`),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Riders'), h('b', null, d.riders.length)),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'On a trip now'), h('b', null, d.riders.filter((r) => r.load).length)),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Due to riders'), h('b', null, inr(unpaid)))),
      h('p', null, h('button', { class: 'btn btn-primary', onclick: payAll, disabled: !unpaid }, 'Pay riders now')),
      h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Rider', 'City', 'Now', 'Today', 'Unpaid', ''].map((t) => h('th', null, t))),
        d.riders.map((r) => h('tr', null, h('td', null, r.name, h('div', { class: 'hint' }, r.phone)), h('td', null, r.city),
          h('td', null, !r.active ? 'Off duty' : r.load ? `${r.load} order(s)` : 'Free'),
          h('td', null, `${r.today_orders} trip(s)`, h('div', { class: 'hint' }, inr(r.today_earned))), h('td', null, r.unpaid ? inr(r.unpaid) : '—'),
          h('td', null, h('button', { class: 'link-btn' + (r.active ? ' danger' : ''), onclick: () => toggle(r) }, r.active ? 'Take off duty' : 'Put on duty')))))),
      h('form', { class: 'card', style: { marginTop: '16px' }, onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/admin/riders', { name: name.value, phone: phone.value, city: city.value }); toast('Rider added.'); route(); } catch (ex) { fail(ex); }
      } }, h('h3', null, 'Add a rider'), h('div', { class: 'form-grid' }, field('Name', name), field('Mobile number', phone), field('City', city)),
      h('button', { class: 'btn btn-outline' }, 'Add rider')),
      d.payouts.length ? [h('h3', { style: { marginTop: '16px' } }, 'Rider payouts'), h('div', { class: 'table-wrap' }, h('table', null,
        h('tr', null, ['Date', 'Rider', 'Trips', 'Amount', 'UTR'].map((t) => h('th', null, t))),
        d.payouts.map((p) => h('tr', null, h('td', null, fmtDate(p.created_at)), h('td', null, p.name), h('td', null, p.orders), h('td', null, inr(p.amount)), h('td', { class: 'hint' }, p.utr || '—')))))] : null);
  }
}
