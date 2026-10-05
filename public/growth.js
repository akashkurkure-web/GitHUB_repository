/* Bazaario growth and loyalty: Bazaario Plus, sale events, referrals, sponsored listings, category hubs with buying
 * guides, Seller Hub ads and the Studio sales, reports, Plus and ads tabs.
 * Loaded after app.js and seller.js and uses their helpers (h, fill, add, mount, api, inr, route, productCard). */
'use strict';

// ---------------- Shared bits ----------------
/** "3 days 4 h", "2 h 15 min" or "12 min" until `ts`. */
function timeLeft(ts) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  if (d) return `${d} ${d === 1 ? 'day' : 'days'} ${hr} h`;
  return hr ? `${hr} h ${m % 60} min` : `${m % 60} min`;
}

/** A line of text with a live countdown, refreshed every 30 seconds while the page is open. */
function countdown(ts, before, after = '') {
  const el = h('span', { class: 'countdown' });
  const paint = () => { el.textContent = `${before} ${timeLeft(ts)}${after}`; };
  paint();
  state.timers.push(setInterval(paint, 30000));
  return el;
}

const many = (n, one, other = `${one}s`) => `${n} ${n === 1 ? one : other}`;
const minus = (paise) => (paise ? `-${inr(paise)}` : '—');
const shortDate = (ts) => new Date(ts).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' });

/** Whether the signed-in buyer is a Plus member (kept in state.plus). */
async function loadPlus() {
  if (!state.user) { state.plus = null; return null; }
  try { state.plus = (await api('GET', '/plus/plans')).member; } catch { state.plus = null; }
  return state.plus;
}

// ---------------- Sale prices on cards and the product page ----------------
/** The sale label on a product card, in place of "Deal". */
function saleTag(p) {
  if (!p.sale) return null;
  return h('span', { class: 'tag-steal tag-sale' }, `${p.sale.pct}% off`);
}

/** The line under a sale price: which sale, and (on the product page) when it ends. */
function saleLine(p, big) {
  if (!p.sale) return null;
  return h('div', { class: 'sale-line' },
    h('a', { href: `#/sale/${p.sale.slug}` }, p.sale.early ? `${p.sale.name}: Plus early access` : `${p.sale.name} price`),
    big ? [' · ', countdown(p.sale.endsAt, 'ends in')] : null,
    big && p.sale.was ? h('div', { class: 'hint' }, `Usual price ${inr(p.sale.was)}. The discount is on us; the seller is paid in full.`) : null);
}

// ---------------- Home page sale band ----------------
function saleBand(sales) {
  const live = sales.find((s) => s.live || s.earlyNow);
  const next = sales.find((s) => !s.live && !s.earlyNow);
  const s = live || next;
  if (!s) return null;
  return h('section', { class: 'sale-band' + (live ? ' live' : '') },
    h('div', null,
      h('span', { class: 'eyebrow' }, live ? (s.earlyNow ? 'Plus early access' : 'Sale on now') : 'Coming soon'),
      h('h2', null, s.name),
      h('p', null, s.tagline),
      h('p', { class: 'sale-when' }, live ? countdown(s.endsAt, 'Ends in') : [countdown(s.startsAt, 'Starts in'),
        s.earlyHours ? ` · Plus members shop ${s.earlyHours} hours early` : null])),
    h('div', { class: 'sale-band-side' },
      h('b', { class: 'sale-big' }, `Up to ${s.topPct}% off`),
      h('span', { class: 'hint' }, `${s.items} products`),
      h('a', { class: 'btn btn-outline', href: `#/sale/${s.slug}` }, live ? 'Shop the sale' : 'See what is coming')));
}

// ---------------- Sale landing page ----------------
async function viewSales() {
  const { sales } = await api('GET', '/sales');
  document.title = 'Sales · Bazaario';
  mount(h('h1', { class: 'page-title' }, 'Sales'),
    sales.length ? h('div', { class: 'sale-list' }, sales.map((s) => h('a', { class: 'acc-tile sale-tile', href: `#/sale/${s.slug}` },
      h('span', { class: 'eyebrow' }, s.live ? 'Sale on now' : s.earlyNow ? 'Plus early access' : 'Coming soon'),
      h('h3', null, s.name), h('p', { class: 'muted small' }, s.tagline),
      h('p', { class: 'small' }, `Up to ${s.topPct}% off · `, s.live ? countdown(s.endsAt, 'ends in') : countdown(s.startsAt, 'starts in')))))
      : h('div', { class: 'card empty' }, h('h2', null, 'No sales right now'), h('p', null, 'Plus members hear about the next one first.'), h('a', { class: 'btn btn-primary', href: '#/s?deals=1' }, 'Browse deals')));
}

async function viewSale(slug) {
  if (!slug) return viewSales();
  const { sale: s, items, plus } = await api('GET', `/sales/${encodeURIComponent(slug)}`);
  document.title = `${s.name} · Bazaario`;
  const cats = [...new Map(items.map((p) => [p.category, p.category_name])).entries()];
  const grid = h('div', { class: 'grid' });
  let cat = '';
  const paint = () => fill(grid, items.filter((p) => !cat || p.category === cat).map((p) => productCard(p)));
  const chips = h('div', { class: 'chip-set sale-chips' },
    [['', 'Everything'], ...cats].map(([k, l]) => h('button', { class: 'fchip' + (k === cat ? ' sel' : ''), onclick: (e) => {
      cat = k;
      chips.querySelectorAll('.fchip').forEach((b) => b.classList.remove('sel'));
      e.currentTarget.classList.add('sel');
      paint();
    } }, l)));
  paint();
  const status = s.ended ? h('p', { class: 'sale-when' }, 'This sale has ended. Prices are back to normal.')
    : s.live ? h('p', { class: 'sale-when' }, countdown(s.endsAt, 'Ends in'))
      : s.early ? h('p', { class: 'sale-when' }, 'Plus early access: you are shopping before everyone else. Opens to all in ', countdown(s.startsAt, ''), '.')
        : h('p', { class: 'sale-when' }, countdown(s.startsAt, 'Starts in'), ` · ${fmtWhen(s.startsAt)}`);
  mount(
    h('section', { class: 'sale-hero' + (s.live || s.early ? ' live' : '') },
      h('span', { class: 'eyebrow' }, s.live ? 'Sale on now' : s.early ? 'Plus early access' : s.ended ? 'Ended' : 'Coming soon'),
      h('h1', null, s.name), h('p', null, s.tagline), status,
      !s.live && !s.ended && !plus && s.earlyHours ? h('p', { class: 'hint' },
        `Bazaario Plus members shop ${s.earlyHours} hours early, from ${fmtWhen(s.startsAt - s.earlyHours * 3600000)}. `, h('a', { href: '#/plus' }, 'Join Plus')) : null),
    cats.length > 1 ? chips : null,
    items.length ? grid : h('div', { class: 'card empty' }, h('p', null, 'No products in this sale yet.')));
}

// ---------------- Bazaario Plus ----------------
async function viewPlus() {
  const plans = await api('GET', '/plus/plans');
  const mine = state.user ? await api('GET', '/plus') : null;
  document.title = 'Bazaario Plus · Bazaario';
  const P = plans.plans;
  const benefits = h('ul', { class: 'plus-benefits' },
    h('li', null, h('b', null, 'Free delivery on every order'), h('span', null, `No ${inr(plans.shippingFee)} fee on orders below ${inr(plans.freeShippingThreshold)}.`)),
    h('li', null, h('b', null, `Express for ${inr(plans.expressFee)}`), h('span', null, `Instead of ${inr(plans.normalExpressFee)}, in the cities with Express delivery.`)),
    h('li', null, h('b', null, `Sales ${plans.earlyHours} hours early`), h('span', null, 'Shop Bazaario Utsav, Payday Sale and every big sale before everyone else.')),
    h('li', null, h('b', null, 'Members-only coupons'), h('span', null, 'Such as PLUS200: ₹200 off orders above ₹1,499.')));

  if (mine && mine.member) {
    const m = mine.member;
    const renew = h('input', { type: 'checkbox', checked: m.autoRenew, onchange: async (e) => {
      try { await api('POST', '/plus/renewal', { autoRenew: e.target.checked }); toast(e.target.checked ? 'Plus will renew automatically.' : 'Renewal is off. Plus stays on until its end date.'); } catch (ex) { fail(ex); }
    } });
    mount(h('h1', { class: 'page-title' }, 'Bazaario Plus'),
      h('div', { class: 'two-col' },
        h('div', null,
          h('div', { class: 'card plus-card member' },
            h('span', { class: 'plus-badge' }, 'Plus member'),
            h('h2', null, `Your ${m.plan} plan runs until ${fmtDate(m.endsAt)}`),
            h('p', { class: 'savings' }, mine.saved.orders ? `Plus has saved you ${inr(mine.saved.amount)} on ${mine.saved.orders} ${mine.saved.orders === 1 ? 'order' : 'orders'}.` : 'Your savings show here after your first order.'),
            h('label', { class: 'inline' }, renew, 'Renew automatically'),
            h('p', { class: 'hint' }, 'Turning renewal off keeps your benefits until the end date.')),
          h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Your benefits'), benefits)),
        h('div', { class: 'card' }, h('h3', null, 'Payments'),
          h('div', { class: 'table-wrap' }, h('table', null, h('tr', null, ['Date', 'Plan', 'Period', 'Paid', 'Reference'].map((t) => h('th', null, t))),
            mine.history.map((x) => h('tr', null, h('td', null, fmtDate(x.created_at)), h('td', null, cap(x.plan)),
              h('td', null, `${shortDate(x.starts_at)} to ${shortDate(x.ends_at)}`), h('td', null, inr(x.amount)), h('td', { class: 'hint' }, x.payment_ref))))),
          h('p', null, h('a', { class: 'btn btn-outline', href: '#/s?deals=1' }, 'Shop deals')))));
    return;
  }

  let plan = 'yearly';
  let method = 'upi';
  const upi = h('input', { placeholder: 'yourname@bank', maxLength: 100, 'aria-label': 'UPI ID' });
  const cardNo = h('input', { inputMode: 'numeric', maxLength: 23, autocomplete: 'cc-number', placeholder: '1234 5678 9012 3456', 'aria-label': 'Card number' });
  const exp = h('input', { placeholder: 'MM/YY', maxLength: 5, autocomplete: 'cc-exp', 'aria-label': 'Expiry' });
  const cvv = h('input', { type: 'password', inputMode: 'numeric', maxLength: 4, placeholder: 'CVV', 'aria-label': 'CVV' });
  const upiBox = h('div', { class: 'pay-fields' }, h('label', null, 'UPI ID'), upi);
  const cardBox = h('div', { class: 'pay-fields hidden' }, h('label', null, 'Card number'), cardNo,
    h('div', { class: 'form-grid' }, h('div', null, h('label', null, 'Expiry'), exp), h('div', null, h('label', null, 'CVV'), cvv)));
  const yearSave = P.monthly.price * 12 - P.yearly.price;
  const planCard = (k, title, price, per, note) => h('label', { class: 'plan-opt' + (k === plan ? ' sel' : '') },
    h('input', { type: 'radio', name: 'plan', checked: k === plan, onchange: (e) => {
      plan = k;
      document.querySelectorAll('.plan-opt').forEach((x) => x.classList.remove('sel'));
      e.target.closest('.plan-opt').classList.add('sel');
      joinBtn.textContent = `Join Plus for ${inr(P[plan].price)}`;
    } }),
    h('span', null, h('b', null, title), h('span', { class: 'plan-price' }, inr(price), h('small', null, per)), note ? h('span', { class: 'save' }, note) : null));
  const joinBtn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
    if (!state.user) { location.hash = '#/login?next=%23%2Fplus'; return; }
    const payment = method === 'upi' ? { upiId: upi.value } : { cardNumber: cardNo.value, expiry: exp.value, cvv: cvv.value };
    joinBtn.disabled = true;
    try {
      await api('POST', '/plus/join', { plan, paymentMethod: method, payment });
      cardNo.value = ''; cvv.value = '';
      await loadPlus();
      toast('Welcome to Bazaario Plus. Free delivery starts with your next order.');
      route();
    } catch (ex) { fail(ex); joinBtn.disabled = false; }
  } }, `Join Plus for ${inr(P[plan].price)}`);
  const methodOpt = (k, label) => h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'pmethod', checked: k === method, onchange: () => {
    method = k; upiBox.classList.toggle('hidden', k !== 'upi'); cardBox.classList.toggle('hidden', k !== 'card');
  } }), label);
  const test = state.config.testMode || {};
  mount(
    h('section', { class: 'plus-hero' },
      h('div', null, h('span', { class: 'plus-badge' }, 'Bazaario Plus'),
        h('h1', null, 'Free delivery on everything, and the best sales first.'),
        h('p', null, `From ${inr(Math.floor(P.yearly.price / 1200) * 100)} a month on the yearly plan. Cancel renewal any time.`)),
      benefits),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' }, h('h2', null, 'Choose your plan'),
        h('div', { class: 'plan-grid' },
          planCard('yearly', 'Yearly', P.yearly.price, ' / year', `Save ${inr(yearSave)} against monthly`),
          planCard('monthly', 'Monthly', P.monthly.price, ' / month', null)),
        h('h3', null, 'Pay with'),
        h('div', { class: 'chip-set' }, methodOpt('upi', 'UPI'), methodOpt('card', 'Credit or debit card')),
        upiBox, cardBox,
        test.payments ? h('p', { class: 'alert alert-test' }, 'Test mode: no money is charged. Test card: 4111 1111 1111 1111.') : null),
      h('div', { class: 'card summary' },
        h('h3', null, 'How much Plus saves'),
        h('p', { class: 'small' }, `Two small orders a month save ${inr(plans.shippingFee * 2)} in delivery, more than the monthly plan costs.`),
        h('p', { class: 'small' }, `Each Express order saves ${inr(plans.normalExpressFee - plans.expressFee)}.`),
        state.user ? null : h('p', { class: 'hint' }, 'Sign in first. Plus is linked to your account.'),
        joinBtn,
        h('p', { class: 'hint center' }, 'Plus starts at once. You can turn renewal off from this page.'))));
}

// ---------------- Refer and earn ----------------
async function viewRefer() {
  if (!state.user) { location.hash = '#/login?next=%23%2Frefer'; return; }
  const r = await api('GET', '/referrals');
  const link = `${location.origin}/#/register?ref=${r.code}`;
  const text = `Join me on Bazaario and get ${inr(r.rewards.friend)} in your wallet after your first order: ${link}`;
  const linkIn = h('input', { value: link, readOnly: true, 'aria-label': 'Your invite link' });
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { linkIn.select(); toast('Select the link and copy it.'); }
  };
  const STATUS = { pending: 'Joined, first order not delivered yet', rewarded: 'Rewarded' };
  mount(h('h1', { class: 'page-title' }, 'Refer and earn'),
    h('div', { class: 'two-col' },
      h('div', null,
        h('div', { class: 'card refer-card' },
          h('h2', null, `You get ${inr(r.rewards.referrer)}, your friend gets ${inr(r.rewards.friend)}`),
          h('p', { class: 'muted' }, 'Both rewards go to your Bazaario wallets when your friend’s first order is delivered.'),
          h('div', { class: 'refer-code' }, h('span', { class: 'hint' }, 'Your invite code'), h('b', null, r.code)),
          h('label', null, 'Your invite link'),
          h('div', { class: 'copy-row' }, linkIn, h('button', { class: 'btn btn-outline', type: 'button', onclick: copy }, 'Copy')),
          h('div', { class: 'hero-cta' },
            h('a', { class: 'btn btn-primary', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
            navigator.share ? h('button', { class: 'btn btn-outline', type: 'button', onclick: () => navigator.share({ title: 'Bazaario', text, url: link }).catch(() => {}) }, 'More ways to share') : null)),
        h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'How it works'),
          h('ol', { class: 'steps-list' },
            h('li', null, 'Share your link or code with a friend who is new to Bazaario.'),
            h('li', null, 'They create an account with it and place an order.'),
            h('li', null, 'When that first order is delivered, you both get the money in your wallets.')),
          h('p', { class: 'hint' }, 'Wallet money works on any order. Up to 20 friends a month can join with your code.'))),
      h('div', { class: 'card' },
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Friends joined'), h('b', null, r.friends.length)),
          h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'You earned'), h('b', null, inr(r.earned)))),
        h('h3', null, 'Your friends'),
        r.friends.length ? h('table', null, h('tr', null, h('th', null, 'Friend'), h('th', null, 'Joined'), h('th', null, 'Status')),
          r.friends.map((f) => h('tr', null, h('td', null, f.name), h('td', null, fmtDate(f.created_at)),
            h('td', { class: f.status === 'rewarded' ? 'ok' : 'muted' }, STATUS[f.status]))))
          : h('p', { class: 'muted' }, 'No one has joined with your code yet.'))));
}

// ---------------- Sponsored listings in search ----------------
/** A product card marked "Sponsored". A click is reported so the seller pays for it (once a day per shopper). */
function sponsoredCard(p) {
  const card = productCard(p);
  card.classList.add('pcard-ad');
  card.querySelector('.pbody').prepend(h('span', { class: 'ad-label' }, 'Sponsored'));
  card.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) api('POST', '/ads/click', { campaignId: p.campaignId }).catch(() => {});
  }, true);
  return card;
}

// ---------------- Category hubs with buying guides ----------------
const GUIDES = {
  mobiles: {
    intro: 'Phones for every budget, from long-battery basics to flagship cameras.',
    points: [['Processor and RAM', '6 GB RAM or more keeps apps open; 8 GB if you game or multitask.'],
      ['Battery', '5000 mAh lasts a full day for most people. Check the charger wattage too.'],
      ['Updates', 'Years of Android updates keep the phone safe. Flagships promise 5 to 7 years.'],
      ['5G', 'Buy 5G now if you keep phones for 3 years or more.']],
    tip: 'Pay with no-cost EMI on orders above ₹3,000 and spread the cost over 3 to 12 months.',
    budget: 15000,
  },
  electronics: {
    intro: 'Laptops, TVs, earbuds and watches from trusted brands, with Bazaario Assured sellers.',
    points: [['Warranty', 'Look for the brand warranty in the product details. Keep your invoice from the order page.'],
      ['Screen size', 'For a TV, sit about 1.5 times the screen size away (43 inch suits a 6 to 7 foot room).'],
      ['Battery life', 'Earbuds with 30 hours or more including the case last a week of commuting.'],
      ['Ports', 'USB-C charging means one charger for your phone and laptop.']],
    tip: 'Electronics have a 10-day replacement for defects. Open the box on video if you can.',
    budget: 5000,
  },
  fashion: {
    intro: 'Everyday wear, festive outfits, shoes and accessories.',
    points: [['Size', 'Measure a shirt or kurta you already like and match it with the size chart.'],
      ['Fabric', 'Cotton and linen breathe in summer; rayon drapes well for festive wear.'],
      ['Care', 'Check the wash label. Machine wash saves time; dry clean keeps silk and zari fresh.'],
      ['Fit', 'Slim fits sit close to the body; regular fits give room to move.']],
    tip: 'Not the right size? Exchange or return within 10 days, and we pick it up from your door.',
    budget: 1000,
  },
  'home-kitchen': {
    intro: 'Cookware, storage, décor and the small things that make a home work.',
    points: [['Induction', 'Look for an induction-ready base if you cook on induction or plan to.'],
      ['Coating', 'PFOA-free non-stick is safer. Use wooden or silicone spoons to keep it lasting.'],
      ['Material', 'Steel lasts for years; glass lets you see what is inside; plastic is light for travel.'],
      ['Capacity', 'A 3-litre pressure cooker suits 2 to 4 people; 5 litres suits a family of 5 or more.']],
    tip: 'Bundle small items in one order: delivery is free above ₹499, or always with Plus.',
    budget: 1500,
  },
  books: {
    intro: 'Bestsellers, exam prep, children’s books and Indian writing.',
    points: [['Edition', 'For exam books, check the year of the edition and the syllabus it follows.'],
      ['Language', 'Many titles come in English and Hindi. The language is in the product title.'],
      ['Format', 'Paperbacks are light and cheaper; hardcovers last longer on the shelf.'],
      ['Age', 'Children’s books show an age range in the details.']],
    tip: 'Books are rarely returned, so read the sample pages and reviews before you buy.',
    budget: 500,
  },
  beauty: {
    intro: 'Skincare, haircare and grooming, sold only by brands and Bazaario.',
    points: [['Skin type', 'Pick oil-free gels for oily skin and creams for dry skin.'],
      ['Ingredients', 'Niacinamide helps with marks; hyaluronic acid adds moisture; SPF 30 or more for daytime.'],
      ['Patch test', 'Try new products on a small area first.'],
      ['Expiry', 'Check the best-before date in the product details.']],
    tip: 'Beauty items come only from brand stores and Bazaario, so they are always genuine.',
    budget: 700,
  },
  sports: {
    intro: 'Gear for cricket, yoga, running and home workouts.',
    points: [['Size and weight', 'Bats and racquets come in sizes by age and height; lighter is easier to control.'],
      ['Grip', 'Yoga mats of 6 mm or more cushion the knees; textured ones stop slipping.'],
      ['Shoes', 'Running shoes need room for a thumb’s width in front of your toes.'],
      ['Material', 'English willow bats are for leather balls; Kashmir willow suits tennis-ball cricket.']],
    tip: 'Start with the basics and add accessories later. Most gear has a 10-day return.',
    budget: 1500,
  },
  toys: {
    intro: 'Learning toys, games and gifts for every age.',
    points: [['Age', 'Follow the age on the box. Toys with small parts are not for children under 3.'],
      ['Safety', 'Look for BIS certification, which is the law for toys sold in India.'],
      ['Learning', 'Building sets and puzzles help with problem-solving and patience.'],
      ['Batteries', 'Check if batteries are included before you gift.']],
    tip: 'Gifting? Add the receiver’s address at checkout. The price is not printed on the packing slip.',
    budget: 800,
  },
  grocery: {
    intro: 'Staples, snacks and drinks, many in under 90 minutes by Express.',
    points: [['Best before', 'Every food listing shows its best-before month.'],
      ['Pack size', 'Bigger packs cost less per kilo for things you use every day, like rice and oil.'],
      ['Express', 'Partner shops near you can bring groceries in under an hour.'],
      ['FSSAI', 'Packaged food carries an FSSAI licence number on the pack.']],
    tip: 'Add your PIN code to see which shops near you deliver by Express.',
    budget: 500,
  },
  appliances: {
    intro: 'Kitchen and home appliances that save time every day.',
    points: [['Power', 'Higher wattage cooks and heats faster but uses more electricity.'],
      ['Star rating', 'More BEE stars mean lower electricity bills over the years.'],
      ['Capacity', 'An air fryer of 4 litres suits a family of 3 to 4.'],
      ['Service', 'Check the warranty and whether the brand has service centres in your city.']],
    tip: 'Pay with no-cost EMI and keep the invoice from your order page for warranty claims.',
    budget: 5000,
  },
};

async function viewHub(slug) {
  const c = state.categories.find((x) => x.slug === slug);
  if (!c) { viewPage('missing'); return; }
  const g = GUIDES[slug] || { intro: '', points: [], tip: '', budget: 1000 };
  document.title = `${c.name} · Bazaario`;
  const q = `category=${encodeURIComponent(slug)}`;
  const [top, value, budget, all] = await Promise.all([
    api('GET', `/products?${q}&sort=rating&limit=8`),
    api('GET', `/products?${q}&sort=discount&limit=8`),
    api('GET', `/products?${q}&max=${g.budget}&sort=rating&limit=8`),
    api('GET', `/products?${q}&limit=1`),
  ]);
  const row = (title, tagline, link, items) => (items.length ? h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('div', null, h('h2', null, title), h('p', { class: 'tagline' }, tagline)),
      h('a', { class: 'btn btn-ghost', href: link }, 'View all')),
    h('div', { class: 'grid' }, items.map((p) => productCard(p)))) : null);
  const ads = top.sponsored || [];
  mount(
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('span', null, c.name)),
    h('section', { class: 'hub-hero' },
      h('div', null, h('h1', null, c.name), h('p', null, g.intro),
        h('p', { class: 'hint' }, `${all.total} products · ${all.brands.length} brands`),
        h('div', { class: 'chip-set' }, all.brands.slice(0, 8).map((b) => h('a', { class: 'fchip', href: `#/s?${q}&brand=${encodeURIComponent(b.brand)}` }, b.brand)))),
      h('a', { class: 'btn btn-primary', href: `#/s?${q}` }, `Shop all ${c.name}`)),
    ads.length ? h('section', { class: 'section' }, h('div', { class: 'grid' }, ads.map(sponsoredCard))) : null,
    g.points.length ? h('section', { class: 'guide card' },
      h('h2', null, `Buying guide: ${c.name}`),
      h('div', { class: 'guide-grid' }, g.points.map(([t, d]) => h('div', { class: 'guide-point' }, h('h3', null, t), h('p', null, d)))),
      h('p', { class: 'guide-tip' }, h('b', null, 'Tip: '), g.tip)) : null,
    row('Top rated', `Best reviewed in ${c.name}`, `#/s?${q}&sort=rating`, top.items),
    row(`Under ${inr(g.budget * 100)}`, 'Good picks that cost less', `#/s?${q}&max=${g.budget}`, budget.items),
    row('Biggest savings', 'The most off the MRP right now', `#/s?${q}&sort=discount`, value.items));
}

// ---------------- Seller Hub: Ads ----------------
async function hubAds(body) {
  const { campaigns, products, unbilled, rules } = await api('GET', '/seller/ads');
  const prod = h('select', { 'aria-label': 'Product to promote' }, products.map((p) => h('option', { value: p.id }, p.title)));
  const bid = h('input', { type: 'number', min: rules.minBid / 100, max: rules.maxBid / 100, value: 5, required: true });
  const budget = h('input', { type: 'number', min: rules.minDailyBudget / 100, value: rules.minDailyBudget / 100 * 2, required: true });
  const today = campaigns.reduce((s, a) => s + a.today, 0);
  const update = async (a, patch, msg) => { try { await api('PATCH', `/seller/ads/${a.id}`, patch); toast(msg); route(); } catch (ex) { fail(ex); } };
  fill(body,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Spent today'), h('b', null, inr(today))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'To be taken from your next payout'), h('b', null, inr(unbilled))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Clicks so far'), h('b', null, campaigns.reduce((s, a) => s + a.clicks, 0)))),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' }, h('h3', null, 'Your sponsored products'),
        campaigns.length ? h('div', { class: 'table-wrap' }, h('table', null,
          h('tr', null, ['Product', 'Cost per click', 'Daily budget', 'Today', 'Clicks', 'Spent', 'Status', ''].map((t) => h('th', null, t))),
          campaigns.map((a) => h('tr', null, h('td', null, a.title), h('td', null, inr(a.bid)), h('td', null, inr(a.daily_budget)),
            h('td', null, a.today >= a.daily_budget - a.bid + 1 ? h('span', { class: 'low' }, `${inr(a.today)} (budget reached)`) : inr(a.today)),
            h('td', null, a.clicks), h('td', null, inr(a.spend)), h('td', { class: a.status === 'active' ? 'ok' : 'muted' }, a.status === 'active' ? 'Showing' : 'Paused'),
            h('td', null, h('button', { class: 'btn btn-sm btn-outline', onclick: () => update(a, { status: a.status === 'active' ? 'paused' : 'active' },
              a.status === 'active' ? 'Paused.' : 'Showing again.') }, a.status === 'active' ? 'Pause' : 'Resume'))))))
          : h('p', { class: 'muted' }, 'You are not promoting anything yet.')),
      h('div', { class: 'card' }, h('h3', null, 'Promote a product'),
        products.length ? h('form', { onsubmit: async (e) => {
          e.preventDefault();
          try { await api('POST', '/seller/ads', { productId: Number(prod.value), bid: Number(bid.value), dailyBudget: Number(budget.value) }); toast('Your product is now sponsored in search.'); route(); } catch (ex) { fail(ex); }
        } }, h('label', null, 'Product'), prod,
          h('div', { class: 'form-grid' }, h('div', null, h('label', null, 'Cost per click (₹)'), bid), h('div', null, h('label', null, 'Daily budget (₹)'), budget)),
          h('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Start promoting'))
          : h('p', { class: 'muted' }, 'Add a product to sell first, then promote it here.'),
        h('ul', { class: 'hint' },
          h('li', null, `Your product shows as "Sponsored" at the top of matching searches and category pages, in up to ${rules.slots} places.`),
          h('li', null, `You pay ${inr(rules.minBid)} to ${inr(rules.maxBid)} per click, only once a day for each shopper. Your own clicks are free.`),
          h('li', null, 'It stops showing for the day when the budget is reached.'),
          h('li', null, 'What you spend is taken from your next payout and shown on the statement.')))));
}

// ---------------- Studio ----------------
const dtLocal = (ts) => new Date(ts + 330 * 60000).toISOString().slice(0, 16);
const fromLocal = (val) => (val ? new Date(`${val}:00+05:30`).getTime() : null);

async function studioGrowth(tab, body) {
  if (tab === 'sales') {
    const [{ sales }, { products }] = await Promise.all([api('GET', '/admin/sales'), api('GET', '/admin/products')]);
    const now = Date.now();
    const statusOf = (s) => (!s.active ? 'Switched off' : s.ends_at <= now ? 'Ended' : s.starts_at <= now ? 'Live' : 'Scheduled');
    const name = h('input', { required: true, maxLength: 60, placeholder: 'Diwali Dhamaka' });
    const slug = h('input', { required: true, maxLength: 40, pattern: '[a-z0-9-]+', placeholder: 'diwali' });
    const tagline = h('input', { maxLength: 120 });
    const starts = h('input', { type: 'datetime-local', required: true, value: dtLocal(now + 86400000) });
    const ends = h('input', { type: 'datetime-local', required: true, value: dtLocal(now + 4 * 86400000) });
    const early = h('input', { type: 'number', min: 0, max: 72, value: 24 });
    const pick = h('select', { 'aria-label': 'Product' }, products.map((p) => h('option', { value: p.id }, p.title)));
    const off = h('input', { type: 'number', min: 1, max: 90, value: 20, 'aria-label': 'Discount (%)' });
    const chosen = new Map();
    const list = h('div', { class: 'sale-pick-list' });
    const paintList = () => fill(list, chosen.size ? [...chosen].map(([id, pc]) => h('div', { class: 'sale-pick' },
      h('span', null, products.find((p) => p.id === id).title), h('b', null, `${pc}% off`),
      h('button', { type: 'button', class: 'link-btn danger', onclick: () => { chosen.delete(id); paintList(); } }, 'Remove')))
      : h('p', { class: 'hint' }, 'No products added yet.'));
    paintList();
    add(body,
      h('div', { class: 'card', style: { marginBottom: '16px' } }, h('h3', null, 'Sale events'),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('tr', null, ['Sale', 'Runs', 'Plus early', 'Products', 'Orders', 'Revenue', 'Discount we paid', 'Status', ''].map((t) => h('th', null, t))),
          sales.map((s) => h('tr', null, h('td', null, h('a', { href: `#/sale/${s.slug}` }, s.name)),
            h('td', null, `${shortDate(s.starts_at)} to ${shortDate(s.ends_at)}`), h('td', null, s.early_hours ? `${s.early_hours} h` : '—'),
            h('td', null, s.items.length), h('td', null, s.performance.orders), h('td', null, inr(s.performance.revenue)), h('td', null, inr(s.performance.cost)),
            h('td', { class: statusOf(s) === 'Live' ? 'ok' : 'muted' }, statusOf(s)),
            h('td', null, h('button', { class: 'btn btn-sm btn-outline', onclick: async () => {
              try { await api('PATCH', `/admin/sales/${s.id}`, { active: !s.active }); toast(s.active ? 'Sale switched off.' : 'Sale switched on.'); route(); } catch (ex) { fail(ex); }
            } }, s.active ? 'Switch off' : 'Switch on'))))))),
      h('div', { class: 'card' }, h('h3', null, 'Plan a sale'),
        h('p', { class: 'hint' }, 'Sale discounts are paid by Bazaario. Sellers are paid their own price, and invoices show the price the buyer paid.'),
        h('form', { onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api('POST', '/admin/sales', { name: name.value, slug: slug.value, tagline: tagline.value, startsAt: fromLocal(starts.value), endsAt: fromLocal(ends.value),
              earlyHours: Number(early.value), items: [...chosen].map(([productId, pc]) => ({ productId, pct: pc })) });
            toast('Sale saved.'); route();
          } catch (ex) { fail(ex); }
        } },
        h('div', { class: 'form-grid' },
          h('div', null, h('label', null, 'Sale name'), name), h('div', null, h('label', null, 'Web address'), slug),
          h('div', null, h('label', null, 'Starts'), starts), h('div', null, h('label', null, 'Ends'), ends),
          h('div', null, h('label', null, 'Plus early access (hours)'), early), h('div', null, h('label', null, 'Tagline'), tagline)),
        h('h4', null, 'Products in the sale'),
        h('div', { class: 'sale-pick-add' }, pick, off, h('button', { type: 'button', class: 'btn btn-outline', onclick: () => { chosen.set(Number(pick.value), Number(off.value)); paintList(); } }, 'Add')),
        list,
        h('button', { class: 'btn btn-primary', style: { marginTop: '12px' } }, 'Save sale'))));
  }

  if (tab === 'reports') {
    const days = new URLSearchParams(location.hash.split('?')[1] || '').get('days') || '90';
    const r = await api('GET', `/admin/reports?days=${days}`);
    const SPEED = { express: 'Express', standard: 'Standard' };
    const plusRow = (flag) => r.plus.find((p) => p.plus === flag) || { orders: 0, aov: 0, buyers: 0 };
    const maxCat = Math.max(1, ...r.categories.map((c) => c.revenue));
    const KIND = { cart: 'Bag left behind', price_drop: 'Price drop', back_in_stock: 'Back in stock' };
    const sel = h('select', { 'aria-label': 'Period', style: { width: 'auto' }, onchange: (e) => { location.hash = `#/admin?tab=reports&days=${e.target.value}`; } },
      [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']].map(([k, l]) => h('option', { value: k, selected: k === String(r.days) }, l)));
    const winOut = h('span', { class: 'hint' });
    add(body,
      h('p', null, h('label', { class: 'inline' }, 'Period: ', sel)),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Buyers'), h('b', null, r.customers.buyers)),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Repeat rate'), h('b', null, pctText(r.customers.repeatRate)), h('span', { class: 'hint' }, `${many(r.customers.repeaters, 'buyer')} bought again`)),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Average order'), h('b', null, inr(r.customers.aov))),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Customer lifetime value'), h('b', null, inr(r.customers.ltv)), h('span', { class: 'hint' }, `across ${many(r.customers.lifetimeBuyers, 'buyer')}`)),
        h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Plus sign-ups'), h('b', null, r.memberships.n), h('span', { class: 'hint' }, inr(r.memberships.revenue)))),
      h('div', { class: 'report-grid' },
        h('div', { class: 'card' }, h('h3', null, 'By delivery speed'),
          h('table', null, h('tr', null, ['Speed', 'Orders', 'Revenue', 'Average order', 'On time'].map((t) => h('th', null, t))),
            r.bySpeed.map((s) => h('tr', null, h('td', null, SPEED[s.speed] || s.speed), h('td', null, s.orders), h('td', null, inr(s.revenue)),
              h('td', null, inr(Math.round(s.aov))), h('td', null, s.on_time ? pctText(s.on_time) : '—'))))),
        h('div', { class: 'card' }, h('h3', null, 'By seller type'),
          h('table', null, h('tr', null, ['Seller type', 'Orders', 'Revenue'].map((t) => h('th', null, t))),
            r.byLane.map((l) => h('tr', null, h('td', null, LANE_LABEL[l.lane] || l.lane), h('td', null, l.orders), h('td', null, inr(l.revenue)))))),
        h('div', { class: 'card' }, h('h3', null, 'Plus members and everyone else'),
          h('table', null, h('tr', null, ['', 'Buyers', 'Orders', 'Average order'].map((t) => h('th', null, t))),
            [[1, 'Plus members'], [0, 'Others']].map(([f, l]) => { const x = plusRow(f); return h('tr', null, h('td', null, l), h('td', null, x.buyers), h('td', null, x.orders), h('td', null, inr(Math.round(x.aov)))); }))),
        h('div', { class: 'card' }, h('h3', null, 'What growth tools brought in'),
          h('table', null, h('tr', null, ['Tool', 'Result', 'Cost or income'].map((t) => h('th', null, t))),
            h('tr', null, h('td', null, 'Sale events'), h('td', null, `${many(r.tools.sale.orders, 'order')}, ${inr(r.tools.sale.revenue)}`), h('td', null, minus(r.tools.sale.cost))),
            h('tr', null, h('td', null, 'Coupons'), h('td', null, many(r.tools.coupons.orders, 'order')), h('td', null, minus(r.tools.coupons.cost))),
            h('tr', null, h('td', null, 'Referrals'), h('td', null, `${r.tools.referrals.joined} joined, ${r.tools.referrals.rewarded} ordered`),
              h('td', null, minus(r.tools.referrals.rewarded * (((state.config.referral || {}).referrerReward || 0) + ((state.config.referral || {}).friendReward || 0))))),
            h('tr', null, h('td', null, 'Resellers'), h('td', null, many(r.tools.resellers.orders, 'order')), h('td', null, `${inr(r.tools.resellers.margin)} to resellers`)),
            h('tr', null, h('td', null, 'Sponsored listings'), h('td', null, many(r.tools.ads.clicks, 'click')), h('td', { class: 'ok' }, `+${inr(r.tools.ads.revenue)}`)),
            h('tr', null, h('td', null, 'Win-back messages'), h('td', { colSpan: 2 }, r.tools.winback.length ? r.tools.winback.map((w) => `${KIND[w.kind]}: ${w.sent}`).join(' · ') : 'None sent'))))),
      h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Top categories'),
        r.categories.length ? r.categories.map((c) => h('div', { class: 'bar-row cat-bar' }, h('span', null, c.name),
          h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round((c.revenue / maxCat) * 100)}%` } })), h('span', null, inr(c.revenue))))
          : h('p', { class: 'muted' }, 'No orders in this period.')),
      h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Win-back messages'),
        h('p', { class: 'hint' }, 'Sent every hour by email and SMS: a bag left for a day, a wishlist item whose price dropped, and a wishlist item back in stock. Never twice for the same thing, and only to buyers who allow offers.'),
        h('div', { class: 'hero-cta' }, h('button', { class: 'btn btn-outline', onclick: async () => {
          try { const o = await api('POST', '/admin/winback/run'); winOut.textContent = `Sent now: ${o.cart} bag, ${o.priceDrop} price drop, ${o.backInStock} back in stock.`; } catch (ex) { fail(ex); }
        } }, 'Send win-back messages now'), winOut)));
  }

  if (tab === 'plus') {
    const { members, revenue } = await api('GET', '/admin/plus');
    add(body, h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Members now'), h('b', null, members.length)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Plus income so far'), h('b', null, inr(revenue)))),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Member', 'Plan', 'Since', 'Until', 'Renews'].map((t) => h('th', null, t))),
      members.map((m) => h('tr', null, h('td', null, m.name, h('div', { class: 'hint' }, m.email)), h('td', null, cap(m.plan)),
        h('td', null, fmtDate(m.starts_at)), h('td', null, fmtDate(m.ends_at)), h('td', null, m.auto_renew ? 'Yes' : 'No')))))));
  }

  if (tab === 'ads') {
    const { campaigns } = await api('GET', '/admin/ads');
    add(body, h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Showing now'), h('b', null, campaigns.filter((a) => a.status === 'active').length)),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Clicks'), h('b', null, campaigns.reduce((s, a) => s + a.clicks, 0))),
      h('div', { class: 'stat' }, h('span', { class: 'hint' }, 'Ad income'), h('b', null, inr(campaigns.reduce((s, a) => s + a.spend, 0))))),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null,
      h('tr', null, ['Seller', 'Product', 'Cost per click', 'Daily budget', 'Clicks', 'Spent', 'Status'].map((t) => h('th', null, t))),
      campaigns.map((a) => h('tr', null, h('td', null, a.seller), h('td', null, a.title), h('td', null, inr(a.bid)), h('td', null, inr(a.daily_budget)),
        h('td', null, a.clicks), h('td', null, inr(a.spend)), h('td', null, a.status === 'active' ? 'Showing' : 'Paused')))))));
  }
}

// ---------------- Profile: offers and reminders ----------------
async function marketingCard() {
  const pref = await api('GET', '/account/preferences').catch(() => ({ marketing: true }));
  const box = h('input', { type: 'checkbox', checked: pref.marketing, onchange: async (e) => {
    try { await api('PATCH', '/account/preferences', { marketing: e.target.checked }); toast(e.target.checked ? 'You will hear about offers and price drops.' : 'Offers and reminders are off.'); } catch (ex) { fail(ex); }
  } });
  return h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', null, 'Offers and reminders'),
    h('label', { class: 'inline' }, box, 'Tell me about price drops, items back in stock and things left in my bag'),
    h('p', { class: 'hint' }, 'By email and SMS, at most once every few days for the same item. Order updates are always sent.'));
}
