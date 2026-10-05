"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { readCart, clearCart, type CartItem } from "@/lib/cart";

declare global { interface Window { Razorpay?: any } }
const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATES = ["Maharashtra", "Gujarat", "Karnataka", "Delhi", "Tamil Nadu", "Telangana", "Uttar Pradesh", "West Bengal", "Rajasthan", "Madhya Pradesh", "Kerala", "Haryana", "Punjab", "Goa", "Andhra Pradesh", "Bihar", "Odisha", "Assam", "Chhattisgarh", "Jharkhand", "Uttarakhand", "Himachal Pradesh", "Jammu and Kashmir", "Chandigarh", "Puducherry", "Other"];

function loadRazorpay(): Promise<boolean> {
  return new Promise((res) => {
    if (window.Razorpay) return res(true);
    const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res(true); s.onerror = () => res(false); document.body.appendChild(s);
  });
}

export function openRazorpay(rz: any, orderId: string, onDone: (ok: boolean, msg?: string) => void, token?: string | null) {
  loadRazorpay().then((ok) => {
    if (!ok) return onDone(false, "Couldn't load the payment window. Check your connection.");
    const r = new window.Razorpay({
      key: rz.key, order_id: rz.order_id, amount: rz.amount, currency: "INR", name: "Layer27", description: `Order ${rz.order_number}`,
      prefill: { name: rz.name, email: rz.email, contact: rz.phone }, theme: { color: "#ff6b1a" },
      handler: async (resp: any) => {
        const v = await fetch("/api/payments/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: orderId, token, ...resp }) });
        const j = await v.json(); onDone(v.ok, j.error);
      },
      modal: { ondismiss: () => onDone(false, "Payment window closed. Your order is saved; you can pay from the order page.") },
    });
    r.open();
  });
}

export default function CheckoutClient({ profile, creditActive, razorpay, proforma = true, signedIn, guestAllowed }: { profile: any; creditActive: boolean; razorpay: boolean; proforma?: boolean; signedIn: boolean; guestAllowed: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const a = profile.address || {};
  const [addr, setAddr] = useState({ name: a.name || profile.full_name || "", phone: a.phone || profile.phone || "", line1: a.line1 || "", line2: a.line2 || "", city: a.city || "", state: a.state || "Maharashtra", pincode: a.pincode || "" });
  const [gstin, setGstin] = useState(profile.gstin || "");
  const [legal, setLegal] = useState(profile.company || "");
  const [po, setPo] = useState("");
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [express, setExpress] = useState(false);
  const [useWallet, setUseWallet] = useState(false);
  const [payment, setPayment] = useState<"online" | "proforma" | "credit">(razorpay ? "online" : "proforma");
  const [guest, setGuest] = useState({ email: "", name: "" });
  const [mode, setMode] = useState<"guest" | "choose">(signedIn ? "guest" : "choose");
  const [sum, setSum] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useRef<any>(null);

  useEffect(() => setItems(readCart()), []);
  const body = () => ({
    items: items.map((i) => ({ cad_asset_id: i.cad_asset_id, catalog_product_id: i.catalog_product_id ?? null, config: i.config })), address: addr, gstin: gstin.trim().toUpperCase(),
    legal_name: legal, po_number: po, coupon: appliedCoupon, express, use_wallet: useWallet, payment,
    guest: signedIn ? undefined : { email: guest.email.trim(), name: guest.name.trim() || addr.name },
  });

  useEffect(() => {
    if (!items.length || mode === "choose") return;
    clearTimeout(t.current);
    t.current = setTimeout(async () => {
      const res = await fetch("/api/checkout/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body(), address: { ...addr, pincode: addr.pincode || "400001", name: addr.name || "x", phone: addr.phone || "9999999999", line1: addr.line1 || "x", city: addr.city || "x" } }) });
      const j = await res.json();
      if (res.ok) { setSum(j); setErr(""); } else { setErr(j.error); if (appliedCoupon && /coupon/i.test(j.error)) setAppliedCoupon(""); }
    }, 350);
  }, [items, addr.pincode, addr.state, gstin, appliedCoupon, express, useWallet, payment, mode]); // eslint-disable-line

  async function place() {
    setBusy(true); setErr("");
    const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    const j = await res.json();
    if (!res.ok) { setBusy(false); setErr(j.error); return; }
    clearCart();
    if (j.done) { router.push(`${j.next}?placed=1`); return; }
    openRazorpay(j.razorpay, j.order_id, (ok, msg) => {
      router.push(`${j.next}${ok ? "?paid=1" : `?msg=${encodeURIComponent(msg || "")}`}`);
    }, j.token);
  }

  if (!items.length) return <div className="card empty">Your cart is empty. <Link href="/shop">Browse the shop</Link> or <Link href="/quote">get a quote</Link>.</div>;
  if (mode === "choose") return (
    <div className="grid2" style={{ alignItems: "stretch" }}>
      <div className="card">
        <h2>Have an account?</h2>
        <p className="muted">Sign in to track every order in one place, earn referral rewards, use your wallet and order on company credit.</p>
        <div className="row"><Link className="btn lg" href="/login?next=/checkout">Sign in</Link><Link className="btn lg ghost" href="/login?next=/checkout&tab=up">Create account</Link></div>
      </div>
      <div className="card">
        <h2>Continue as guest</h2>
        {guestAllowed ? <>
          <p className="muted">No account needed. We&apos;ll email your invoice and give you a private link to track the order. Create an account later with the same email and the order moves into it.</p>
          <div><button className="btn lg navy" onClick={() => setMode("guest")}>Check out as guest</button></div>
        </> : <p className="muted">Guest checkout is switched off right now. Please sign in or create an account.</p>}
      </div>
    </div>
  );
  const set = (k: string) => (e: any) => setAddr({ ...addr, [k]: e.target.value });

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      <div style={{ display: "grid", gap: 18 }}>
        {!signedIn && (
          <div className="card">
            <h2>Your details</h2>
            <div className="form">
              <label className="f">Email (invoice and updates)<input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} autoComplete="email" required /></label>
              <label className="f">Full name<input value={guest.name} onChange={(e) => { setGuest({ ...guest, name: e.target.value }); if (!addr.name) setAddr({ ...addr, name: e.target.value }); }} autoComplete="name" /></label>
            </div>
            <p className="muted" style={{ fontSize: ".8rem" }}>Checking out as a guest. <Link href="/login?next=/checkout">Sign in instead</Link></p>
          </div>
        )}
        <div className="card">
          <h2>Delivery address</h2>
          <div className="form">
            <label className="f">Full name<input value={addr.name} onChange={set("name")} autoComplete="name" /></label>
            <label className="f">Mobile (for WhatsApp updates)<input value={addr.phone} onChange={set("phone")} autoComplete="tel" placeholder="+91" /></label>
            <label className="f" style={{ gridColumn: "1/-1" }}>Address line 1<input value={addr.line1} onChange={set("line1")} autoComplete="address-line1" /></label>
            <label className="f" style={{ gridColumn: "1/-1" }}>Address line 2<input value={addr.line2} onChange={set("line2")} autoComplete="address-line2" /></label>
            <label className="f">City<input value={addr.city} onChange={set("city")} autoComplete="address-level2" /></label>
            <label className="f">State<select value={addr.state} onChange={set("state")}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="f">Pincode<input value={addr.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} autoComplete="postal-code" /></label>
          </div>
          <label className="row" style={{ fontSize: ".88rem" }}><input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} style={{ width: "auto" }} />MMR same-day express (Mumbai, Thane, Navi Mumbai)</label>
        </div>
        <div className="card">
          <h2>Business invoice (optional)</h2>
          <div className="form">
            <label className="f">GSTIN<input value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27ABCDE1234F1Z5" /></label>
            <label className="f">Legal name on invoice<input value={legal} onChange={(e) => setLegal(e.target.value)} /></label>
            <label className="f">PO number<input value={po} onChange={(e) => setPo(e.target.value)} /></label>
          </div>
        </div>
        <div className="card">
          <h2>Payment</h2>
          <div style={{ display: "grid", gap: 10 }}>
            <label className="row"><input type="radio" name="pay" checked={payment === "online"} disabled={!razorpay} onChange={() => setPayment("online")} style={{ width: "auto" }} /><span><b>Pay online</b> · UPI, cards, netbanking via Razorpay{!razorpay && <span className="muted"> (not switched on yet)</span>}</span></label>
            <label className="row"><input type="radio" name="pay" checked={payment === "proforma"} disabled={!proforma} onChange={() => setPayment("proforma")} style={{ width: "auto" }} /><span><b>Proforma &amp; bank transfer</b> · needs GSTIN; printing starts when NEFT is received</span></label>
            {signedIn && <label className="row"><input type="radio" name="pay" checked={payment === "credit"} disabled={!creditActive} onChange={() => setPayment("credit")} style={{ width: "auto" }} /><span><b>Company credit line</b>{!creditActive && <span className="muted"> · <Link href="/account/business">apply for an account</Link></span>}</span></label>}
            {profile.wallet > 0 && <label className="row"><input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} style={{ width: "auto" }} /><span>Use wallet balance ({inr(profile.wallet)})</span></label>}
          </div>
        </div>
      </div>

      <div className="card" style={{ position: "sticky", top: 80 }}>
        <h2>Order summary</h2>
        {sum ? (
          <>
            {sum.items.map((i: any) => (
              <div key={i.cad_asset_id + i.material} className="row" style={{ justifyContent: "space-between", fontSize: ".88rem" }}>
                <span><b>{i.file_name}</b><br /><span className="muted">{i.material} · {i.qty} pcs · {i.mass} g each{i.discountPct ? ` · ${i.tier} −${i.discountPct}%` : ""}</span></span><span className="num">{inr(i.line)}</span>
              </div>
            ))}
            <div className="bill">
              {sum.moqTopUp > 0 && <div className="ln"><span>Top-up to minimum order</span><span>{inr(sum.moqTopUp)}</span></div>}
              <div className="ln"><span>Subtotal</span><span>{inr(sum.subtotal)}</span></div>
              {sum.corporateDiscount > 0 && <div className="ln minus"><span>Company account −{sum.corporatePct}%</span><span>− {inr(sum.corporateDiscount)}</span></div>}
              {sum.couponDiscount > 0 && <div className="ln minus"><span>Coupon {sum.couponCode}</span><span>− {inr(sum.couponDiscount)}</span></div>}
              {sum.referralDiscount > 0 && <div className="ln minus"><span>Referral welcome</span><span>− {inr(sum.referralDiscount)}</span></div>}
              <div className="ln"><span>Shipping</span><span>{sum.shipping ? inr(sum.shipping) : "Free"}</span></div>
              <div className="ln"><span>Taxable value</span><span>{inr(sum.taxable)}</span></div>
              {sum.intra ? <><div className="ln"><span>CGST 9%</span><span>{inr(sum.cgst)}</span></div><div className="ln"><span>SGST 9%</span><span>{inr(sum.sgst)}</span></div></> : <div className="ln"><span>IGST 18%</span><span>{inr(sum.igst)}</span></div>}
              {sum.wallet > 0 && <div className="ln minus"><span>Wallet</span><span>− {inr(sum.wallet)}</span></div>}
              <div className="total"><span className="eyebrow">To pay</span><b>{inr(sum.payable)}</b></div>
            </div>
          </>
        ) : <p className="muted">{err ? "" : "Calculating…"}</p>}
        <div className="inline">
          <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} style={{ flex: 1 }} />
          <button className="btn sm ghost" type="button" onClick={() => setAppliedCoupon(coupon.trim())}>Apply</button>
          {appliedCoupon && <button className="btn sm ghost" type="button" onClick={() => { setAppliedCoupon(""); setCoupon(""); }}>Remove</button>}
        </div>
        {err && <div className="alert">{err}</div>}
        <button className="btn lg" disabled={busy || !sum || (!signedIn && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email))} onClick={place}>
          {busy ? "Placing order…" : payment === "online" ? `Pay ${sum ? inr(sum.payable) : ""}` : payment === "proforma" ? "Place order & get proforma" : "Place order on credit"}
        </button>
        <p className="muted" style={{ fontSize: ".78rem" }}>By placing the order you agree to our <Link href="/legal/terms">terms</Link> and <Link href="/legal/refunds">refund policy</Link>.</p>
      </div>
    </div>
  );
}
