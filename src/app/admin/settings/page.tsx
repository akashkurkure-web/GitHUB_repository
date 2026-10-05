import Gate from "@/components/Gate";
import { requireAdmin } from "@/lib/auth";
import { saveIdentity, saveReviewReward, savePortalSettings } from "../actions";

export default async function Settings() {
  const { supabase, perms } = await requireAdmin();
  const [{ data: idt }, { data: rr }, { data: ps }] = await Promise.all([
    supabase.from("portal_business_identity").select("*").eq("id", 1).maybeSingle(),
    supabase.from("review_reward_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("portal_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const F: [string, string][] = [
    ["legal_entity_name", "Legal entity name"], ["brand_name", "Brand name"], ["gstin", "GSTIN"], ["support_email", "Support email"],
    ["escalation_phone", "Escalation phone"], ["registered_address_line1", "Registered address"], ["city", "City"], ["pincode", "Pincode"],
    ["grievance_officer_name", "Grievance officer"],
  ];
  return (
    <Gate perms={perms} m="settings">
      <div className="head"><div><h1>Business settings</h1><p className="muted">Company details print on invoices. Fees and switches apply to the website immediately.</p></div></div>
      <div className="card">
        <h2>Business identity</h2>
        {String(idt?.gstin ?? "").startsWith("27AAAAA") && <div className="notice">The GSTIN is still the placeholder. Replace it before issuing any invoice.</div>}
        <form action={saveIdentity} className="form">
          {F.map(([k, t]) => <label key={k} className="f">{t}<input name={k} defaultValue={(idt as any)?.[k] ?? ""} required /></label>)}
          <button className="btn">Save identity</button>
        </form>
      </div>
      <form action={savePortalSettings} className="card">
        <h2>Orders, delivery &amp; payments</h2>
        {ps && !ps.accepting_orders && <div className="alert">The shop is paused. Customers can browse but can&apos;t place orders.</div>}
        <div className="form">
          <label className="f">Standard shipping ₹<input name="shipping_inr" type="number" step="1" min="0" defaultValue={ps?.shipping_inr ?? 90} /></label>
          <label className="f">Same-day express ₹<input name="express_inr" type="number" step="1" min="0" defaultValue={ps?.express_inr ?? 249} /></label>
          <label className="f">Express: max print hours<input name="express_max_print_hours" type="number" step="0.5" min="0.5" defaultValue={ps?.express_max_print_hours ?? 6} /></label>
          <label className="f">Referral: friend&apos;s discount ₹<input name="referral_friend_inr" type="number" step="1" min="0" defaultValue={ps?.referral_friend_inr ?? 200} /></label>
          <label className="f">Referral: reward to referrer ₹<input name="referral_reward_inr" type="number" step="1" min="0" defaultValue={ps?.referral_reward_inr ?? 200} /></label>
          <label className="f">Warranty claim window (hours)<input name="claim_window_hours" type="number" min="1" defaultValue={ps?.claim_window_hours ?? 48} /></label>
        </div>
        <div className="row">
          <label className="row"><input type="checkbox" name="accepting_orders" defaultChecked={ps?.accepting_orders ?? true} style={{ width: "auto" }} />Accepting orders</label>
          <label className="row"><input type="checkbox" name="guest_checkout_enabled" defaultChecked={ps?.guest_checkout_enabled ?? true} style={{ width: "auto" }} />Guest checkout</label>
          <label className="row"><input type="checkbox" name="online_payment_enabled" defaultChecked={ps?.online_payment_enabled ?? true} style={{ width: "auto" }} />Online payment (Razorpay)</label>
          <label className="row"><input type="checkbox" name="proforma_enabled" defaultChecked={ps?.proforma_enabled ?? true} style={{ width: "auto" }} />Proforma &amp; bank transfer</label>
          <label className="row"><input type="checkbox" name="express_enabled" defaultChecked={ps?.express_enabled ?? true} style={{ width: "auto" }} />Same-day express</label>
        </div>
        <label className="f">Message shown when orders are paused<input name="paused_message" defaultValue={ps?.paused_message ?? ""} maxLength={300} /></label>
        <div><button className="btn">Save order settings</button></div>
      </form>
      <div className="card">
        <h2>Review reward</h2>
        <p className="muted">Sent once per customer, only after their first paid order.</p>
        <form action={saveReviewReward} className="form">
          <label className="f" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="enabled" defaultChecked={rr?.is_reward_enabled} style={{ width: "auto" }} />Reward enabled</label>
          <label className="f">Type<select name="discount_type" defaultValue={rr?.discount_type}><option value="flat_inr">flat ₹</option><option value="percentage">percentage</option></select></label>
          <label className="f">Value<input name="discount_value" type="number" step="0.01" min="1" defaultValue={rr?.discount_value} /></label>
          <label className="f">Min next order ₹<input name="min_order" type="number" defaultValue={rr?.min_order_subtotal_inr} /></label>
          <label className="f">Max discount ₹<input name="cap" type="number" defaultValue={rr?.max_discount_cap_inr ?? ""} /></label>
          <label className="f">Valid for days<input name="days" type="number" min="1" defaultValue={rr?.coupon_validity_days} /></label>
          <button className="btn">Save reward</button>
        </form>
      </div>
    </Gate>
  );
}
