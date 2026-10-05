/**
 * Editable website content. Each section is one row in `site_content`.
 * DEFAULTS are shown until an editor saves a section; SCHEMA drives the editor form.
 */
export type Field =
  | { k: string; label: string; type: "text" | "textarea" | "lines" | "bool"; max?: number; help?: string }
  | { k: string; label: string; type: "list"; of: { k: string; label: string; type: "text" | "textarea" | "lines"; max?: number }[]; maxItems?: number; help?: string };
export type Section = { key: string; title: string; where: string; fields: Field[] };

const L = (s: string) => s; // marker for readability

export const DEFAULTS: Record<string, any> = {
  announcement: { enabled: false, text: "Diwali offer: 10% off every order till 15 Nov with code DIWALI10", link_label: "Get a quote", link_href: "/quote" },
  seo: { title: "Layer27 · 3D Printing in Mumbai with Instant Quotes", description: "Upload an STL and get an instant GST-ready price. FDM and 8K resin 3D printing in Mumbai, Navi Mumbai and Thane with 48-hour dispatch." },
  hero: {
    eyebrow: "3D printing & rapid prototyping · Mumbai · Navi Mumbai · MMR",
    headline: "From CAD file to finished part,", highlight: "delivered in 48 hours.",
    subtitle: "Upload an STL, see your price with GST instantly, and get engineering-grade FDM and 8K resin parts printed by vetted Maharashtra workshops.",
    primary_cta: "Get an instant quote", secondary_cta: "Browse ready-made parts",
  },
  stats: { items: [{ value: "±0.10 mm", label: "Resin tolerance" }, { value: "7", label: "Materials in stock" }, { value: "48 h", label: "Standard dispatch" }, { value: "18% GST", label: "Input credit for B2B" }] },
  watch: {
    heading: "Watch how your part gets made", subtitle: "Two processes, one standard of quality.",
    fdm_title: "FDM printing", fdm_text: "Molten plastic laid down one line at a time, 0.12 to 0.28 mm per layer. Best for strong, functional parts and enclosures.",
    resin_title: "8K resin printing", resin_text: "A UV screen cures resin 0.05 mm at a time while the plate lifts the part from the vat. Best for fine detail and smooth surfaces.",
  },
  process: { heading: "Every step, tracked and visible", subtitle: "You get a WhatsApp update at each stage." },
  materials_section: { heading: "Materials, two processes", subtitle: "Rates include machine time and material. One-time setup fee per design. Minimum order ₹399 before GST." },
  trust: {
    heading: "Built for engineers who measure",
    cards: [
      { title: "Private CAD vault", points: "Private storage, never auto-deleted\nEvery partner download logged with time and IP\nPartners wipe local copies within 24 hours\nNo photos of your parts on social media" },
      { title: "Tolerances we stand behind", points: "FDM: ±0.20 mm or ±0.25%\nResin: ±0.10 mm or ±0.15%\nInfill printed exactly as ordered\nEvery part weighed and photographed" },
      { title: "48-hour reprint warranty", points: "Out-of-tolerance dimensions\nLayer delamination or support marks\nWrong colour, material or quantity\nBox crushed in transit" },
    ],
  },
  business: {
    eyebrow: "For engineering teams & startups", heading: "Order on credit, invoice in your company name",
    text: "Add your GSTIN to claim input tax credit. Approved companies get a credit line, a standing discount and monthly statements.",
    points: [{ label: "Credit terms", value: "7, 15 or 30 days" }, { label: "Starting limit", value: "₹25,000, reviewed quarterly" }, { label: "Account discount", value: "10% on top of batch pricing" }, { label: "Documents", value: "Proforma, tax invoice, credit notes, PO matching" }],
    cta: "Apply for a credit account",
  },
  referral: {
    heading: "₹200 for them, ₹200 for you",
    text: "They save ₹200 on their first order. ₹200 reaches your wallet once their order is delivered.",
    review_text: "Review your parts and get a one-time thank-you coupon. Reviews show as verified only when they come from a paid order.",
  },
  faq: {
    items: [
      { q: "Which file types can I upload?", a: "The instant quote reads STL files up to 50 MB. For STEP, OBJ or 3MF, export an STL from your CAD tool, or raise a support ticket and an engineer will help." },
      { q: "Is the quote final?", a: "The price at checkout is calculated on our server from your file's real volume and today's rates. Parts that need manual repair may be adjusted, and we tell you before printing." },
      { q: "When is IGST charged instead of CGST and SGST?", a: "We are registered in Maharashtra (state code 27). If your GSTIN starts with a different state code, 18% IGST applies. Otherwise 9% CGST plus 9% SGST." },
      { q: "What does \"Engineer decides\" mean?", a: "Tell us where the part is used and the load it takes. A print engineer confirms the material before printing and notes the reason on your order." },
      { q: "Can I cancel after paying?", a: "Yes, until printing starts. The refund goes back to your payment method or wallet, with a GST credit note against the invoice." },
      { q: "How long does delivery take?", a: "Most orders are ready to ship in 48 hours and arrive in 1–2 days within Maharashtra, 3–6 days elsewhere. Same-day delivery is available in Mumbai, Thane and Navi Mumbai for small parts." },
    ],
  },
  shop: { heading: "Find what you need", subtitle: "Search ready-made parts, materials and answers. Can't find it? Upload your own design for an instant price." },
  partners: {
    heading: "Own printers in Maharashtra? Print for us.",
    intro: "We bring the orders, the customers and the shipping labels. You print, weigh, pack and hand over.",
    steps: "Email us your company name, GSTIN, PAN, printer list and photos of sample parts.\nWe send a test job. It must pass our tolerance check: ±0.20 mm FDM, ±0.10 mm resin.\nSign the white-label manufacturing agreement (stamp paper or Aadhaar eSign).\nWe activate your partner login. Sign in with the same email to see your job queue.",
    requirements: "Maharashtra GSTIN (state code 27) and PAN\nCalibrated digital scale and caliper\nPlain 3-ply or 5-ply boxes and bubble wrap\nSomeone to accept jobs within 4 working hours",
  },
  contact: { hours: "Mon–Sat, 9:00 AM – 7:00 PM IST", note: "Have an order? Open a support ticket from your account so we can see your files and order history." },
  footer: { tagline: "Engineering-grade 3D printing from Maharashtra workshops." },
  "legal.terms": { title: "Terms of service", updated: "", body: L(`## Who we are
{brand} is operated by {legal_name}, {address} (GSTIN {gstin}). These terms apply when you use this website or place an order.

## Your files
You confirm you own or are licensed to manufacture every file you upload. You keep all rights in your designs. We use them only to quote, print and support your order, and our print partners are contractually bound to delete local copies within 24 hours of dispatch.

We do not print weapons, weapon components, or items that infringe someone else's rights, and may cancel such orders with a full refund.

## Quotes and prices
Instant quotes are calculated from the uploaded file. The price at checkout is final unless the file needs repair or cannot be printed as supplied, in which case we contact you before printing. All prices are in INR and GST is shown separately.

## Tolerances
FDM parts: ±0.20 mm or ±0.25% of nominal length, whichever is greater. MSLA resin parts: ±0.10 mm or ±0.15%. Cosmetic layer lines and support marks within these limits are normal for the process.

## Liability
Our total liability for any order is limited to the amount paid for that order. We are not liable for indirect or consequential losses. 3D printed parts are prototypes unless agreed otherwise in writing; test them for your application.

## Disputes
These terms are governed by the laws of India. Courts at Mumbai / Navi Mumbai, Maharashtra have exclusive jurisdiction.`) },
  "legal.privacy": { title: "Privacy policy", updated: "", body: `## What we collect
Account details (name, email, phone), company and GSTIN if you add them, delivery addresses, uploaded CAD files, order and payment records, and basic usage logs such as sign-in times and IP address.

## Why
To quote, print, deliver and invoice your orders, to send order updates by email and WhatsApp, to meet GST record-keeping law, and to prevent fraud.

## Who sees it
Our staff; the print partner assigned to your job (your file, part settings and delivery address only); our courier; Razorpay for payments; Supabase (database and file storage); Meta (WhatsApp messages). We never sell your data.

## How long
Invoices and tax records are kept for at least 8 years as GST law requires. CAD files are kept so you can re-order; ask us to delete them at any time unless they belong to an order still in progress.

## Your rights
Under the Digital Personal Data Protection Act, 2023 you can ask to access, correct or erase your data, or withdraw consent. Write to our grievance officer, {grievance_officer}, at {email}. We reply within 30 days.` },
  "legal.refunds": { title: "Cancellation & refund policy", updated: "", body: `## Before printing starts
You can cancel from your account until a print partner starts your job. Online payments are refunded to the original method within 5–7 working days. Wallet amounts return to your wallet immediately.

## After printing starts
Custom-manufactured parts cannot be cancelled once printing has started.

## Defects and damage
If parts arrive out of tolerance, delaminated, short in quantity or crushed in transit, raise a claim from your order page within 48 hours of delivery with an unboxing or caliper photo. Approved claims get a free priority reprint, or a refund if a reprint isn't possible.

## GST
Every refund of an invoiced order is recorded with a GST credit note, available on your order page.` },
  "legal.shipping": { title: "Shipping policy", updated: "", body: `## Dispatch times
Standard orders: ready to ship within 48 hours of payment. Batch, post-processed and resin orders: within 72 hours. Large batches may take longer; we confirm before you pay.

## Delivery
We ship across India with tracked couriers. Typical transit is 1–2 days within Maharashtra and 3–6 days elsewhere. MMR same-day express is available for Mumbai, Thane and Navi Mumbai pincodes on parts under 6 hours of print time ordered before 11:00 AM.

## Charges
Shipping is shown at checkout before you pay. Free-shipping coupons apply where stated.

## Packaging
Parts ship in plain corrugated boxes with bubble wrap. If the box arrives crushed, photograph it before opening and raise a claim within 48 hours.` },
};

const legal = (slug: string, title: string): Section => ({
  key: `legal.${slug}`, title, where: `/legal/${slug}`,
  fields: [
    { k: "title", label: "Page title", type: "text", max: 80 },
    { k: "updated", label: "Last updated (shown on the page)", type: "text", max: 40, help: "e.g. 1 November 2026" },
    { k: "body", label: "Text", type: "textarea", max: 20000, help: "Start a line with ## for a heading. Leave a blank line between paragraphs. You can use {brand}, {legal_name}, {gstin}, {address}, {email}, {grievance_officer}." },
  ],
});

export const SCHEMA: Section[] = [
  { key: "announcement", title: "Announcement bar", where: "Top of every page", fields: [
    { k: "enabled", label: "Show the bar", type: "bool" }, { k: "text", label: "Message", type: "text", max: 160 },
    { k: "link_label", label: "Link text (optional)", type: "text", max: 40 }, { k: "link_href", label: "Link address", type: "text", max: 200, help: "e.g. /shop or /quote" }] },
  { key: "hero", title: "Homepage banner", where: "Homepage, top", fields: [
    { k: "eyebrow", label: "Small line above the headline", type: "text", max: 120 }, { k: "headline", label: "Headline", type: "text", max: 90 },
    { k: "highlight", label: "Highlighted end of the headline", type: "text", max: 60 }, { k: "subtitle", label: "Paragraph", type: "textarea", max: 300 },
    { k: "primary_cta", label: "Main button", type: "text", max: 30 }, { k: "secondary_cta", label: "Second button", type: "text", max: 30 }] },
  { key: "stats", title: "Homepage numbers", where: "Homepage, under the banner", fields: [
    { k: "items", label: "Numbers", type: "list", maxItems: 4, of: [{ k: "value", label: "Value", type: "text", max: 14 }, { k: "label", label: "Label", type: "text", max: 30 }] }] },
  { key: "watch", title: "Video section", where: "Homepage, ‘Watch how…’", fields: [
    { k: "heading", label: "Heading", type: "text", max: 80 }, { k: "subtitle", label: "Subtitle", type: "text", max: 160 },
    { k: "fdm_title", label: "FDM title", type: "text", max: 40 }, { k: "fdm_text", label: "FDM text", type: "textarea", max: 300 },
    { k: "resin_title", label: "Resin title", type: "text", max: 40 }, { k: "resin_text", label: "Resin text", type: "textarea", max: 300 }] },
  { key: "process", title: "Process section", where: "Homepage, ‘Every step…’", fields: [
    { k: "heading", label: "Heading", type: "text", max: 80 }, { k: "subtitle", label: "Subtitle", type: "text", max: 160 }] },
  { key: "materials_section", title: "Materials section", where: "Homepage, materials", fields: [
    { k: "heading", label: "Heading (number of materials is added in front)", type: "text", max: 80 }, { k: "subtitle", label: "Subtitle", type: "textarea", max: 300 }] },
  { key: "trust", title: "‘Why trust us’ cards", where: "Homepage", fields: [
    { k: "heading", label: "Heading", type: "text", max: 80 },
    { k: "cards", label: "Cards", type: "list", maxItems: 3, of: [{ k: "title", label: "Title", type: "text", max: 50 }, { k: "points", label: "Points (one per line)", type: "lines", max: 600 }] }] },
  { key: "business", title: "Business section", where: "Homepage, ‘For engineering teams’", fields: [
    { k: "eyebrow", label: "Small line", type: "text", max: 60 }, { k: "heading", label: "Heading", type: "text", max: 90 }, { k: "text", label: "Paragraph", type: "textarea", max: 400 },
    { k: "points", label: "Facts", type: "list", maxItems: 6, of: [{ k: "label", label: "Label", type: "text", max: 30 }, { k: "value", label: "Value", type: "text", max: 80 }] },
    { k: "cta", label: "Button", type: "text", max: 40 }] },
  { key: "referral", title: "Referral box", where: "Homepage", fields: [
    { k: "heading", label: "Heading", type: "text", max: 60 }, { k: "text", label: "Referral text", type: "textarea", max: 300 }, { k: "review_text", label: "Review reward text", type: "textarea", max: 300 }] },
  { key: "faq", title: "FAQ", where: "Homepage and search", fields: [
    { k: "items", label: "Questions", type: "list", maxItems: 30, of: [{ k: "q", label: "Question", type: "text", max: 160 }, { k: "a", label: "Answer", type: "textarea", max: 1200 }] }] },
  { key: "shop", title: "Shop page", where: "/shop", fields: [
    { k: "heading", label: "Heading", type: "text", max: 80 }, { k: "subtitle", label: "Subtitle", type: "textarea", max: 300 }] },
  { key: "partners", title: "Partner page", where: "/partners", fields: [
    { k: "heading", label: "Heading", type: "text", max: 90 }, { k: "intro", label: "Intro", type: "textarea", max: 300 },
    { k: "steps", label: "How to join (one step per line)", type: "lines", max: 1500 }, { k: "requirements", label: "What you need (one per line)", type: "lines", max: 1000 }] },
  { key: "contact", title: "Contact page", where: "/contact", fields: [
    { k: "hours", label: "Opening hours", type: "text", max: 80 }, { k: "note", label: "Note", type: "textarea", max: 300 }] },
  { key: "footer", title: "Footer", where: "Bottom of every page", fields: [{ k: "tagline", label: "Tagline", type: "text", max: 120 }] },
  { key: "seo", title: "Search engine listing", where: "Google results and link previews", fields: [
    { k: "title", label: "Title", type: "text", max: 70 }, { k: "description", label: "Description", type: "textarea", max: 170 }] },
  legal("terms", "Terms of service"), legal("privacy", "Privacy policy"), legal("refunds", "Cancellation & refunds"), legal("shipping", "Shipping policy"),
];

/** Clean a submitted section against its schema. Throws on anything unexpected. */
export function sanitize(key: string, raw: any) {
  const sec = SCHEMA.find((s) => s.key === key);
  if (!sec) throw new Error("Unknown section.");
  const out: any = {};
  const clip = (v: any, max = 2000) => String(v ?? "").slice(0, max);
  for (const f of sec.fields) {
    const v = raw?.[f.k];
    if (f.type === "bool") out[f.k] = Boolean(v);
    else if (f.type === "list") {
      const arr = Array.isArray(v) ? v.slice(0, f.maxItems ?? 50) : [];
      out[f.k] = arr.map((row: any) => Object.fromEntries(f.of.map((c) => [c.k, clip(row?.[c.k], c.max)])));
    } else out[f.k] = clip(v, f.max);
  }
  return out;
}

export function lines(s: string | undefined) {
  return String(s ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
}
