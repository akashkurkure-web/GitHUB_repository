'use strict';
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');
const { hashPassword } = require('./security');
const market = require('./market');
const kyc = require('./kyc');
const geo = require('./geo');

const CATEGORIES = [
  ['mobiles', 'Mobiles', '📱'],
  ['electronics', 'Electronics', '💻'],
  ['fashion', 'Fashion', '👕'],
  ['home-kitchen', 'Home & Kitchen', '🏠'],
  ['books', 'Books', '📚'],
  ['beauty', 'Beauty', '💄'],
  ['sports', 'Sports & Fitness', '🏏'],
  ['toys', 'Toys & Games', '🧸'],
  ['grocery', 'Grocery', '🛒'],
  ['appliances', 'Appliances', '🔌'],
];

// [category, title, brand, price(₹), mrp(₹), stock, emoji, color, express, deal, features]
const PRODUCTS = [
  ['mobiles', 'Nova X5 5G (8GB RAM, 128GB) - Midnight Blue', 'Nova', 17999, 24999, 120, '📱', '#dbe7ff', 1, 1, ['6.6" 120Hz AMOLED display', '50MP triple camera', '5000mAh battery with 33W charging', 'Android 15']],
  ['mobiles', 'Pixelon 9 Pro (12GB, 256GB) - Graphite', 'Pixelon', 64999, 79999, 40, '📱', '#e5e5e5', 1, 0, ['6.7" LTPO display', 'Tensor-class AI chip', '7 years of OS updates', 'IP68']],
  ['mobiles', 'Volt Lite 4G (4GB, 64GB) - Green', 'Volt', 7499, 9999, 300, '📱', '#dff5e1', 0, 1, ['6.5" HD+ display', '13MP dual camera', '5000mAh battery']],
  ['mobiles', 'Fast Charge 65W USB-C Charger', 'ChargeUp', 1299, 2499, 500, '🔌', '#fff3d6', 1, 1, ['GaN technology', 'Universal compatibility', 'BIS certified']],
  ['electronics', 'AirBeat Pro Wireless Earbuds with ANC', 'AirBeat', 2999, 6999, 250, '🎧', '#f0e6ff', 1, 1, ['Active noise cancellation', '40hr playtime', 'IPX5 water resistant', 'Low-latency game mode']],
  ['electronics', 'UltraBook 14 Laptop (i5, 16GB, 512GB SSD)', 'Stellar', 58990, 72990, 30, '💻', '#e8eef5', 1, 0, ['14" 2.2K display', '1.3kg ultralight', 'Backlit keyboard', 'Windows 11 + Office']],
  ['electronics', 'Smart Watch Fit 3 with SpO2 & Calling', 'Fitora', 1999, 5999, 400, '⌚', '#ffe3e3', 1, 1, ['1.9" AMOLED', 'Bluetooth calling', '100+ sports modes', '7-day battery']],
  ['electronics', '43" 4K Ultra HD Smart LED TV', 'Visionex', 24999, 39999, 25, '📺', '#dde9f0', 0, 1, ['4K HDR10', 'Dolby Audio 30W', 'Built-in streaming apps', '3 HDMI ports']],
  ['electronics', 'Portable Bluetooth Speaker 20W', 'BoomBox', 1799, 3499, 180, '🔊', '#d9f2f2', 1, 0, ['20W stereo sound', '12hr playtime', 'IPX7 waterproof']],
  ['electronics', 'Mirrorless Camera Kit 24MP with 18-55mm Lens', 'Optiq', 52990, 61990, 12, '📷', '#efe9e1', 0, 0, ['24MP APS-C sensor', '4K video', 'Flip screen for vlogging']],
  ['fashion', "Men's Cotton Slim Fit Casual Shirt", 'UrbanThread', 599, 1499, 600, '👔', '#e1ecf7', 1, 1, ['100% cotton', 'Machine wash', 'Sizes S-XXL']],
  ['fashion', "Women's Printed Kurta Set", 'Desi Weaves', 899, 2499, 350, '👗', '#fbe1ec', 1, 1, ['Rayon fabric', 'Kurta + palazzo', 'Festive wear']],
  ['fashion', 'Running Shoes - Lightweight Mesh', 'Stride', 1499, 3999, 220, '👟', '#e6f4ea', 1, 0, ['Breathable mesh upper', 'Cushioned sole', 'Sizes 6-11']],
  ['fashion', 'Unisex Polarised Aviator Sunglasses', 'SunCraft', 699, 1999, 300, '🕶️', '#f3f0e6', 0, 0, ['UV400 protection', 'Metal frame', 'Includes case']],
  ['fashion', 'Leather Bi-fold Wallet for Men', 'Hideworks', 449, 1299, 500, '👛', '#efe4d9', 1, 0, ['Genuine leather', 'RFID blocking', '8 card slots']],
  ['home-kitchen', 'Non-Stick Cookware Set (3 pcs)', 'ChefNest', 1299, 2999, 150, '🍳', '#fdebd3', 1, 1, ['Induction compatible', 'PFOA free', 'Includes kadai, tawa, frypan']],
  ['home-kitchen', 'Stainless Steel Water Bottle 1L (Pack of 2)', 'HydraSteel', 549, 999, 800, '🧴', '#e3f1f9', 1, 0, ['Leak proof', 'Rust free', 'Fridge friendly']],
  ['home-kitchen', 'Cotton Double Bedsheet with 2 Pillow Covers', 'SleepWell Home', 799, 1999, 260, '🛏️', '#ece6f7', 0, 1, ['210 TC cotton', 'King size', 'Colourfast']],
  ['home-kitchen', 'LED Desk Lamp with 3 Brightness Modes', 'Lumio', 899, 1799, 140, '💡', '#fff8cf', 1, 0, ['Eye-care LED', 'USB charging', 'Flexible neck']],
  ['books', 'Atomic Discipline: Small Habits, Big Results (Paperback)', 'Lighthouse Press', 349, 599, 1000, '📘', '#e3ecff', 1, 1, ['Paperback, 320 pages', 'English', 'Bestseller']],
  ['books', 'The Indian Kitchen: 500 Home Recipes (Hardcover)', 'Saffron Books', 699, 999, 200, '📕', '#ffe1d6', 0, 0, ['Hardcover, 480 pages', 'Full-colour photos']],
  ['books', 'Crack the Coding Interview - 2026 Edition', 'TechReads', 549, 899, 400, '📗', '#e2f5e2', 1, 0, ['Paperback, 650 pages', '200+ solved problems']],
  ['beauty', 'Vitamin C Face Serum 30ml', 'GlowLab', 399, 799, 700, '🧪', '#fff1d9', 1, 1, ['10% Vitamin C', 'For all skin types', 'Dermatologically tested']],
  ['beauty', 'Matte Liquid Lipstick - Ruby Red', 'Velvet Muse', 299, 649, 500, '💄', '#ffd9de', 0, 0, ['Long lasting 16hr', 'Transfer proof']],
  ['beauty', 'Beard Grooming Kit with Trimmer', 'Groomsmith', 1499, 2999, 160, '🪒', '#e6e6ea', 1, 0, ['60 min runtime', '20 length settings', 'Includes beard oil']],
  ['sports', 'English Willow Cricket Bat - Full Size', 'Boundary', 2499, 4499, 70, '🏏', '#f6ecd9', 0, 1, ['Grade 2 English willow', 'Short handle', 'Includes cover']],
  ['sports', 'Anti-Skid Yoga Mat 6mm with Strap', 'Asana', 499, 1299, 450, '🧘', '#dff3ef', 1, 0, ['TPE material', 'Dual layer grip', 'Carry strap']],
  ['sports', 'Adjustable Dumbbell Set 20kg', 'IronCore', 2199, 3999, 90, '🏋️', '#e5e5e5', 0, 0, ['Chrome plated', 'Includes 2 rods + plates', 'Home gym ready']],
  ['toys', 'Building Blocks Set - 500 pcs', 'BrickTown', 999, 1999, 210, '🧱', '#ffe9c7', 1, 1, ['Age 6+', 'Compatible with major brands', 'Storage box']],
  ['toys', 'Remote Control Off-Road Car 1:16', 'TurboToys', 1599, 2999, 110, '🚙', '#dde8ff', 0, 0, ['2.4GHz remote', 'Rechargeable', '25 km/h top speed']],
  ['toys', 'Classic Board Game - Business Edition', 'FunFamily', 449, 799, 300, '🎲', '#f0e1ff', 1, 0, ['2-6 players', 'Age 8+']],
  ['grocery', 'Premium Basmati Rice 5kg', 'Royal Harvest', 649, 899, 900, '🍚', '#f6f3e8', 1, 1, ['Extra long grain', 'Aged 2 years']],
  ['grocery', 'Cold Pressed Groundnut Oil 1L', 'Farm Pure', 279, 349, 600, '🫙', '#fff4c9', 1, 0, ['Wood pressed', 'No chemicals']],
  ['grocery', 'Assam Tea 1kg', 'Tea Valley', 449, 599, 700, '🍵', '#eadfd4', 0, 0, ['Strong CTC tea', 'Direct from estates']],
  ['appliances', 'Mixer Grinder 750W with 3 Jars', 'KitchenPro', 2899, 4999, 130, '🥤', '#e3f0f7', 1, 1, ['750W copper motor', '3 stainless steel jars', '2 year warranty']],
  ['appliances', '1.5 Ton 5 Star Inverter Split AC', 'CoolBreeze', 36990, 54990, 20, '❄️', '#dff1fb', 0, 1, ['5 star energy rating', 'Copper condenser', 'Wi-Fi enabled']],
  ['appliances', 'Front Load Washing Machine 7kg', 'WashMate', 27990, 36990, 18, '🧺', '#e7ecf3', 0, 0, ['1200 RPM', 'Inbuilt heater', 'Steam wash']],
  ['appliances', 'Air Fryer 4.2L Digital', 'CrispAir', 3499, 6999, 140, '🍟', '#f2e4dc', 1, 1, ['Uses 90% less oil', '8 presets', 'Dishwasher-safe basket']],
];

const COUPONS = [
  ['WELCOME10', 'percent', 10, 20000, 49900, 'Flat 10% off up to ₹200 on orders above ₹499'],
  ['SAVE100', 'flat', 10000, null, 99900, '₹100 off on orders above ₹999'],
  ['FESTIVE15', 'percent', 15, 150000, 299900, '15% off up to ₹1,500 on orders above ₹2,999'],
];

const DESCRIPTION = (title, brand) =>
  `${title} by ${brand}. Covered by our ${config.returnWindowDays}-day easy return policy and 100% purchase protection.`;

// Drawn by scripts/draw-products.js, in the same order as PRODUCTS.
const PICTURES = [
  'nova-x5',
  'pixelon-9-pro',
  'volt-lite',
  'fast-charger-65w',
  'airbeat-pro',
  'ultrabook-14',
  'fitora-watch-3',
  'visionex-43-tv',
  'boombox-speaker',
  'optiq-camera',
  'urbanthread-shirt',
  'desi-weaves-kurta',
  'stride-running-shoes',
  'suncraft-aviators',
  'hideworks-wallet',
  'chefnest-cookware',
  'hydrasteel-bottles',
  'sleepwell-bedsheet',
  'lumio-desk-lamp',
  'atomic-discipline',
  'indian-kitchen-book',
  'coding-interview-book',
  'glowlab-vitamin-c',
  'velvet-muse-lipstick',
  'groomsmith-kit',
  'boundary-cricket-bat',
  'asana-yoga-mat',
  'ironcore-dumbbells',
  'bricktown-blocks',
  'turbotoys-rc-car',
  'funfamily-board-game',
  'royal-harvest-basmati',
  'farm-pure-groundnut-oil',
  'tea-valley-assam',
  'kitchenpro-mixer',
  'coolbreeze-split-ac',
  'washmate-front-load',
  'crispair-air-fryer',
];
// Demo marketplace sellers (blueprint stage 1). They have no sign-in; their offers sit next to Bazaario Direct's,
// a little dearer or slower, so Direct keeps the best offer until it runs out of stock.
const SELLERS = [
  { code: 'S0001', lane: 'standard', name: 'Shree Ganesh Traders', legal: 'Shree Ganesh Traders', gstin: '27ABCPG1234K1Z', city: 'Pune',
    state: 'Maharashtra', pincode: '411002', fulfilment: 'pickup',
    offers: [[11, 649, 120, 2], [16, 1349, 40, 2], [17, 579, 200, 1], [20, 369, 150, 2], [26, 2599, 15, 2], [32, 669, 80, 2, '2027-06']] },
  { code: 'S0002', lane: 'value', name: 'Jaipur Craft House', legal: 'Meena Devi Sharma', enrolment: 'EID080000012345', city: 'Jaipur',
    state: 'Rajasthan', pincode: '302001', fulfilment: 'self', offers: [[12, 949, 60, 2], [18, 829, 45, 2], [14, 749, 30, 3]] },
  { code: 'S0003', lane: 'brand', name: 'Nova Official Store', legal: 'Nova Mobility India Private Limited', gstin: '29AAECN4821M1Z',
    city: 'Bengaluru', state: 'Karnataka', pincode: '560034', fulfilment: 'fulfilled', brand: 'Nova', trademark: '4123456', offers: [[1, 18499, 50, 1]] },
];

function seedSellers(d, now) {
  const ins = d.prepare(`INSERT INTO sellers (code, lane, display_name, legal_name, gstin, enrolment_id, pan, brand_name, trademark_no,
    bank_ifsc, bank_last4, bank_name_at_bank, bank_ref, pickup_city, pickup_state, pickup_pincode, fulfilment, status, created_at, approved_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'HDFC0001234','4321',?,?,?,?,?,?,'approved',?,?,?)`);
  const insOffer = d.prepare(`INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, best_before, active, created_at, updated_at)
    VALUES (?,?,?,?,?,?,1,?,?)`);
  for (const s of SELLERS) {
    const gstin = s.gstin ? s.gstin + kyc.gstinCheckChar(s.gstin) : null;
    const id = Number(ins.run(s.code, s.lane, s.name, s.legal, gstin, s.enrolment || null, gstin ? gstin.slice(2, 12) : 'BQZPS4512K',
      s.brand || null, s.trademark || null, s.legal.toUpperCase(), `BENE-DEMO${s.code}`, s.city, s.state, s.pincode, s.fulfilment,
      now, now, now).lastInsertRowid);
    for (const [productId, price, stock, days, bestBefore] of s.offers) {
      insOffer.run(productId, id, price * 100, stock, days, bestBefore || null, now, now);
      market.syncProduct(d, productId);
    }
  }
}

// Bazaario Express (blueprint stages 6 to 8): riders in every Express city and one demo partner shop in Pune.
const RIDER_NAMES = ['Ravi', 'Imran', 'Suresh', 'Anil', 'Deepak', 'Farhan', 'Kiran', 'Manoj', 'Vikram', 'Salim', 'Ajay', 'Prakash'];
const DEMO_SHOP = { code: 'S0004', name: 'Kothrud Fresh Mart', legal: 'Sunil Jadhav', pan: 'BQZPJ6621L', city: 'Pune', state: 'Maharashtra',
  pincode: '411038', line1: 'Shop 4, Karve Road, Kothrud', radius: 5, open: 7, close: 23,
  offers: [['Premium Basmati Rice 5kg', 659, 25], ['Cold Pressed Groundnut Oil 1L', 285, 30], ['Assam Tea 1kg', 455, 20],
    ['Stainless Steel Water Bottle 1L (Pack of 2)', 559, 12], ['LED Desk Lamp with 3 Brightness Modes', 919, 6]] };

function seedExpress(d, now) {
  if (!d.prepare('SELECT 1 FROM riders LIMIT 1').get()) {
    const ins = d.prepare('INSERT INTO riders (name, phone, city, lat, lng, active, created_at) VALUES (?,?,?,?,?,1,?)');
    let n = 0;
    for (const [prefix, c] of Object.entries(geo.CITY_CENTRES)) {
      for (let k = 0; k < 3; k += 1) {
        // Riders wait around the city, 1 to 4 km from the centre.
        const at = geo.offset(c, 1 + k * 1.5, (Number(prefix) * 7 + k * 120) % 360);
        ins.run(RIDER_NAMES[n % RIDER_NAMES.length], `98${String(20000000 + n * 7919).slice(0, 8)}`, c.city, at.lat, at.lng, now);
        n += 1;
      }
    }
  }
  if (d.prepare("SELECT 1 FROM sellers WHERE lane = 'shop' LIMIT 1").get() || d.prepare('SELECT 1 FROM sellers WHERE code = ?').get(DEMO_SHOP.code)) return;
  const s = DEMO_SHOP;
  const at = geo.locate(s.pincode, 'demo-shop');
  const id = Number(d.prepare(`INSERT INTO sellers (code, lane, display_name, legal_name, pan, bank_ifsc, bank_last4, bank_name_at_bank, bank_ref,
    pickup_line1, pickup_city, pickup_state, pickup_pincode, fulfilment, status, lat, lng, radius_km, open_hour, close_hour, accepting,
    created_at, approved_at, updated_at) VALUES (?,'shop',?,?,?,'HDFC0001234','4321',?,?,?,?,?,?,'pickup','approved',?,?,?,?,?,1,?,?,?)`)
    .run(s.code, s.name, s.legal, s.pan, s.legal.toUpperCase(), `BENE-DEMO${s.code}`, s.line1, s.city, s.state, s.pincode,
      at.lat, at.lng, s.radius, s.open, s.close, now, now, now).lastInsertRowid);
  const insOffer = d.prepare('INSERT INTO offers (product_id, seller_id, price, stock, dispatch_days, active, created_at, updated_at) VALUES (?,?,?,?,1,1,?,?)');
  for (const [title, price, stock] of s.offers) {
    const p = d.prepare('SELECT id FROM products WHERE title = ?').get(title);
    if (p) insOffer.run(p.id, id, price * 100, stock, now, now);
  }
}

const pictureOf = (i) => (PICTURES[i] ? `img/products/${PICTURES[i]}.svg` : '');

function seed({ reset = false, log = console.log } = {}) {
  const d = db.get();
  if (reset) {
    d.exec(`DELETE FROM payout_lines; DELETE FROM claims; DELETE FROM payouts; DELETE FROM order_routes; DELETE FROM returns;
            DELETE FROM order_events; DELETE FROM notifications; DELETE FROM wallet_ledger; DELETE FROM ticket_messages; DELETE FROM tickets;
            DELETE FROM order_items; DELETE FROM orders; DELETE FROM reviews; DELETE FROM cart_items; DELETE FROM wishlist; DELETE FROM offers;
            DELETE FROM addresses; DELETE FROM sessions; DELETE FROM products; DELETE FROM categories; DELETE FROM coupons; DELETE FROM sellers;
            DELETE FROM otp_codes; DELETE FROM audit_log; DELETE FROM rider_payouts; DELETE FROM riders; DELETE FROM reseller_payouts;
            DELETE FROM reseller_shares; DELETE FROM resellers; DELETE FROM users;`);
  }
  const already = d.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (already > 0) {
    // Older stores were seeded before pictures existed: fill in only products that still have none.
    const fill = d.prepare("UPDATE products SET image = ? WHERE title = ? AND image = ''");
    PRODUCTS.forEach((row, i) => fill.run(pictureOf(i), row[1]));
    // Stores from before Express riders and partner shops get them now.
    db.tx((t) => seedExpress(t, Date.now()));
    return;
  }

  const now = Date.now();
  db.tx(() => {
    const insCat = d.prepare('INSERT INTO categories (slug, name, icon) VALUES (?,?,?)');
    for (const c of CATEGORIES) insCat.run(...c);
    const catId = Object.fromEntries(d.prepare('SELECT slug, id FROM categories').all().map((r) => [r.slug, r.id]));

    const insProd = d.prepare(`INSERT INTO products (title, brand, category_id, description, features, price, mrp, stock,
      rating_avg, rating_count, sold_count, emoji, color, image, express, is_deal, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    PRODUCTS.forEach(([cat, title, brand, price, mrp, stock, emoji, color, express, deal, features], i) => {
      // Deterministic pseudo-random "marketplace history" so listings look realistic.
      const rc = 40 + ((i * 97) % 4000);
      const ra = Math.round((3.6 + ((i * 37) % 14) / 10) * 10) / 10;
      insProd.run(title, brand, catId[cat], DESCRIPTION(title, brand), JSON.stringify(features), price * 100, mrp * 100,
        stock, Math.min(ra, 4.9), rc, rc * 3, emoji, color, pictureOf(i), express, deal, now - i * 3600_000);
    });

    market.backfill(d);
    seedSellers(d, now);
    seedExpress(d, now);

    const insCoupon = d.prepare('INSERT INTO coupons (code, kind, value, max_discount, min_order, description) VALUES (?,?,?,?,?,?)');
    for (const c of COUPONS) insCoupon.run(...c);

    let adminPassword = config.adminPassword;
    if (!adminPassword) {
      adminPassword = crypto.randomBytes(9).toString('base64url') + '9a';
      log(`\n[seed] Admin account created: ${config.adminEmail}  password: ${adminPassword}\n` +
          '[seed] Set ADMIN_EMAIL / ADMIN_PASSWORD env vars to choose your own. This password is shown only once.\n');
    }
    d.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run('Store Admin', config.adminEmail, hashPassword(adminPassword), 'admin', now);
  });
}

module.exports = { seed };

if (require.main === module) {
  db.open();
  seed({ reset: process.argv.includes('--reset') });
  console.log('[seed] done');
  db.close();
}
