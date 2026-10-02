# Bazaario: Online Marketplace (Django)

A full-featured Indian e-commerce marketplace built on **Django 5.2 LTS**: catalog, search, bag, wishlist, checkout with
UPI/Card/COD, order tracking, returns, verified reviews, and an admin console. It uses its own original brand and design
(see [`DESIGN.md`](DESIGN.md)). Do not reuse another company's name, logo or trade dress.

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, Django 5.2 LTS (JSON API in the `store` app) |
| Database | SQLite by default (switch to PostgreSQL by changing `DATABASES`) |
| Frontend | Single-page storefront in `public/` (vanilla JS, no build step), served by WhiteNoise |
| Production server | Gunicorn + WhiteNoise, behind HTTPS |
| Back office | Bazaario Studio in the storefront (`#/admin`), plus the Django admin at `/django-admin/` |

---

## 1. Run it in VS Code (local, about 5 minutes)

**Step 1: Install prerequisites (one time)**
- [Python 3.12](https://www.python.org/downloads/). On Windows, tick **"Add python.exe to PATH"** in the installer.
- [Git](https://git-scm.com/downloads) and [VS Code](https://code.visualstudio.com/).

**Step 2: Get the code**
- In VS Code, press **Ctrl+Shift+P**, choose **Git: Clone** and paste `https://github.com/akashkurkure-web/GitHUB_repository.git`, then **Open** the folder.
- *Already cloned?* Open the folder and run `git pull` in the terminal.
- *Workaround without Git:* on GitHub click **Code → Download ZIP**, unzip it and use **File → Open Folder**.

**Step 3: Create a virtual environment and install** (VS Code: **Terminal → New Terminal**)
```bash
# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
# macOS / Linux
python3 -m venv .venv && source .venv/bin/activate

pip install -r requirements.txt
```
*If PowerShell blocks `Activate.ps1`:* run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then retry.

**Step 4: Create the database and demo data**
```bash
python manage.py migrate
# Windows PowerShell:
$env:ADMIN_EMAIL="admin@bazaario.local"; $env:ADMIN_PASSWORD="ChangeMe123"; python manage.py seed
# macOS / Linux:
ADMIN_EMAIL=admin@bazaario.local ADMIN_PASSWORD=ChangeMe123 python manage.py seed
```

**Step 5: Start the store**
- Press **F5** and pick **"Bazaario: run server"** (breakpoints work). *Or* run `python manage.py runserver`.
- Open **<http://localhost:8000>**. Admin: `admin@bazaario.local` / `ChangeMe123`.
- Bazaario Studio is at **Account → Bazaario Studio**; the Django admin is at <http://localhost:8000/django-admin/>.

**Step 6: Try a test purchase**
- Register a customer, add a product to the bag, then **Checkout**.
- Pay with UPI `test@okbank`, card `4111 1111 1111 1111` (expiry `12/30`, any CVV), or COD. Try coupon `WELCOME10`.
- As admin, move the order Packed → Shipped → Delivered.

**Run the tests:** `python manage.py test store`, or press F5 and choose **"Bazaario: run tests"**.
**Reset demo data:** `python manage.py seed --reset`.

VS Code recommends the Python and Django extensions when you open the folder (`.vscode/extensions.json`).

---

## 2. Open it online with GitHub Codespaces (no install)

1. Go to **<https://codespaces.new/akashkurkure-web/GitHUB_repository>** and click **Create codespace**.
2. Wait 2-3 minutes. Dependencies install, the database is seeded, and the store starts on port **8000** and opens in a new tab.
   *If no tab opens:* go to the **Ports** tab and click the 🌐 icon next to port 8000.
3. Admin: `admin@bazaario.local` / `ChangeMe123`.
4. *To share the link:* Ports tab → right-click 8000 → **Port Visibility → Public**.

## 3. Publish a permanent public site on Render (free tier)

1. Sign in at **<https://render.com>** with GitHub.
2. **New + → Blueprint** → pick this repository. Render reads `render.yaml` and generates a secret key.
3. Enter **ADMIN_EMAIL** and **ADMIN_PASSWORD**, then click **Apply**. After about 5 minutes the store is live at `https://bazaario-xxxx.onrender.com`.
4. Free-plan limits:
   - The service sleeps after 15 minutes idle.
   - **The disk resets on every deploy or restart.** *Workaround for permanent data:* Starter plan + a **Disk** at `/var/data` + env `DB_FILE=/var/data/bazaario.sqlite3`, or a Render PostgreSQL database.

## 4. Docker

```bash
docker build -t bazaario .
docker run -d -p 8000:8000 -e DJANGO_SECRET_KEY='<long random string>' \
  -e DJANGO_ALLOWED_HOSTS=localhost -e DJANGO_SSL_REDIRECT=0 -e DJANGO_CSRF_TRUSTED_ORIGINS=http://localhost:8000 \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='YourStr0ngPass' -v bazaario-data:/app/data bazaario
```
The image runs in production mode (`DJANGO_PRODUCTION=1`). Behind a real HTTPS proxy, drop `DJANGO_SSL_REDIRECT=0`.

## 5. Production checklist

1. Set the variables in `.env.example`: `DJANGO_PRODUCTION=1`, a long random `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` and `TRUST_PROXY=1` behind a proxy.
2. Run `python manage.py check --deploy`. It should report no issues.
3. Serve over **HTTPS**: Nginx + certbot, Caddy, or Cloudflare in front of `gunicorn bazaario.wsgi`.
4. Back up the database daily, or move to PostgreSQL for multiple servers.
5. **Payments are simulated.** Before taking money, replace `process_payment()` in `store/views/orders.py` with a PCI-DSS gateway (Razorpay / PayU / Cashfree / Stripe India). Mark orders paid only after verifying the gateway's webhook signature, and add the gateway domains to the CSP in `store/middleware.py`.
6. India compliance: GST invoices, Consumer Protection (E-Commerce) Rules 2020, DPDP Act 2023 privacy notice, and RBI card-storage rules (this app already never stores card numbers).

---

## 6. Features

| Area | Features |
|---|---|
| Shopping | Search with suggestions; category, brand, price, rating, delivery and deal filters; 6 sort orders; pagination |
| Product page | Price, MRP and savings; EMI; coupon offers; PIN-code delivery check; stock; highlights; related products |
| Reviews | Rating distribution, one review per customer, **Verified buyer** only after delivery |
| Bag | Guest bag merged into the account at sign-in, quantity limits, save for later, free-delivery meter |
| Checkout | Address book (Indian states, PIN and mobile validation); UPI / card (Luhn + expiry) / COD (₹50,000 cap); coupons; idempotent "Place order" |
| Orders | Tracking, cancellation with refund and restock, 10-day return window, buy again |
| Admin | Dashboard, fulfilment state machine, product CRUD, customers, coupons, audit log, Django admin |

## 7. Security controls

| Threat | Control |
|---|---|
| SQL injection | Django ORM only (parameterised queries) |
| XSS | Strict Content-Security-Policy (`script-src 'self'`); the storefront renders data with `textContent` only |
| CSRF | Django `CsrfViewMiddleware` (token in `X-CSRF-Token` + Origin/Referer checks) + `SameSite=Lax` cookies |
| Weak / stolen passwords | **scrypt** hashing, password policy, 5-strike / 15-minute account lockout, per-IP rate limiting, identical errors for unknown emails |
| Session hijacking | HttpOnly session cookie (`__Host-`, Secure in production); session key rotated at login; all other sessions invalidated on password change |
| Broken access control / IDOR | Every customer query is scoped to `request.user`; admin endpoints require `is_staff` |
| Price tampering / overselling | Totals recomputed server-side; atomic conditional stock decrement inside a transaction; order state machine |
| Data exposure | Card numbers never stored (last 4 digits only); JSON errors without stack traces; `Cache-Control: no-store` on the API |
| Transport | HSTS (preload), SSL redirect, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, COOP, Permissions-Policy |
| Monitoring | `AuditLog` of sign-ins, lockouts, orders and admin changes (Bazaario Studio → Audit log) |

## 8. Project structure

```
manage.py                   Django entry point
bazaario/settings.py        Settings (all environment-driven) and store business rules (STORE)
bazaario/urls.py            /api/ → store app, /django-admin/ → Django admin
store/models.py             User, Category, Product, Review, CartItem, WishlistItem, Address, Coupon, Order, OrderItem, AuditLog
store/views/                auth, catalog, shopping (bag/wishlist/addresses), orders (checkout/payments), admin_api
store/pricing.py            Server-side totals, coupons, shipping
store/middleware.py         CSP & security headers, API rate limiting, JSON error handling
store/utils.py              Validation, rate limiter, audit logging, serialisers
store/management/commands/seed.py   Demo catalogue + admin account (store/seed_data.json)
store/tests/test_api.py     Integration & security tests
public/                     Storefront (index.html, app.js, styles.css, self-hosted Inter font)
DESIGN.md                   Design system rules
```

## 9. Common customisations

| Change | Where |
|---|---|
| Free-delivery threshold, shipping fee, COD limit, return window, lockout policy | `STORE` in `bazaario/settings.py` |
| Products, categories, coupons | Bazaario Studio, Django admin, or `store/seed_data.json` |
| Look and feel | `DESIGN.md` and the CSS variables at the top of `public/styles.css` |
| Database | `DATABASES` in `bazaario/settings.py` (e.g. PostgreSQL via `psycopg`) |
