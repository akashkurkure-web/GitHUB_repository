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
4. Admin login: `admin@bazaario.local` / `ChangeMe123` (set in `.devcontainer/devcontainer.json`; change it there).
5. *To share the link with others:* Ports tab → right-click port 3000 → **Port Visibility → Public**.
   - The codespace stops after 30 minutes of inactivity. Reopen it from github.com/codespaces.
   - Personal accounts get about 60 free hours a month.

### Option B: Render (public website with HTTPS, free tier)
1. Sign up at <https://render.com> using **Sign in with GitHub**.
2. Click **New + → Blueprint**, pick this repository, and Render reads `render.yaml`.
   *Or use the button:* [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/akashkurkure-web/GitHUB_repository)
3. When asked, enter **ADMIN_EMAIL** and **ADMIN_PASSWORD** (choose a strong one) → **Apply**.
4. After about 3-5 minutes your store is live at `https://bazaario-xxxx.onrender.com`.
   *To use your own domain:* Settings → Custom Domains.
5. Limits of the free plan:
   - It sleeps after 15 minutes idle, so the first visit takes about 50 seconds.
   - **Its disk is wiped on every restart or redeploy**, so orders and accounts reset to demo data.
   - *Workaround for permanent data:* upgrade to the Starter plan, add a **Disk** mounted at `/var/data`, and set the env var `DB_FILE=/var/data/bazaario.db`.

*Other hosts that work the same way:* Railway, Fly.io, Azure App Service, AWS Elastic Beanstalk. Use the Docker image from Section 4.

---

## 1. Feature map (marketplace parity)

| Area | Features |
|---|---|
| **Header** | Delivery strip with PIN code, logo, rounded search with live suggestions and category scope, Account · Orders · Wishlist · Bag icons, category chips |
| **Home** | Auto-rotating hero banners, category tiles, Today's Deals carousel, top rated, browsing history |
| **Search / listing** | Keyword search, category, brand facets, price ranges & custom range, rating "& Up", Express delivery, deals, in-stock filters; 6 sort orders; pagination |
| **Product page** | Price / MRP / % off, "Inclusive of all taxes", EMI, coupon offers, PIN-code delivery check, stock status, qty, Add to Cart, Buy Now, Wish List, feature bullets, related products |
| **Reviews** | Star distribution, write review, one review per customer, **Verified Purchase** badge only for delivered orders |
| **Cart** | Guest cart (merged into account on sign-in), qty change, delete, Save for later, free-delivery progress bar |
| **Checkout** | Address book with Indian states & PIN validation, UPI / Card (Luhn + expiry) / Cash on Delivery (₹50,000 cap), coupons, free delivery over ₹499, savings summary, idempotent "Place order" (no double orders) |
| **Orders** | Order history, details, tracking stepper (Placed → Packed → Shipped → Delivered), cancel (auto-refund + restock), 10-day return window, Buy it again |
| **Account** | Profile, change password (signs out other devices), addresses, wish list |
| **Bazaario Studio (admin)** | Dashboard (revenue, open orders, low stock), order fulfilment workflow, product CRUD, customers, coupons, security audit log |

## 2. Security controls

| Threat (OWASP Top 10) | Control in this codebase |
|---|---|
| Injection (SQLi) | 100% parameterised queries; `LIKE` wildcards escaped (`src/routes/catalog.js`) |
| XSS | Strict Content-Security-Policy (`script-src 'self'`, no inline); UI renders all data via `textContent` only (`public/app.js`) |
| CSRF | Per-session synchroniser token (`X-CSRF-Token`) + Origin/Referer same-host check + `SameSite=Lax` cookie (`src/security.js`) |
| Broken authentication | scrypt hashing with per-user salt, password policy, 5-strike / 15-min lockout, per-IP rate limit, generic errors & constant-time compare (no user enumeration), session rotation on login, all sessions revoked on password change |
| Session hijacking | Random 256-bit token in `HttpOnly` cookie (`__Host-` prefix + `Secure` in production); only its SHA-256 is stored server-side; 7-day sliding expiry |
| Broken access control / IDOR | `requireAuth` / `requireAdmin` middleware; every customer query is scoped by `user_id` |
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

**Step 4: Choose your admin login and start**
```bash
# macOS / Linux
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='YourStr0ngPass' npm start
# Windows PowerShell
$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="YourStr0ngPass"; npm start
```
*If you skip the variables,* a random admin password is printed **once** in the console on first start. Copy it.

**Step 5: Open the store**
- Shop: <http://localhost:3000>
- Bazaario Studio (admin): sign in with the admin account → **Sign in / Hi, … → Bazaario Studio** (or `#/admin`).

**Step 6: Try a test purchase**
1. Register a customer account (top right → *Start here*).
2. Add a product → **Checkout** → add an address (any valid 6-digit PIN, 10-digit mobile starting 6-9).
3. Pay with UPI `test@okbank`, or card `4111 1111 1111 1111` with any future expiry like `12/30` and any CVV, or COD.
4. Apply coupon `WELCOME10`, `SAVE100` or `FESTIVE15`.
5. As admin, move the order Packed → Shipped → Delivered; as the customer, write a *Verified Purchase* review or request a return.

**Reset demo data:** stop the server, then `npm run seed` (or delete the `data/` folder).
**Run automated tests:** `npm test` (13 tests cover the catalog, auth, CSRF, IDOR, pricing, payments, orders and admin).

---

## 4. Step-by-step: run with Docker

```bash
docker build -t bazaario .
docker run -d --name bazaario -p 3000:3000 \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='YourStr0ngPass' \
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
6. **Real payments.** Before taking money, replace `processPayment()` in `src/routes/orders.js` with a PCI-DSS compliant
   gateway (**Razorpay**, **PayU**, **Cashfree** or **Stripe India**):
   - create the order on the gateway server-side and open its hosted checkout/SDK in the browser (card data never touches your server);
   - mark the order `paid` **only** after verifying the gateway's webhook signature server-side;
   - add the gateway domains to the CSP in `server.js` (`script-src`, `frame-src`, `connect-src`).
7. **Compliance checklist (India):** GSTIN on invoices; Consumer Protection (E-Commerce) Rules 2020 (seller details, grievance officer,
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
src/pricing.js         Server-side cart totals, coupons, shipping
src/routes/auth.js     Register, login, logout, profile, change password
src/routes/catalog.js  Categories, search & facets, product detail, reviews
src/routes/shopping.js Cart, save-for-later, guest-cart merge, wishlist, addresses
src/routes/orders.js   Checkout quote, payment, place/cancel/return orders
src/routes/admin.js    Bazaario Studio (admin) APIs
public/                Storefront SPA (index.html, app.js, styles.css)
DESIGN.md              Design rules (colours, type, layout, vocabulary, checklist)
tests/api.test.js      Integration & security tests (npm test)
```

## 7. Common customisations

| Want to change... | Where |
|---|---|
| Store name | `STORE_NAME` env var + logo text in `public/index.html` |
| Look & feel | Follow [`DESIGN.md`](DESIGN.md); tokens are CSS variables at the top of `public/styles.css` |
| Free-delivery threshold, shipping fee, COD limit, return window | `src/config.js` |
| Products, categories, coupons | Bazaario Studio UI (or `src/seed.js` for the initial catalog) |
| Real product photos | Add an `image_url` column, put images in `public/img/`, render an `<img>` in `productCard()`. Keep images same-origin or add your CDN to `img-src` in the CSP |
