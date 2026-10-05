import Gate from "@/components/Gate";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { inr, dt, label, ORDER_STATUSES } from "@/lib/format";
import Pill from "@/components/Pill";
import { updateOrderStatus, updateShipping, assignVendor, adminCancelOrder } from "../../actions";

export default async function OrderDetail({ params }: { params: { id: string } }) {
  const { supabase, perms } = await requireAdmin();
  const [{ data: o }, { data: items }, { data: jobs }, { data: vendors }, { data: notes }] = await Promise.all([
    supabase.from("orders").select("*, profiles(full_name, email, phone_number, company_name)").eq("id", params.id).maybeSingle(),
    supabase.from("order_items").select("*, cad_assets(id, file_name, volume_cm3, bounding_box_x_mm, bounding_box_y_mm, bounding_box_z_mm, is_watertight)").eq("order_id", params.id),
    supabase.from("vendor_jobs").select("*, vendors(company_name)").eq("order_id", params.id).order("created_at"),
    supabase.from("vendors").select("id, company_name, base_payout_share_percent").eq("is_active", true).order("company_name"),
    supabase.from("gst_credit_notes").select("id, credit_note_number").eq("order_id", params.id),
  ]);
  if (!o) notFound();
  const addr = (o.shipping_address ?? {}) as Record<string, string>;
  const suggested = vendors?.[0] ? (Number(o.subtotal_amount) * Number(vendors[0].base_payout_share_percent)) / 100 : 0;

  return (
    <Gate perms={perms} m="orders">
      <div className="head">
        <div>
          <Link href="/admin/orders" className="muted">← Orders</Link>
          <h1 className="mono">{o.order_number}</h1>
          <p className="muted">Placed {dt(o.created_at)} · <Pill s={o.status} /> {o.is_mmr_same_day_express && <span className="pill warn">MMR express</span>}</p>
        </div>
        <form action={updateOrderStatus} className="inline">
          <input type="hidden" name="id" value={o.id} />
          <select name="status" defaultValue={o.status}>{ORDER_STATUSES.filter((s) => !["cancelled", "refunded"].includes(s)).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          {["pending_payment", "proforma_issued"].includes(o.status) && <input name="utr" placeholder="Bank UTR (if paid by NEFT)" style={{ width: 200 }} />}
          <button className="btn">Update status</button>
        </form>
      </div>

      <div className="row">
        {o.invoice_number && <a className="btn ghost sm" href={`/documents/${o.id}?type=invoice`} target="_blank">Tax invoice</a>}
        {o.proforma_number && <a className="btn ghost sm" href={`/documents/${o.id}?type=proforma`} target="_blank">Proforma</a>}
        <a className="btn ghost sm" href={`/documents/${o.id}?type=packing-slip`} target="_blank">Packing slip</a>
        {(notes ?? []).map((n: any) => <a key={n.id} className="btn ghost sm" href={`/documents/${o.id}?type=credit-note&cn=${n.id}`} target="_blank">Credit note {n.credit_note_number}</a>)}
        <a className="btn ghost sm" href={`/track/${o.share_token}`} target="_blank">Public tracking page</a>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Customer</h2>
          <dl className="kv">
            <dt>Name</dt><dd>{o.profiles?.full_name || o.guest_name || "—"} {!o.user_id && <span className="pill warn">Guest</span>}</dd>
            <dt>Company</dt><dd>{o.customer_legal_name || o.profiles?.company_name || "—"}</dd>
            <dt>Email</dt><dd>{o.profiles?.email || o.guest_email || "—"}</dd>
            <dt>Phone</dt><dd>{o.profiles?.phone_number || o.shipping_address?.phone || "—"}</dd>
            <dt>GSTIN</dt><dd className="mono">{o.customer_gstin || "Not provided"}</dd>
            <dt>PO number</dt><dd>{o.b2b_po_number || "—"}</dd>
            <dt>Ship to</dt><dd>{[addr.name, addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") || "—"}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Bill</h2>
          <dl className="kv num">
            <dt>Subtotal</dt><dd>{inr(o.original_subtotal_amount)}</dd>
            {Number(o.discount_amount) > 0 && <><dt>Discount {o.coupon_code && <span className="mono">({o.coupon_code})</span>}</dt><dd>− {inr(o.discount_amount)}</dd></>}
            <dt>Shipping</dt><dd>{inr(o.shipping_amount)}</dd>
            <dt>Taxable</dt><dd>{inr(o.taxable_amount)}</dd>
            {o.is_intra_state ? <><dt>CGST 9%</dt><dd>{inr(o.cgst_amount)}</dd><dt>SGST 9%</dt><dd>{inr(o.sgst_amount)}</dd></> : <><dt>IGST 18%</dt><dd>{inr(o.igst_amount)}</dd></>}
            <dt><b>Total</b></dt><dd><b>{inr(o.total_amount)}</b></dd>
            <dt>Invoice</dt><dd className="mono">{o.invoice_number || "Issued when marked paid"}</dd>
            <dt>Payment</dt><dd>{[o.payment_provider, o.payment_method, o.payment_id].filter(Boolean).join(" · ") || "—"}</dd>
            {o.b2b_utr_number && <><dt>UTR</dt><dd className="mono">{o.b2b_utr_number}</dd></>}
          </dl>
        </div>
      </div>

      <div className="card">
        <h2>Parts</h2>
        <div className="tw"><table>
          <thead><tr><th>File</th><th>Material</th><th>Settings</th><th className="r">Qty</th><th className="r">Mass</th><th className="r">Line total</th></tr></thead>
          <tbody>{(items ?? []).map((it: any) => (
            <tr key={it.id}>
              <td><a href={`/api/files/cad/${it.cad_assets?.id}`}>{it.display_name || it.cad_assets?.file_name}</a>{it.catalog_product_id && <span className="pill info" style={{ marginLeft: 6 }}>Shop product</span>}<div className="muted mono">{[it.cad_assets?.bounding_box_x_mm, it.cad_assets?.bounding_box_y_mm, it.cad_assets?.bounding_box_z_mm].join(" × ")} mm{it.cad_assets?.is_watertight === false && " · not watertight"}</div></td>
              <td>{label(it.material)} · {it.color}<div className="muted">{label(it.selection_mode)}{it.manufacturer_final_material && ` → ${label(it.manufacturer_final_material)}`}</div>{it.customer_application_notes && <div className="muted">“{it.customer_application_notes}”</div>}</td>
              <td className="mono">{it.layer_height_mm} mm · {it.infill_percentage}%</td>
              <td className="r num">{it.quantity}</td>
              <td className="r num">{Number(it.total_batch_mass_grams || it.estimated_mass_grams).toFixed(1)} g</td>
              <td className="r num">{inr(it.total_line_price)}</td>
            </tr>))}
            {!items?.length && <tr><td colSpan={6} className="empty">No parts on this order.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Vendor jobs</h2>
          {(jobs ?? []).map((j: any) => (
            <div key={j.id} className="inline" style={{ justifyContent: "space-between" }}>
              <span className="mono">{j.job_number}</span><span>{j.vendors?.company_name}</span><Pill s={j.status} /><span className="muted">SLA {dt(j.sla_deadline_at)}</span>
              {j.actual_weighed_grams && <span className="mono">{j.actual_weighed_grams} g</span>}
              {j.qc_photo_path && <a href={`/api/files/photo?b=qc-photos&p=${encodeURIComponent(j.qc_photo_path)}`} target="_blank">QC photo</a>}
              {j.vendor_notes && <span className="muted">“{j.vendor_notes}”</span>}
            </div>
          ))}
          {!jobs?.length && <p className="muted">Not assigned yet.</p>}
          <form action={assignVendor} className="form">
            <input type="hidden" name="order_id" value={o.id} />
            <label className="f">Vendor<select name="vendor_id" required defaultValue="">{<option value="" disabled>Choose…</option>}{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}</select></label>
            <label className="f">Payout ₹<input name="payout" type="number" step="0.01" min="0" defaultValue={suggested.toFixed(2)} /></label>
            <label className="f">SLA hours<select name="sla_hours" defaultValue="48"><option value="24">24 (express)</option><option value="48">48 (standard)</option><option value="72">72 (batch / resin)</option></select></label>
            <button className="btn">Assign job</button>
          </form>
          {!vendors?.length && <p className="notice">Add a vendor under Vendors before assigning jobs.</p>}
        </div>
        <div className="card">
          <h2>Shipping</h2>
          <form action={updateShipping} className="form">
            <input type="hidden" name="id" value={o.id} />
            <label className="f">Courier<input name="courier_partner" defaultValue={o.courier_partner ?? ""} placeholder="Delhivery, Blue Dart…" /></label>
            <label className="f">Tracking / AWB<input name="tracking_number" defaultValue={o.tracking_number ?? ""} /></label>
            <label className="f" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="express" defaultChecked={o.is_mmr_same_day_express} style={{ width: "auto" }} />MMR same-day</label>
            <button className="btn">Save shipping</button>
          </form>
          {o.current_courier_status && <p className="muted">Courier status: {o.current_courier_status}</p>}
        </div>
      </div>
      {!["cancelled", "refunded", "delivered", "shipped", "out_for_delivery"].includes(o.status) && (
        <form action={adminCancelOrder} className="card" style={{ borderTop: "4px solid var(--bad)" }}>
          <h2>Cancel order</h2>
          <p className="muted">Unpaid orders are simply cancelled. Paid orders are refunded and a GST credit note is issued. Open vendor jobs are stopped.</p>
          <input type="hidden" name="id" value={o.id} />
          <div className="inline">
            <select name="refund_to" defaultValue="source"><option value="source">Refund to original payment</option><option value="wallet">Refund to customer wallet</option></select>
            <button className="btn danger">Cancel order</button>
          </div>
        </form>
      )}
    </Gate>
  );
}
