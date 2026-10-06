# Akriti 3D: 3D printing sales portal

A Django website and order portal for a 3D printing reseller. Customers request quotes or order catalogue items, the production partner (vendor) prices and prints, and the owner adds the commission, sends the quote, records payments and issues GST invoices. Built for Vercel with a PostgreSQL (Neon) database.

"Akriti 3D" is a placeholder brand. Change it any time with the `PORTAL_NAME` environment variable.

---

## 1. What is included

| Area | What it does |
|---|---|
| **Public website** | Home page, four segment pages (mass manufacturing, custom jobs, home decor, medical models), catalogue, how it works, contact, terms, privacy (DPDP), refunds, shipping, grievance form. Works on phones. |
| **Guest quote request** | Anyone can request a quote without signing up. An account is created for them and a "set your password" email is sent. Medical requests need a disclaimer tick. |
| **Customer portal** | Track orders, accept quotes, upload more files, message the team, record a payment (UPI / bank transfer with UTR), download quotation, proforma and tax invoice. |
| **Vendor portal** | Sees only the jobs sent to them, with the delivery name, phone and address (never the customer's email, company or selling price). The vendor manager enters price and lead time. Staff move jobs through production, upload QC photos and enter courier and AWB. |
| **Owner** | Everything: sees vendor price and margin, can override price, approves payments, manages products, categories, team logins and vendor details, monthly vendor statement and payouts, CSV export. |
| **Ops (website support)** | Handles orders and records payments, but never sees vendor price or margin. |
| **Pricing** | Selling price = vendor price + 15% (rounded up to the rupee). GST 18%: CGST + SGST inside Maharashtra, IGST outside. Orders of ₹50,000 or more need a 50% advance and the balance before dispatch. |
| **Invoices** | Quotation, then proforma. A tax invoice number (`INV/2026-27/0001`, per financial year) is issued on dispatch only once `COMPANY_GSTIN` is set. |
| **Security** | Role checks on every page, login lock after 5 failed tries for 15 minutes, sign in with email, secure cookies and HSTS in production, files served only to people on the order. |
| **Compliance** | Grievance register with 48-hour acknowledgement and one-month resolution dates, terms consent on sign-up, medical-use disclaimer. |

### Before the company bank account opens (Phase 0)

The portal never takes money online; it only keeps records. Customers pay by UPI or bank transfer and enter the UTR number, or your team records the payment, and the owner approves it. Approval confirms the order (or starts production once the 50% advance is in for large orders).

Until you add `UPI_ID` or `BANK_ACCOUNT_NUMBER`, the payment box tells customers that your team will share bank details by email and phone. Once either is set, the bank details and a UPI QR code for the exact amount appear on the order page automatically.

---

## 2. Go live on Vercel (step by step)

### Step 1: Choose which GitHub repository Vercel reads

The code is on branch **`3d-print-portal`** of `akashkurkure-web/GitHUB_repository`. The `main` branch of that repository holds a different project (Bazaario), so do one of these:

- **Option A (recommended): a new repository just for this site.** On GitHub click **New repository**, name it e.g. `akriti3d-portal` (private is fine), then copy this branch into it:
  ```bash
  git clone -b 3d-print-portal https://github.com/akashkurkure-web/GitHUB_repository.git akriti3d-portal
  cd akriti3d-portal
  git remote set-url origin https://github.com/akashkurkure-web/akriti3d-portal.git
  git push -u origin 3d-print-portal:main
  ```
- **Option B: use the existing repository.** Import `GitHUB_repository` in Vercel, then in **Project → Settings → Git → Production Branch** type `3d-print-portal` and save.

### Step 2: Create the Vercel project

1. Sign in at https://vercel.com with GitHub.
2. **Add New → Project →** pick the repository from Step 1 **→ Import**.
3. Framework preset: **Other**. Leave build and output settings empty (`vercel.json` handles them).
4. Open **Environment Variables** and add at least:

   | Name | Value |
   |---|---|
   | `DJANGO_SECRET_KEY` | a long random string (generate: `python -c "import secrets; print(secrets.token_urlsafe(50))"`, or any 50+ random characters) |
   | `OWNER_EMAIL` | your login email |
   | `OWNER_PASSWORD` | a strong password (you can change it later on the Profile page) |
   | `SUPPORT_EMAIL` | the email shown on the website |

5. Click **Deploy**. The first deploy will show an error page until the database is connected in Step 3. That is expected.

### Step 3: Create and connect the database

1. In the project, open the **Storage** tab **→ Create Database → Neon (Serverless Postgres) → Continue**.
2. Region: **Singapore (ap-southeast-1)**, the closest to Mumbai. Plan: Free. Create.
3. Connect it to the project for **Production, Preview and Development**. Vercel adds `DATABASE_URL` / `POSTGRES_URL` automatically.
4. **Deployments →** the latest deployment **→ ⋯ → Redeploy**.

On the first visit the site creates its tables, your owner login, the default vendor, 7 categories and 4 draft sample products. Nothing else is needed.

**Workarounds if the Storage tab does not offer Neon:**
- Create a free database at https://neon.tech (region Singapore), copy the **connection string**, and add it in Vercel as `DATABASE_URL`. Redeploy.
- Or use https://supabase.com: **Project → Connect → Session pooler** connection string, added as `DATABASE_URL`. Redeploy.

### Step 4: First sign-in and setup

1. Open `https://<your-project>.vercel.app/accounts/login/` and sign in with `OWNER_EMAIL` / `OWNER_PASSWORD`.
2. **Vendors →** open "Production partner" and enter the vendor's real company, contact, GSTIN, PAN, Udyam number (if any) and bank details.
3. **Team →** add logins: one **Ops** login for your website support person, one **Vendor manager** (enters prices) and one **Vendor staff** (production and dispatch).
4. **Products →** edit the 4 draft samples (photo, vendor price, colours), tick **Published**, or add your own. Unpublished products are visible only to you.
5. Place a test quote request from a private browser window to see the full flow.

### Step 5: Fill these before taking real orders

Add in **Settings → Environment Variables**, then redeploy:

| Group | Variables | Why |
|---|---|---|
| Company | `COMPANY_LEGAL_NAME`, `COMPANY_ADDRESS`, `COMPANY_CIN`, `COMPANY_PAN`, `SUPPORT_PHONE`, `SUPPORT_WHATSAPP` | Shown in the footer, legal pages and invoices |
| GST | `COMPANY_GSTIN` | Turns proformas into numbered tax invoices on dispatch |
| Payments | `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_IFSC`, `BANK_NAME`, `UPI_ID` | Shows bank details and a UPI QR code on every order that needs payment |
| Grievance officer | `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`, `GRIEVANCE_OFFICER_PHONE` | Required on the website under the Consumer Protection (E-Commerce) Rules |
| Email | `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` | Without it, password and order emails only go to the Vercel log. Free option: Brevo (`smtp-relay.brevo.com`, 300 emails a day). Or Google Workspace / Zoho Mail SMTP. Gmail works with an App Password. |
| Brand | `PORTAL_NAME`, `PORTAL_TAGLINE` | Final brand name |

Business rules can also be changed here: `COMMISSION_PERCENT` (15), `GST_PERCENT` (18), `ADVANCE_THRESHOLD` (50000), `ADVANCE_PERCENT` (50), `COMPANY_STATE` (Maharashtra).

### Step 6: Custom domain (when you buy one)

1. Vercel **Settings → Domains →** add `yourdomain.in` and `www.yourdomain.in`, then set the DNS records Vercel shows at your registrar.
2. Add environment variables and redeploy:
   - `SITE_URL=https://www.yourdomain.in`
   - `DJANGO_ALLOWED_HOSTS=www.yourdomain.in,yourdomain.in`
   - `DJANGO_CSRF_TRUSTED_ORIGINS=https://www.yourdomain.in,https://yourdomain.in`

---

## 3. Limits to know on Vercel

| Limit | What the portal does about it |
|---|---|
| Vercel rejects uploads above 4.5 MB | Each file is limited to 4 MB. Customers can paste a Google Drive / WeTransfer / Dropbox link for bigger STL or STEP files. |
| Vercel has no permanent disk | Design files, product photos and QC photos are stored in the database. Neon's free tier gives 0.5 GB, enough for a few hundred jobs. When it fills up, upgrade Neon or move files to object storage (S3 / Cloudflare R2). |
| Serverless cold start | The first visit after idle time takes 2 to 3 seconds; later visits are fast. Migrations run automatically on start under a database lock. |
| Free Hobby plan is for non-commercial use | Move to Vercel Pro once you take paid orders, or host the same code on Render or Railway. |

---

## 4. Run it locally in VS Code

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # Windows   (macOS/Linux: cp .env.example .env)
python manage.py migrate
python manage.py setup_portal
python manage.py seed_demo      # optional demo data
python manage.py runserver
```

Open http://127.0.0.1:8000. Or press **F5** in VS Code and pick the Django configuration.

Demo logins (password `Demo@12345` for all): `owner`, `ops`, `vendor` (vendor manager), `vendorstaff`, `customer`. `seed_demo` refuses to run in production unless you pass `--force`.

Run the tests: `python manage.py test` (23 tests).

| Problem | Workaround |
|---|---|
| `python` not recognised on Windows | Use `py -m venv .venv`, or reinstall Python with "Add to PATH" ticked |
| PowerShell blocks `Activate.ps1` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `.venv\Scripts\activate.bat` in Command Prompt |
| `psycopg` fails to install | Not needed locally: SQLite is used when `DATABASE_URL` is empty. Remove the line from `requirements.txt` on your machine only |
| Port 8000 busy | `python manage.py runserver 8080` |
| Want to test against the Neon database | Put the Neon connection string in `.env` as `DATABASE_URL` |

---

## 5. Order flow

```
Customer / guest request ─► New ─► Pricing (sent to vendor) ─► vendor enters price
   ─► owner reviews (+15%) ─► Quoted ─► customer accepts ─► Awaiting payment
   ─► customer pays offline and enters UTR ─► owner approves payment
   ─► Confirmed ─► In production ─► Ready (QC photos) ─► Shipped (courier + AWB, invoice number)
   ─► Delivered ─► month-end vendor statement and payout
```

Catalogue orders skip pricing: the published price is used and the order goes straight to "Awaiting payment". Cancelled and Rejected need a reason; only the owner can cancel an order already in production.

---

## 6. Project layout

```
config/      settings (all from environment variables), urls, wsgi (Vercel entry point)
core/        website pages, dashboards, notifications, grievances, bootstrap (auto-migrate)
accounts/    users and roles, vendor profile, login lock, sign-up, team
catalog/     categories and products (photos stored in the database)
orders/      orders, pricing and GST, workflow, files, messages, payments, invoices, payouts, tests
templates/   all pages (Bootstrap 5)
static/      portal.css, portal.js, bundled Bootstrap and icons
vercel.json, .python-version, requirements.txt, .env.example
```
