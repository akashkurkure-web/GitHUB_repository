# Layer27 Persona & Access Framework

How the four kinds of user share one system without seeing each other's data.

> **SAP analogy:** each back-office *module* works like a PFCG single role, a *preset* like a composite role, **Team & access** like SU01, the **Audit log** like SM20. The database row-level policies play the part of authorization objects (AUTHORITY-CHECK): they run on every read and write, whatever screen the request comes from.

---

## 1. Personas

| Persona | How they get in | Home | What they do |
|---|---|---|---|
| **Guest** | No account | `/`, `/shop`, `/quote` | Search, browse products, instant quote, cart, **checkout as guest**, track the order through a private link |
| **Customer** | Creates an account at `/login` (email + password or Google) | `/account` | Everything a guest does, plus order history, reviews, warranty claims, tickets, wallet, referrals, company credit |
| **Print partner** | Admin adds them under *Print partners*; they sign up with that email | `/vendor` (`/partner-login`) | Only **their own** jobs: accept, print, QC weigh-in, pack, hand over, payouts |
| **Back-office staff** | Owner invites them under *Team & access*; they sign up with that email | `/admin` (`/staff`) | What their modules allow (see section 2) |

**Owner:** `akash.kurkure@gmail.com` (set in `004_owner_admin.sql`). Owners have every permission and are the only ones who can create other owners or grant *Team & access*.

## 2. Back-office modules and role presets

✓ = can change · R = can view only · — = can't see

| Module | Owner | Operations | Accountant | Support agent | Content editor |
|---|:-:|:-:|:-:|:-:|:-:|
| Orders & documents | ✓ | ✓ | ✓ | R | R |
| Production & partners | ✓ | ✓ | R | R | R |
| Support & claims | ✓ | ✓ | R | ✓ | R |
| Customers | ✓ | ✓ | R | R | R |
| Finance (credit, payouts) | ✓ | — | ✓ | — | — |
| Marketing (coupons, reviews) | ✓ | R | R | R | ✓ |
| Products & pricing | ✓ | R | R | R | ✓ |
| Website content | ✓ | R | R | R | ✓ |
| Business settings | ✓ | R | R | R | R |
| Team & access | ✓ | — | — | — | — |
| Audit log | ✓ | — | ✓ | — | — |

Choose **Custom** to tick modules one by one. The live version of this table is on *Team & access* in the back office.

## 3. Where each rule is enforced (3 layers)

| Layer | What it does | File |
|---|---|---|
| 1. **Route guard** | Anyone not signed in who opens `/account`, `/vendor` or `/admin` is sent to sign-in | `src/middleware.ts` |
| 2. **Server check** | Each page and button checks the role (`requireUser`, `requireVendor`, `requireAdmin`), and each back-office action checks its module (`requirePerm`). Staff without a module see that screen greyed out and read-only | `src/lib/auth.ts`, `src/components/Gate.tsx`, `src/app/admin/actions.ts` |
| 3. **Database (final say)** | Row-level security on every table: customers see only their own rows; partners only rows linked to their jobs; staff read operational data but write only with the module; finance, team and audit data are hidden without the module | `supabase/migrations/002`, `003`, `005` |

Even someone calling the database directly with a customer login can't read other customers, change prices, edit the website, or make themselves admin. This is covered by the tests in the next section.

Guards against misuse:
- Customers can't change their own role, wallet, verification or referral earnings (database trigger).
- Staff can't change their own access. Only owners can grant Owner or Team access. You can't remove the last owner.
- Guests reach an order only with its 32-character private link. Payments are checked by Razorpay signature.
- Every back-office change is written to the audit log.

## 4. How the personas connect: order lifecycle

```
GUEST / CUSTOMER                     BACK OFFICE                          PRINT PARTNER
────────────────                     ───────────                          ─────────────
Search /shop or upload STL
Add to cart → checkout
  ├ Pay online (Razorpay) ─────────► Order = paid, GST invoice no.
  ├ Proforma + NEFT ───────────────► Orders: mark paid with UTR
  └ Company credit (customers only) ► Finance approves credit line
                                     Orders: assign partner + SLA ───────► Job queue (WhatsApp alert)
                                                                          Accept → Print
                                                                          QC weigh-in (±15 % gate)
◄── WhatsApp: printing / packed ────────────────────────────────────────── Pack → Hand over
                                     Orders: courier + AWB → shipped
◄── WhatsApp: shipped / delivered ── Orders: delivered → referral paid
Review → reward coupon ────────────► Marketing: moderate / reply
Warranty claim (48 h) ─────────────► Support: approve → reprint job ──────► Reprint (₹0 if partner's fault)
                                     Finance: Monday payout ──────────────► Payouts (GST after GSTR-2B)
```

The connecting rule: **the order is the only shared record.**
- The customer sees their order and its documents.
- The partner sees only the job card (file, settings, delivery city). They never see prices, the customer's account or other jobs.
- Staff see everything, but can change only what their modules allow.

## 5. Guest → customer

1. Guest checks out with an email. The order belongs to no account and opens only through `/track/<private-link>`.
2. The private link page offers payment, the invoice and proforma, tracking, and "Create account".
3. When the guest creates an account with **the same email** and confirms it, every guest order with that email moves into the account automatically, with its uploaded files.
4. Reviews, warranty claims, wallet and referrals need an account, because they must be tied to a verified person.

Switch guest checkout off any time: *Business settings → Guest checkout*.

## 6. What the back office can edit (no developer needed)

| What | Where |
|---|---|
| Homepage banner, numbers, video text, "why trust us", business and referral sections, FAQ, shop page text, partner page, contact, footer, Google listing, announcement bar | Website content |
| Terms, privacy, refund and shipping pages (with `{brand}`, `{gstin}` and other placeholders) | Website content |
| Ready-made products: name, photos, STL, category, tags, materials allowed, fixed price, setup fee, publish/feature | Products |
| Material names, descriptions, colours, rates, machine rates, speeds, setup fee, minimum order, show/hide; batch discounts | Materials & pricing |
| Shipping and express fees, express limits, referral amounts, claim window, payment methods, guest checkout, pause all orders | Business settings |
| Legal name, GSTIN, address, support contacts, grievance officer, review reward | Business settings |
| Customer details, GSTIN verification, wallet adjustments (with reason) | Customers |
| Partner details, payout share, pause/activate | Print partners |
| Coupons (create, edit, switch on/off) | Coupons |
| Staff and their access | Team & access |

## 7. Onboarding checklists

**Add a staff member**
1. *Team & access* → enter their email → pick a preset (or Custom) → **Give access**.
2. They open `yourdomain/staff` → **Activate your staff account** with that email → confirm the email.
3. They land in the back office with only their modules.

**Remove a staff member:** *Team & access* → open their row → **Remove back-office access**. They become a normal customer.

**Add a print partner**
1. Signed agreement first.
2. *Print partners → Add* with their login email.
3. They sign up at `yourdomain/partner-login` with that email.

## 8. Tests run before delivery

- **Persona tests (34):** owner from day one; existing admins become owners on upgrade; invited support agent gets only *support*; support can read orders but can't change orders or prices or see finance; content editor can edit the website and products but not orders or settings; finance can approve credit but can't hand out team access; owner can't lock themselves out; customer can't see staff, can't edit the website, sees only published products, can't become admin or staff; visitors read only website text, published products and fees.
- **Security tests (30):** customer data isolation, partner isolation, wallet, coupon and credit limits, invoice numbering, CAD vault protection.
- **Logic tests (20):** STL measurement, pricing, GST split, amount in words, payment signatures.
- **Live smoke test:** all guest pages open without sign-in; `/account`, `/vendor`, `/admin/*` redirect to sign-in; guest checkout rejects credit-line use and other people's orders.
