import Gate from "@/components/Gate";
import { requireAdmin } from "@/lib/auth";
import { d } from "@/lib/format";
import { createVendor, toggleVendor, updateVendor } from "../actions";

export default async function Vendors() {
  const { supabase, perms } = await requireAdmin();
  const { data, error } = await supabase.from("vendors").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (
    <Gate perms={perms} m="production">
      <div className="head"><div><h1>Vendors</h1><p className="muted">Print partners. Add a vendor only after the white-label agreement is signed. When they sign in with the same email they get the vendor role.</p></div></div>
      <div className="card">
        <h2>Add vendor</h2>
        <form action={createVendor} className="form">
          <label className="f">Company<input name="company_name" required /></label>
          <label className="f">Login email<input name="email" type="email" required /></label>
          <label className="f">Phone<input name="phone_number" required placeholder="+91" /></label>
          <label className="f">GSTIN<input name="gstin" maxLength={15} placeholder="27…" /></label>
          <label className="f">PAN<input name="pan_number" maxLength={10} /></label>
          <label className="f">Shiprocket pickup<input name="pickup" placeholder="Mumbai_Primary_Vendor_Hub" /></label>
          <label className="f">Payout share %<input name="share" type="number" step="0.5" defaultValue={45} /></label>
          <button className="btn">Add vendor</button>
        </form>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Company</th><th>Contact</th><th>GSTIN / PAN</th><th>Pickup</th><th className="r">Share</th><th>Since</th><th>Status</th></tr></thead>
        <tbody>{(data ?? []).map((v) => (
          <tr key={v.id}>
            <td><b>{v.company_name}</b>
              <details><summary className="muted" style={{ cursor: "pointer", fontSize: ".8rem" }}>Edit</summary>
                <form action={updateVendor} style={{ display: "grid", gap: 6, marginTop: 6, minWidth: 220 }}>
                  <input type="hidden" name="id" value={v.id} />
                  <input name="company_name" defaultValue={v.company_name} placeholder="Company" />
                  <input name="phone_number" defaultValue={v.phone_number} placeholder="Phone" />
                  <input name="gstin" defaultValue={v.gstin ?? ""} placeholder="GSTIN" maxLength={15} />
                  <input name="pan_number" defaultValue={v.pan_number ?? ""} placeholder="PAN" maxLength={10} />
                  <input name="pickup" defaultValue={v.shiprocket_pickup_location} placeholder="Pickup location" />
                  <input name="share" type="number" step="0.5" defaultValue={v.base_payout_share_percent} />
                  <button className="btn sm">Save</button>
                </form>
              </details>
            </td>
            <td>{v.email}<div className="muted">{v.phone_number}</div></td>
            <td className="mono">{v.gstin || "—"}<div className="muted">{v.pan_number || ""}</div></td>
            <td className="mono">{v.shiprocket_pickup_location}</td>
            <td className="r num">{v.base_payout_share_percent}%</td>
            <td>{d(v.created_at)}</td>
            <td>
              <form action={toggleVendor} className="inline">
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="active" value={String(!v.is_active)} />
                <span className={`pill ${v.is_active ? "ok" : "bad"}`}>{v.is_active ? "Active" : "Paused"}</span>
                <button className="btn sm ghost">{v.is_active ? "Pause" : "Activate"}</button>
              </form>
            </td>
          </tr>))}
          {!data?.length && <tr><td colSpan={7} className="empty">No vendors yet. Add your first print partner above.</td></tr>}
        </tbody>
      </table></div>
    </Gate>
  );
}
