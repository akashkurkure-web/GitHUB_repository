import Gate from "@/components/Gate";
import { requireAdmin } from "@/lib/auth";
import { inr, d, label } from "@/lib/format";
import { createCoupon, toggleCoupon, updateCoupon } from "../actions";

export default async function Coupons() {
  const { supabase, perms } = await requireAdmin();
  const { data, error } = await supabase.from("promo_coupons").select("*").is("specific_user_email", null).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const { count: rewardCount } = await supabase.from("promo_coupons").select("id", { count: "exact", head: true }).not("specific_user_email", "is", null);
  return (
    <Gate perms={perms} m="marketing">
      <div className="head"><div><h1>Coupons</h1><p className="muted">Campaign codes. {rewardCount ?? 0} personal review-reward codes are issued automatically and hidden here.</p></div></div>
      <div className="card">
        <h2>Create coupon</h2>
        <form action={createCoupon} className="form">
          <label className="f">Code<input name="code" required placeholder="LAUNCH15" style={{ textTransform: "uppercase" }} /></label>
          <label className="f">Description<input name="description" required placeholder="15% off your first order" /></label>
          <label className="f">Type<select name="discount_type"><option value="percentage">percentage</option><option value="flat_inr">flat ₹</option><option value="free_shipping">free shipping</option></select></label>
          <label className="f">Value<input name="discount_value" type="number" step="0.01" min="0" required /></label>
          <label className="f">Min order ₹<input name="min_order" type="number" defaultValue={499} /></label>
          <label className="f">Max discount ₹<input name="cap" type="number" placeholder="No cap" /></label>
          <label className="f">Total uses<input name="max_total_uses" type="number" placeholder="Unlimited" /></label>
          <label className="f">Uses per customer<input name="per_user" type="number" defaultValue={1} /></label>
          <label className="f">Valid until<input name="valid_until" type="date" /></label>
          <label className="f" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="first_order_only" style={{ width: "auto" }} />First order only</label>
          <label className="f" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="b2b_only" style={{ width: "auto" }} />GSTIN customers only</label>
          <label className="f" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="public" style={{ width: "auto" }} />Show on checkout</label>
          <button className="btn">Create coupon</button>
        </form>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Code</th><th>Offer</th><th>Rules</th><th className="r">Used</th><th>Valid until</th><th>Status</th></tr></thead>
        <tbody>{(data ?? []).map((c) => (
          <tr key={c.id}>
            <td className="mono"><b>{c.code}</b>
              <details><summary className="muted" style={{ cursor: "pointer", fontSize: ".8rem", fontFamily: "inherit" }}>Edit</summary>
                <form action={updateCoupon} style={{ display: "grid", gap: 6, marginTop: 6, minWidth: 220, fontFamily: "Plus Jakarta Sans, sans-serif" }}>
                  <input type="hidden" name="id" value={c.id} />
                  <label className="f">Description<input name="description" defaultValue={c.description} /></label>
                  <label className="f">Value<input name="discount_value" type="number" step="0.01" defaultValue={c.discount_value} /></label>
                  <label className="f">Min order ₹<input name="min_order" type="number" defaultValue={c.min_order_subtotal_inr} /></label>
                  <label className="f">Max discount ₹<input name="cap" type="number" defaultValue={c.max_discount_cap_inr ?? ""} /></label>
                  <label className="f">Total uses<input name="max_total_uses" type="number" defaultValue={c.max_total_uses ?? ""} /></label>
                  <label className="f">Per customer<input name="per_user" type="number" defaultValue={c.max_uses_per_user} /></label>
                  <label className="f">Valid until<input name="valid_until" type="date" defaultValue={c.valid_until ? new Date(c.valid_until).toISOString().slice(0, 10) : ""} /></label>
                  <label className="row"><input type="checkbox" name="public" defaultChecked={c.is_public_on_checkout} style={{ width: "auto" }} />Show on checkout</label>
                  <button className="btn sm">Save</button>
                </form>
              </details>
            </td>
            <td>{c.discount_type === "percentage" ? `${c.discount_value}% off` : c.discount_type === "flat_inr" ? `${inr(c.discount_value)} off` : "Free shipping"}<div className="muted">{c.description}</div></td>
            <td className="muted">Min {inr(c.min_order_subtotal_inr)}{c.max_discount_cap_inr && ` · cap ${inr(c.max_discount_cap_inr)}`}{c.first_order_only && " · first order"}{c.b2b_gstin_only && " · B2B"}{c.is_public_on_checkout && " · public"}</td>
            <td className="r num">{c.current_uses_count}{c.max_total_uses ? ` / ${c.max_total_uses}` : ""}</td>
            <td>{c.valid_until ? d(c.valid_until) : "No expiry"}</td>
            <td><form action={toggleCoupon} className="inline"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.is_active)} />
              <span className={`pill ${c.is_active ? "ok" : "bad"}`}>{c.is_active ? "Live" : "Off"}</span><button className="btn sm ghost">{c.is_active ? "Turn off" : "Turn on"}</button></form></td>
          </tr>))}
          {!data?.length && <tr><td colSpan={6} className="empty">No campaign coupons yet.</td></tr>}
        </tbody>
      </table></div>
    </Gate>
  );
}
