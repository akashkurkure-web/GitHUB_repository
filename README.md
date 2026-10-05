# Layer27 — 3D Printing Portal (complete product)

One Next.js 14 app on Supabase that runs the whole business:

| Area | Who | What it does |
|---|---|---|
| **Shop & search** `/shop` | Everyone, incl. guests | One search box for ready-made parts, materials, FAQ and policy answers; category, process and price filters; product pages with material, colour, finish and quantity; add to cart |
| **Website** `/` | Everyone | Landing page, printing animations, process flows, materials from your live price list, FAQ, partner page, contact, legal pages |
| **Instant quote** `/quote` | Everyone | Drop an STL → 3D preview, size/volume/watertight check, live price with batch discount and GST, material recommender, saves file to a private vault |
| **Cart & checkout** `/cart` `/checkout` | Customers **and guests** | Server-calculated final price, coupons, referral discount, company discount, wallet, MMR same-day express. Pay by **Razorpay**, **proforma + NEFT**, or **company credit line** |
| **My account** `/account` | Customers | Orders with live status timeline, pay pending orders, cancel before printing (auto-refund), GST invoice / proforma / credit notes, review → reward coupon, 48-hour warranty claim with photos, support tickets, referral link, wallet, business credit application, profile and saved address |
| **Partner portal** `/vendor` | Print partners | Job queue with SLA timers, accept/reject, logged STL download, confirm material for "engineer decides" parts, QC weigh-in with photo (blocks dispatch if >15% off), packing slip, hand-over, payout history |
| **Back office** `/admin` (sign in at `/staff`) | You and your staff, by role | Dashboard, orders (mark NEFT paid with UTR, assign vendor, tracking, cancel & refund), vendor jobs with penalty suggestions, leads CRM, customers & roles, B2B credit, reviews, coupons, vendors, weekly vendor payouts with GSTR-2B GST hold, pricing, business settings, audit log |
| **Documents** `/documents/…` | By role | Tax invoice (sequential MH numbering), proforma with your bank details, GST credit note, white-label packing slip. Print or save as PDF from the browser |
| **Tracking** `/track/…` | Anyone with the private link | Order status, pay pending orders, invoice and proforma. Guests manage their order here |

**Personas and roles:** see **FRAMEWORK.md** for who can see and change what, how it is enforced, and how orders move between customer, back office and print partner.

Back office extras: **Website content** editor (every text block, FAQ, policies, announcement bar), **Products** (photos, STL, prices, publish), **Materials & pricing** (names, colours, rates), **Business settings** (fees, payment methods, guest checkout, pause orders), **Team & access** (invite staff with role presets), editable customers, partners and coupons.

Automatic behaviour: sequential GST invoice numbers when an order is paid · coupon usage limits enforced atomically · referral reward credited to the referrer's wallet when the friend's order is **delivered** · review reward issued once per customer after a paid order · low reviews flagged · reprint job created automatically when you approve a claim (₹0 payout if vendor's fault) · WhatsApp message at each stage (when configured).

---

## Step-by-step setup

### Step 1 — Supabase project
1. <https://supabase.com> → **New project** → Region **South Asia (Mumbai)**. Save the database password.
2. **Database → Extensions**: enable **pg_net** and **pg_cron** (needed by the first script).

### Step 2 — Database (run in order)
**SQL Editor → New query**, paste each file from `supabase/migrations/`, click **Run**:

1. `001_master_schema.sql` — your schema from the Gemini blueprint (with one bug fixed, see Notes)
2. `002_admin_security.sql` — row-level security, admin role, audit log
3. `003_portal.sql` — private file buckets, vendor/customer access, payment helpers
4. `004_owner_admin.sql` — makes **akash.kurkure@gmail.com** the admin automatically
5. `005_personas_rbac_cms.sql` — staff roles and permissions, editable website content, shop products, business settings, guest checkout

> **Already ran 001–004 earlier?** Just run `005` now. Existing admins become Owners automatically, and nothing else changes.

Each should end with "Success. No rows returned".

> **Workaround — `UNIQUE NULLS NOT DISTINCT` error:** your project is on Postgres 14. Create the project again (new projects are 15+), or remove those three words from the `whatsapp_notification_logs` table and run again.
> **Workaround — `storage.buckets` error in 003:** create the buckets by hand in **Storage → New bucket**: `cad-files` (50 MB), `qc-photos` (10 MB), `claim-photos` (10 MB), all **private**. Then delete section 1 of 003 and run it again.

### Step 3 — Authentication settings
**Authentication → URL Configuration**
- Site URL: `https://yourdomain.in` (use `http://localhost:3000` while testing)
- Redirect URLs: add `https://yourdomain.in/auth/callback` and `http://localhost:3000/auth/callback`

**Authentication → Providers → Email**: keep "Confirm email" on.
**Google sign-in (optional):** Providers → Google → paste Client ID and secret from Google Cloud Console (OAuth client, type Web; authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`).

### Step 4 — Your admin account (akash.kurkure@gmail.com)
`004_owner_admin.sql` already makes this email the admin, whether you sign up before or after running it.
1. Open the site (Step 6) → **Sign in → Create account** with `akash.kurkure@gmail.com` (or **Continue with Google** with that Gmail).
2. Confirm the email. You land on `/admin`.
3. Check in SQL Editor: `SELECT email, role FROM profiles WHERE role = 'admin';`
4. Go to **Admin → Settings** and replace the placeholder legal name, **GSTIN**, address, support email and grievance officer. These print on every invoice.

> Keep **Confirm email** ON (Step 3). That stops anyone else from registering your email first.
> **Workaround — landed on `/account` instead of `/admin`:** run `004_owner_admin.sql` again, then sign out and back in.
> **Add another admin later:** `INSERT INTO owner_admin_emails VALUES ('partner@gmail.com');` before they sign up, or use Admin → Customers → role.

### Step 5 — Environment variables
Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, "service_role". **Server only. Never share it or prefix it with NEXT_PUBLIC_** | Yes |
| `NEXT_PUBLIC_SITE_URL` | Your domain | Yes |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay → Account & Settings → API keys | For online payments |
| `RAZORPAY_WEBHOOK_SECRET` | You choose it in Step 7 | For online payments |
| `BANK_ACCOUNT_NAME`, `BANK_NAME`, `BANK_ACCOUNT_NO`, `BANK_IFSC` | Your current account | For proforma invoices |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Meta Business → WhatsApp → API setup | Optional |

Without Razorpay keys the site still works: customers use **proforma + bank transfer**, and you mark orders paid with the UTR in Admin.

### Step 6 — Run it
Needs Node.js 18.18+.
```bash
npm install
npm run dev          # http://localhost:3000
```
**Deploy on Vercel:** push to a private GitHub repo → vercel.com → Add New Project → import → add every variable from Step 5 → Deploy → Settings → Domains → add `yourdomain.in`.

> **Workaround — no laptop setup:** upload the folder to GitHub through the website ("Add file → Upload files") and deploy straight from Vercel. Skip `npm` entirely.

### Step 7 — Razorpay
1. Complete KYC. Razorpay checks your website for **Terms, Privacy, Refund and Shipping** pages. They're at `/legal/terms`, `/legal/privacy`, `/legal/refunds`, `/legal/shipping`. **Have a lawyer review them.**
2. Start with **Test Mode** keys and place a test order with Razorpay's test UPI or card.
3. **Settings → Webhooks → Add**: URL `https://yourdomain.in/api/webhooks/razorpay`, events **payment.captured** and **order.paid**, set a secret and put it in `RAZORPAY_WEBHOOK_SECRET`. This confirms payments even if the customer closes the browser.
4. Switch to Live keys when the test order works end to end.

### Step 8 — WhatsApp (optional)
Create and get approved these templates in Meta Business Manager (language English, body variables `{{1}}`, `{{2}}`):
`order_paid` (name, order no) · `printing_started` (order no) · `qc_passed_packed` (order no) · `order_shipped` (order no, AWB) · `out_for_delivery` · `order_delivered` · `refund_issued` · `b2b_proforma_sent` · `vendor_new_job_alert` (job no).
Every send, success or failure, is logged in `whatsapp_notification_logs`.

### Step 9 — Fill in the shop and website (Back office)
1. **Business settings:** legal name, GSTIN, address, fees, payment methods, guest checkout on or off.
2. **Materials & pricing:** check names, colours and rates.
3. **Products → New product:** name, category, tags, then upload the STL and photos, tick **Published**. It appears in `/shop` and search.
4. **Website content:** edit the homepage banner, FAQ, policies and footer. Each section shows **Default** until you edit it.
5. **Team & access:** invite staff with a preset (Operations, Accountant, Support agent, Content editor) or Custom.

### Step 10 — Add your first print partner
1. Get the white-label agreement signed (from your Gemini blueprint).
2. **Admin → Vendors → Add vendor** with the partner's login email.
3. The partner creates an account on `/login` with **that same email**. They get the partner role automatically and land on `/vendor`.

---

## Sign-in addresses
| Who | Address | Notes |
|---|---|---|
| Customers | `/login` (or **Sign in / Create account** in the header) | Sign out from the header menu or My account |
| Guests | none needed | Shop, quote, cart and checkout work without an account |
| Staff | `/staff` | Uses the invited email. Sign out at the bottom of the back-office menu |
| Print partners | `/partner-login` | Uses the email added under Print partners |

## Test the whole flow (15 minutes)
0. **Guest** (private window): `/shop` → search → open a product → Add to cart → Checkout → **Check out as guest** → proforma → you land on the private tracking page.
1. **Customer** (second email): `/quote` → upload an STL → Add to cart → Checkout → choose **Proforma** (needs a GSTIN, e.g. `27ABCDE1234F1Z5`) → order placed → open the proforma.
2. **Admin**: Orders → open it → status **paid** + any UTR → a tax invoice number appears → assign the vendor.
3. **Partner**: `/vendor` → open the job → Accept → Start printing → upload a QC photo with a weight near the expected grams → Packed → print packing slip.
4. **Admin**: add courier + AWB → status **shipped** → then **delivered**.
5. **Customer**: order page → leave a review → reward coupon appears on `/account`. A warranty claim form is open for 48 hours.

## Daily operations
- **Morning:** Overview → new orders, jobs past SLA, claims, flagged reviews.
- **NEFT received:** Orders → filter *proforma issued* → mark paid with UTR.
- **Monday:** Payouts → Calculate last week per vendor → pay by NEFT → Mark paid with UTR.
- **14th–18th:** after the vendor's GST shows in your GSTR-2B → Payouts → release GST.

---

## Notes and what was fixed in your schema
- **Review reward bug fixed.** The original trigger inserted the reward claim *before* the review row existed, so every review on a paid order failed with a foreign-key error. Moved to an AFTER-INSERT trigger (`003`, section 7).
- **Virus-scan default corrected.** Uploads were marked `CLEAN` by default with no scanner connected. Now `NOT_SCANNED`.
- **CRM lead view** is restricted to admins.
- All prices are recalculated on the server at checkout. The browser's numbers are only a preview.
- Discounts can't push the goods value below 45% of subtotal (vendor cost floor).

Tested before delivery: the 3 migrations run cleanly on Postgres and are safe to re-run; 30 security checks (customers see only their own data, can't make themselves admin or edit their wallet, vendors see only their own jobs, visitors can read prices but not orders, invoice numbers are sequential, coupon/credit/wallet limits hold); pricing, GST split, STL measurement and Razorpay signature checks; production build and page smoke test.

## Not included yet (good next steps)
- **Shiprocket API**: courier booking is manual (enter courier + AWB in Admin). Labels and pickup scheduling can be automated next.
- **Virus scanning / file sanitising** of uploads (ClamAV): the column is there, the scanner isn't.
- **Instant quotes for STEP / 3MF / OBJ**: customers use a support ticket for these today.
- **Email notifications** beyond Supabase's sign-up and password emails.
- **Automatic SLA penalties**: Admin sees suggested penalties and applies them with one click.
- **Photo uploads** are capped at 4 MB per submission (Vercel request limit).
- **Stored PDF files**: documents are web pages printed to PDF from the browser.

## Security checklist before going live
- [ ] Replace placeholder GSTIN and legal name in Admin → Settings
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set only in Vercel's server env, never in code
- [ ] Turn on MFA for admin accounts (Supabase → Authentication → Multi-factor)
- [ ] Keep at least two admins
- [ ] Lawyer review of the four legal pages
- [ ] Razorpay webhook configured and tested
