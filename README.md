# Bazaario: Online Marketplace

A full-featured e-commerce website modelled on the feature set and security posture of large Indian marketplaces
(catalog, search, cart, wishlist, checkout with UPI/Card/COD, order tracking, returns, reviews, seller/admin console).
It uses its own original brand. **Do not reuse another company's name, logo, or trade dress.** That is trademark
infringement and passing-off under the Indian Trade Marks Act, 1999.

| Layer | Technology |
|---|---|
| Backend | Node.js 22.5+, Express 5 |
| Database | SQLite (built into Node, `node:sqlite`). No separate DB server needed |
| Frontend | Vanilla JS single-page app, no build step |
| Security | Helmet (strict CSP, HSTS), scrypt, CSRF tokens, rate limiting, account lockout, RBAC, audit log |

---

## 0. Open it online (no download)

> First merge this code into the `main` branch on GitHub. Both options below use `main` by default.

### Option A: GitHub Codespaces (private, about 2 minutes, nothing to install)
1. Open the repository on github.com and switch to the branch that holds this code.
2. Click the green **Code** button → **Codespaces** tab → **Create codespace on …**.
3. Wait about 1-2 minutes. Dependencies install and the store starts by itself; a browser tab opens at
   `https://<name>-3000.app.github.dev`.
   *If no tab opens:* open the **Ports** tab at the bottom, then click the 🌐 icon next to port 3000.
4. Admin portal: open `/admin` and sign in with `admin@bazaario.local` / `ChangeMe123` (set in `.devcontainer/devcontainer.json`; change it there). 
5. *To share the link with others:* Ports tab → right-click port 3000 → **Port Visibility → Public**.
   - The codespace stops after 30 minutes of inactivity. Reopen it from github.com/codespaces.
   - Personal accounts get about 60 free hours a month.

### Option B: Render (public website with HTTPS, free tier)
1. Sign up at <https://render.com> using **Sign in with GitHub**.
2. Click **New + → Blueprint**, pick this repository, and Render reads `render.yaml`.
   *Or use the button:* [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/akashkurkure-web/GitHUB_repository)
3. Click **Apply**. No settings to fill in.
4. After about 3-5 minutes your store is live at `https://bazaario-xxxx.onrender.com`.
   *To use your own domain:* Settings → Custom Domains.
5. Limits of the free plan:
   - It sleeps after 15 minutes idle, so the first visit takes about 50 seconds.
   - **Its disk is wiped on every restart or redeploy**, so orders and accounts reset to demo data.
   - *Workaround for permanent data:* upgrade to the Starter plan, add a **Disk** mounted at `/var/data`, and set the env var `DB_FILE=/var/data/bazaario.db`.

### Option C: Vercel with a free Turso database (data kept for good)
1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import this repository → **Deploy**.
2. In the project open **Storage → Create Database → Turso** (free) and connect it to the project, ticking **Production** and **Preview**. Vercel adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for you.
3. **Deployments → ⋯ → Redeploy**. Open `https://<your-site>/admin` and create your owner account.
   *Without step 2* the store still runs, but Vercel wipes its data on restart, so treat it as a preview.

*Other hosts that work the same way:* Railway, Fly.io, Azure App Service, AWS Elastic Beanstalk. Use the Docker image from Section 4.

---

## 0a. Install it as an app (Android, Windows, Mac, iPhone)

Bazaario is a Progressive Web App: one codebase that installs like a native app, with its own window, icon,
app-switcher entry and offline screen. No app store is needed. Installing needs the site on **HTTPS**
(Codespaces, Render and any production setup in Section 5 qualify; `http://localhost` also works for testing).
Shoppers can also open **Get the app** in the footer (`#/app`) for these same steps.

| Device | Steps |
|---|---|
| **Android** | Open the store in Chrome → three-dot menu → **Install app** (or *Add to Home screen*) → **Install** |
| **Windows** | Open it in Edge or Chrome → click the install icon in the address bar → **Install**. It is added to the Start menu; right-click to pin it to the taskbar |
| **Mac** | Safari (macOS Sonoma+): **File → Add to Dock**. Chrome/Edge: install icon in the address bar → **Install** |
| **iPhone / iPad** | Safari → **Share** → **Add to Home Screen** |

*Workaround if you need a listing in Google Play or the Microsoft Store:* go to <https://www.pwabuilder.com>, enter your live
HTTPS store URL, and download the generated Android (Trusted Web Activity) or Windows (MSIX) package to upload to the store.
For Google Play you also host the `assetlinks.json` file PWABuilder gives you at `public/.well-known/assetlinks.json`.

What makes it installable: `public/manifest.webmanifest` (name, colours, icons, shortcuts), `public/icons/`,
and `public/sw.js`, a service worker that caches the storefront files and shows `public/offline.html` when there is
no connection. API responses (prices, stock, carts, orders) are never cached. After changing `styles.css` or `app.js`,
bump `VERSION` in `public/sw.js` so installed apps pick up the change immediately.

---

## 1. Feature map (marketplace parity)

| Area | Features |
|---|---|
| **Header** | Delivery strip with PIN code, logo, rounded search with live suggestions and category scope, Account · Orders · Wishlist · Bag icons, category chips |
| **Home** | Auto-rotating hero banners, category tiles, Today's Deals carousel, top rated, browsing history |
| **Search / listing** | Keyword search, category, brand facets, price ranges & custom range, rating "& Up", Express delivery, deals, in-stock filters; 6 sort orders; pagination |
| **Product page** | Price / MRP / % off, "Inclusive of all taxes", EMI, coupon offers, PIN-code delivery promise (Express time, Standard date, COD), stock status, qty, Add to Cart, Buy Now, Wish List, feature bullets, related products |
| **Reviews** | Star distribution, write review, one review per customer, **Verified Purchase** badge only for delivered orders |
| **Cart** | Guest cart (merged into account on sign-in), qty change, delete, Save for later, free-delivery progress bar |
| **Delivery speeds** | Express in under 90 minutes in 8 partner cities for Express items (8 am to 7:30 pm IST), Standard in 2 to 7 days by zone, no COD on the islands (`src/delivery.js`) |
| **Checkout** | Address book with Indian states & PIN validation, delivery speed choice, UPI / Card (Luhn + expiry) / no-cost EMI (₹3,000+) / Cash on Delivery with a risk check / Bazaario wallet, coupons, free delivery over ₹499, savings summary, idempotent "Place order" (no double orders) |
| **Orders** | Order history, tracking stepper and timeline (Confirmed → Packed → Shipped → Out for delivery → Delivered), courier and tracking number, missed-delivery rescheduling, RTO after failed attempts, cancel until shipped (auto-refund + restock), SMS and email on every step, Buy it again |
| **Returns and wallet** | Return with a reason inside 10 days, doorstep pickup, refund to the wallet (instant) or the original payment method, COD refunds to the wallet, wallet balance usable at checkout |
| **Help centre** | Questions by topic, support requests with a 24-hour reply target, Grievance Officer complaints acknowledged at once and due in 30 days, policy pages (terms, privacy, returns, shipping, cancellation, grievance) |
| **Account** | Profile, change password (signs out other devices), sign in with a mobile OTP, addresses, wish list, wallet, my requests |
| **Marketplace** | One page per product with many sellers; the best offer (price, dispatch speed, seller score) wins the buy box and the rest show under "Other sellers"; **Bazaario Assured** badge and filter for Direct and top sellers; seller details on every product (name, address, GSTIN, score) as the E-Commerce Rules require; only brands and Bazaario sell mobiles, electronics and beauty |
| **Seller sign-up** | Three ways to sell: Brand, Standard (GSTIN) and Value (GST enrolment ID, 0% commission, sells within its own state); GSTIN checksum, PAN and IFSC checks, ₹1 bank check, choice of Bazaario Fulfilled, Bazaario Pickup or Self Ship; Studio approves, rejects or suspends |
| **Seller Hub** | Overview with performance score (cancellations, late dispatch, seller-fault returns), add an offer to an existing product or create a new page (automatic checks, duplicate detection, quality check by a person), listings with inline price and stock, CSV bulk upload and download, orders to accept, pack and hand over, printable shipping label with barcode and GST invoice, returns and claims, payouts with every deduction shown |
| **Order routing** | One checkout, one payment, one order per seller; risk holds (big COD from new accounts, earlier refused COD, bulk quantities) checked in Studio; sellers accept within 24 hours, otherwise the order moves to the next seller at the same or lower price, or is cancelled and refunded |
| **Payouts** | Paid after the 10-day return window: commission by category, fulfilment fee, 18% GST on fees, GST TCS 0.5% (section 52) and TDS 0.1% (section 194-O); claims added to the next payout; tax invoice (CGST and SGST, or IGST) or bill of supply per seller; daily money check in Studio |
| **Partner shops (Express)** | Neighbourhood shops join at `#/partner` with PAN or GSTIN, a 2 to 5 km delivery radius and opening hours; buyers inside the radius see "Express near you" on the product page and a "Switch to Express" option in the bag; shop items always come by Express; 10% commission, no fees, paid the day after delivery |
| **Shop Partner app** (`#/shop`) | Open or pause the shop, new orders with a 2-minute countdown (missed orders move to the nearest other shop or the Bazaario city store), pack for the rider, orders with rider, stock, daily earnings and payouts, delivery area and hours |
| **Riders and live tracking** | The nearest free rider in the city is assigned when an Express order is packed (each order already carried counts as 1.5 km); the buyer sees a live map of the rider, the shop and their home, with the expected time, refreshed every 15 seconds; riders are paid ₹30 a trip plus ₹8 a km |
| **Resellers** (`#/resell`) | Anyone can join with a UPI ID, add their own margin (up to 30% of the price and never above MRP) and share a product on WhatsApp; the link (`#/r/CODE`) shows their price; the seller still gets their own price; the reseller sees customers (first name and city), orders and earnings, and is paid after the return window with TDS 2% (section 194H) above ₹20,000 a year |
| **Bazaario Plus** (`#/plus`) | ₹99 a month or ₹999 a year by UPI or card: free Standard delivery on every order, Express for ₹19 instead of ₹49, sales 24 hours early and members-only coupons; renewal can be turned off; the member page shows what Plus has saved |
| **Sale events** (`#/sale`) | Bazaario Utsav, Payday Sale and any sale planned in Studio: a percentage off chosen products for set dates, a sale band on the home page with a countdown, a sale page with category chips, and sale prices everywhere (cards, product page, bag, checkout). Bazaario pays the discount, so sellers keep their price |
| **Coupons and campaigns** | Coupons can have start and end dates, a limit per buyer and in total, first order only (FIRST150) or Plus only (PLUS200) |
| **Refer and earn** (`#/refer`) | Each buyer gets a code and a link to share on WhatsApp; when a friend who joined with it gets their first order, both get ₹100 in their wallets (up to 20 friends a month) |
| **Sponsored listings** | Sellers promote a product from Seller Hub > Ads at ₹2 to ₹50 a click with a daily budget; it shows as "Sponsored" at the top of searches and category pages (2 places); each shopper's click is charged once a day, own clicks are free, and spend comes off the next payout |
| **Win-back messages** | Every hour, by email and SMS: a bag left for a day, a wishlist price drop of 5% or more, and wishlist items back in stock; never twice for the same thing and only to buyers who allow offers (Profile > Offers and reminders) |
| **Category hubs** (`#/c/mobiles` and others) | A page per category with a buying guide, top-rated picks, budget picks and the biggest savings |
| **Hindi** | A हिन्दी / English button in the header switches the shopping screens to Hindi (Noto Sans Devanagari is served from the store itself); product names stay as the seller wrote them |
| **Reports** (Studio > Reports) | Repeat rate, average order, customer lifetime value, orders and on-time rate by delivery speed, seller types, Plus members against everyone else, and what sales, coupons, referrals, resellers, ads and win-back messages brought in |
| **Bazaario Studio (admin)** | Dashboard (revenue, open orders, failed deliveries, returns, late requests, low stock), order fulfilment workflow, returns queue, help desk inbox, outgoing messages, product CRUD with photo upload, customers, coupons, sellers (filter partner shops), catalog check, claims, settlement (sellers and resellers), Express board (assign or reassign riders, mark picked up or delivered), riders (add, on or off duty, pay), resellers (pause or reinstate), sales, reports, Plus members, sponsored listings, security audit log |

## 2. Security controls

| Threat (OWASP Top 10) | Control in this codebase |
|---|---|
| Injection (SQLi) | 100% parameterised queries; `LIKE` wildcards escaped (`src/routes/catalog.js`) |
| XSS | Strict Content-Security-Policy (`script-src 'self'`, no inline); UI renders all data via `textContent` only (`public/app.js`) |
| CSRF | Per-session synchroniser token (`X-CSRF-Token`) + Origin/Referer same-host check + `SameSite=Lax` cookie (`src/security.js`) |
| Broken authentication | scrypt hashing with per-user salt, password policy, 5-strike / 15-min lockout, per-IP rate limit, generic errors & constant-time compare (no user enumeration), session rotation on login, all sessions revoked on password change |
| Session hijacking | Random 256-bit token in `HttpOnly` cookie (`__Host-` prefix + `Secure` in production); only its SHA-256 is stored server-side; 7-day sliding expiry |
| Broken access control / IDOR | `requireAuth` / `requireAdmin` middleware; every customer query is scoped by `user_id`; staff roles (Owner, Manager, Support) checked on every admin request (`src/staff.js`) |
| Admin account takeover | Separate admin portal at `/admin` with its own session cookie (`Path=/api/admin`, `SameSite=Strict`), so a shopping session never opens it; optional sign-in code from an authenticator app (RFC 6238, each code works once) with one-time recovery codes; 30-minute idle sign-out and a 12-hour session limit |
| Price / business-logic tampering | Prices, discounts, shipping and totals are recomputed on the server; client prices are ignored; stock decremented atomically in a transaction (no overselling); order-status state machine |
| Sensitive data exposure | Card numbers never stored (only last 4 digits); no stack traces leaked; `Cache-Control: no-store` on API |
| Security misconfiguration | Helmet headers (HSTS, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy); `x-powered-by` removed; JSON body limit 50 KB; non-root Docker user |
| Logging & monitoring | `audit_log` table for logins, lockouts, orders, cancellations, admin changes (viewable in Bazaario Studio) |

> **Payments:** the bundled gateway is a validating **mock** (no money moves). For go-live, see Section 5, step 6.

---

## 3. Step-by-step: run on your computer (about 5 minutes)

**Step 1: Install prerequisites**
- Install **Node.js 22.5 or newer** from <https://nodejs.org> (LTS). Check with `node -v`.
- *Workaround if you can't upgrade Node:* use Docker (Section 4), or `nvm install 22` (macOS/Linux) / `nvm-windows`.

**Step 2: Get the code**
```bash
git clone https://github.com/akashkurkure-web/GitHUB_repository.git
cd GitHUB_repository
```

**Step 3: Install dependencies**
```bash
npm install
```
*Workaround behind a corporate proxy:* `npm config set proxy http://proxy:port` and `npm config set https-proxy http://proxy:port`.

**Step 4: Start**
```bash
npm start
```
**First visit: create your owner account.** Open <http://localhost:3000/admin>. A new store has no owner yet, so it shows **Set up your store**: enter your name, email and a password, and you are in. This happens only once; do it right after deploying, before you share the link. After that, sign in at `/admin` with your email and password.

*Optional extra safety:* Admin portal → **My account → Sign-in code → Turn on** adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator or Authy) to each sign-in, with 10 recovery codes for a lost phone.
*Optional:* to create the owner from the command line instead, start with `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='YourStr0ngPass' npm start`.

**Step 5: Open the store**
- Shop: <http://localhost:3000>
- Admin portal: <http://localhost:3000/admin> (its own sign-in, separate from the shop).

**Add staff (optional):** Admin portal → **Settings → Staff and roles → Add a staff member**, pick a role, and share the temporary password it shows. They sign in at `/admin` and choose their own password.

| Role | Can open |
|---|---|
| Owner | Everything, including staff accounts, roles and the audit log |
| Manager | Orders, returns, deliveries, catalog, sellers, resellers, claims, payouts, marketing, help desk, customers, reports |
| Support | Dashboard, orders (read only), returns, help desk, customers, messages sent |

**Forgotten password or lost phone**
- Staff: the owner opens **Staff and roles → Reset access**. The person gets a new temporary password (and their sign-in code, if on, is turned off).
- Owner with the sign-in code on: sign in with a saved recovery code, then **My account → Sign-in code → Set up a new phone**.
- Tip: add a second owner, so one can always reset the other.

**Step 6: Try a test purchase**
1. Register a customer account (top right → *Start here*).
2. Add a product → **Checkout** → add an address (any valid 6-digit PIN, 10-digit mobile starting 6-9).
3. Pay with UPI `test@okbank`, or card `4111 1111 1111 1111` with any future expiry like `12/30` and any CVV, or COD.
4. Apply coupon `WELCOME10`, `SAVE100` or `FESTIVE15`.
5. As admin, move the order Packed → Shipped → Delivered; as the customer, write a *Verified Purchase* review or request a return.

**Reset demo data:** stop the server, then `npm run seed` (or delete the `data/` folder).
**Run automated tests:** `npm test` (51 tests cover the catalog, auth, CSRF, IDOR, pricing, payments, orders, marketplace, Express, growth and the admin portal).

---

## 4. Step-by-step: run with Docker

```bash
docker build -t bazaario .
docker run -d --name bazaario -p 3000:3000 \
  -v bazaario-data:/app/data --restart unless-stopped bazaario
```
The named volume `bazaario-data` keeps the database across upgrades.

---

## 5. Step-by-step: go live on the internet (production)

1. **Server:** Ubuntu 22.04+ VM (AWS Lightsail/EC2, Azure, GCP, DigitalOcean), at least 1 vCPU / 1 GB RAM. Open ports 80 and 443 only.
2. **Domain:** buy a domain (e.g. `yourstore.in`) and point an **A record** at the server IP.
3. **Deploy the app:** Docker as in Section 4 (preferred), or Node + `pm2`:
   ```bash
   npm ci --omit=dev
   cp .env.example .env && nano .env        # set NODE_ENV=production and your admin credentials
   set -a; . ./.env; set +a
   npx pm2 start server.js --name bazaario --node-args="--no-warnings" && npx pm2 save && npx pm2 startup
   ```
4. **HTTPS (mandatory).** In production the session cookie is `Secure`, so sign-in only works over HTTPS. Put Nginx in front:
   ```nginx
   server {
     server_name yourstore.in;
     location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
                  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```
   then `sudo certbot --nginx -d yourstore.in`.
   *Workaround:* **Caddy** does HTTPS automatically (`yourstore.in { reverse_proxy 127.0.0.1:3000 }`). You can also put **Cloudflare** in front with SSL mode "Full (strict)".
5. **Backups:** schedule a daily copy of the database (e.g. cron: `sqlite3 data/bazaario.db ".backup /backups/bz-$(date +%F).db"`) to S3 or Blob storage.
6. **Test mode and real partners.** Out of the box, payments, courier tracking numbers and SMS/email run in **test mode**:
   nothing is charged or sent, and Bazaario Studio shows a test-mode banner and lists every message under **Messages**.
   Mobile OTP sign-in shows the code on screen in test mode, so it is switched **off** when `NODE_ENV=production` until a real
   SMS partner is connected (`SMS_PROVIDER`). Also set `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`,
   `GRIEVANCE_OFFICER_PHONE`, `GRIEVANCE_OFFICER_ADDRESS` and `COMPANY_NAME` before going live (see `.env.example`).
   **Real payments.** Before taking money, add a PCI-DSS compliant gateway (**Razorpay**, **PayU**, **Cashfree** or **Stripe India**)
   to `charge()` and `refund()` in `src/payments.js`, and set `PAYMENT_PROVIDER`:
   - create the order on the gateway server-side and open its hosted checkout/SDK in the browser (card data never touches your server);
   - mark the order `paid` **only** after verifying the gateway's webhook signature server-side;
   - add the gateway domains to the CSP in `server.js` (`script-src`, `frame-src`, `connect-src`).
7. **Marketplace sellers (before you onboard real sellers).**
   - Set `COMPANY_GSTIN` and `COMPANY_STATE` (Bazaario Direct's own GSTIN and state; they print on Direct invoices and decide CGST/SGST versus IGST).
   - Have your CA confirm commission, GST on fees, TCS and TDS rates in `src/config.js` (`market` block), and file GSTR-8 (TCS) and TDS returns every month from the Studio settlement report.
   - Connect a KYC and payouts partner: GSTIN and PAN verification (for example Signzy, Karza or the GSTN API), a real ₹1 penny drop and payouts (RazorpayX or Cashfree Payouts). Today `src/kyc.js` checks formats and checksums and `src/settlement.js` records a test UTR.
   - Publish seller terms (`#/page/terms`) covering commission, payout timing, claims and suspension.
8. **Compliance checklist (India):** GSTIN on invoices; Consumer Protection (E-Commerce) Rules 2020 (seller details, grievance officer,
   return/refund policy, country of origin); DPDP Act 2023 privacy notice & consent; RBI rules on card storage (this app already never stores card numbers).

### Scaling beyond one server
SQLite comfortably serves a single-server store. For multi-server or high traffic:
- move to **PostgreSQL** (the SQL is standard; swap `src/db.js` for a `pg` pool),
- move sessions and rate-limit counters to **Redis**,
- serve `public/` via a CDN (CloudFront / Cloudflare),
- store product images on object storage (S3) and add a search engine (OpenSearch / Meilisearch).

---

## 6. Design system

The storefront follows its own professional, compact design system, documented in [`DESIGN.md`](DESIGN.md): the Inter typeface, teal brand colour with a single clay primary action, 4px corners, bordered surfaces, tight spacing and no decorative icons.
These rules keep the site visually distinct from other marketplaces. Run the checklist at the end of `DESIGN.md` for any new screen.

## 6a. Project structure

```
server.js              Express app: security headers, rate limiting, routing, error handler
src/config.js          Business rules (shipping threshold, COD limit, return window, lockout policy)
src/db.js              SQLite schema & transaction helper
src/seed.js            Demo catalog (10 categories, 38 products), coupons, admin user
src/security.js        Password hashing, sessions, CSRF, RBAC, validation, audit
src/pricing.js         Server-side cart totals, coupons, shipping, Express fee, wallet, COD and EMI rules
src/delivery.js        Delivery promise by PIN code (Express cities, Standard days by zone, COD areas)
src/fulfilment.js      Order life cycle: status changes, timeline, refunds, restock, buyer messages
src/payments.js        Payment gateway adapter (test mode today)
src/notify.js          SMS and email outbox (test mode records messages)
src/wallet.js          Bazaario wallet ledger
src/routes/auth.js     Register, login, logout, profile, change password
src/routes/catalog.js  Categories, search & facets, product detail, reviews
src/routes/shopping.js Cart, save-for-later, guest-cart merge, wishlist, addresses
src/routes/orders.js   Checkout quote, place/cancel orders, missed-delivery rescheduling, returns, wallet
src/routes/support.js  Help desk tickets for buyers and the Studio inbox
src/routes/admin.js    Bazaario Studio (admin) APIs
src/routes/admin-auth.js  Admin portal sign-in (email and password; optional authenticator code), staff accounts
src/staff.js           Staff roles (Owner, Manager, Support) and the sections each one can open
src/totp.js            Authenticator app codes (RFC 6238)
src/market.js          Sellers and offers: best offer ranking, Assured badge, seller score, commission
src/routing.js         Order routing: risk holds, seller acceptance, rerouting and expiry
src/settlement.js      Seller payouts: commission, fees, GST on fees, TCS, TDS, claims, daily money check
src/invoice.js         GST tax invoice or bill of supply, and the shipping label
src/kyc.js             GSTIN checksum, PAN, IFSC and test bank check
src/listing.js         Listing details, automatic quality checks, duplicate detection
src/routes/seller.js   Seller Hub APIs (sign-up, listings, orders, returns, claims, payouts)
src/routes/admin-market.js  Studio APIs for sellers, catalog check, claims and settlement
public/                Storefront SPA (index.html, app.js, seller.js for Seller Hub, styles.css)
public/admin.html      Admin portal page (admin.js, admin.css): sign-in, left menu, staff, My account, idle sign-out
DESIGN.md              Design rules (colours, type, layout, vocabulary, checklist)
tests/api.test.js      Integration & security tests (npm test)
tests/buying-flow.test.js  Delivery promise, Express, EMI, failed delivery, returns, wallet, help desk, OTP, upgrade
tests/marketplace.test.js  Seller KYC, offers, quality check, checkout split, routing, payouts, claims, score
tests/admin-portal.test.js Admin sign-in, optional code and recovery codes, idle sign-out, staff roles and accounts
```

## 7. Common customisations

| Want to change... | Where |
|---|---|
| Store name | `STORE_NAME` env var + logo text in `public/index.html` |
| Look & feel | Follow [`DESIGN.md`](DESIGN.md); tokens are CSS variables at the top of `public/styles.css` |
| Free-delivery threshold, shipping fee, COD limit, return window | `src/config.js` |
| Products, categories, coupons | Bazaario Studio UI (or `src/seed.js` for the initial catalog) |
| Real product photos | Bazaario Studio → **Products** → **Edit** → **Upload photo** (or paste an `https://` image link) → **Save product**. Uploads are resized in the browser to 1000px and stored in `data/uploads/` (set `UPLOAD_DIR` to move them; on Render keep them on the same persistent disk as the database) |
