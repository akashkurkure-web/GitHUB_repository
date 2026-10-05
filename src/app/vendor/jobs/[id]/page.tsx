import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/auth";
import { inr, dt, label } from "@/lib/format";
import Pill from "@/components/Pill";
import Flash from "@/components/account/Flash";
import { advanceJob, setFinalMaterial, submitQC } from "../../actions";

const MATS = ["pla", "petg", "abs", "asa", "tpu", "standard_resin", "tough_resin"];
const BOXES = [["BOX_XS", "XS 10×10×5 cm"], ["BOX_S", "S 15×15×10 cm"], ["BOX_M", "M 25×20×15 cm"], ["BOX_L", "L 35×30×20 cm"], ["BOX_XL", "XL custom"]];

export default async function VendorJob({ params, searchParams }: { params: { id: string }; searchParams: any }) {
  const { supabase } = await requireVendor();
  const { data: j } = await supabase.from("vendor_jobs").select("*, orders(id, order_number, is_mmr_same_day_express, shipping_address, tracking_number, courier_partner)").eq("id", params.id).maybeSingle();
  if (!j) notFound();
  const { data: items } = await supabase.from("order_items").select("*, cad_assets(id, file_name, bounding_box_x_mm, bounding_box_y_mm, bounding_box_z_mm, is_watertight)").eq("order_id", j.order_id);
  const expected = (items ?? []).reduce((n: number, i: any) => n + Number(i.total_batch_mass_grams || Number(i.estimated_mass_grams) * i.quantity), 0);
  const lateH = (Date.now() - new Date(j.sla_deadline_at).getTime()) / 3600_000;
  const a = j.orders?.shipping_address || {};
  const btn = (to: string, text: string, extra?: React.ReactNode, cls = "btn") => (
    <form action={advanceJob} className="inline"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="to" value={to} />{extra}<button className={cls}>{text}</button></form>
  );

  return (
    <>
      <Flash sp={searchParams} />
      <div className="head">
        <div><Link href="/vendor" className="muted">← Job queue</Link><h1 className="mono">{j.job_number}</h1>
          <p className="muted">Order {j.orders?.order_number} · <Pill s={j.status} /> · deadline {dt(j.sla_deadline_at)} {lateH > 0 && j.status !== "handed_over" && <span className="pill bad">{lateH.toFixed(0)} h late</span>}</p></div>
        <div className="kpi" style={{ ["--c" as string]: "var(--ok)" }}><span>Your payout</span><b>{inr(j.vendor_payout_amount)}</b></div>
      </div>

      <div className="card" style={{ borderTop: "4px solid var(--accent)" }}>
        <h2>Next step</h2>
        <div className="row">
          {j.status === "queued_for_vendor" && <>{btn("accepted", "Accept job")}{btn("rejected", "Can't take it", <input name="reason" placeholder="Reason (machine down, material…)" style={{ width: 260 }} />, "btn ghost")}</>}
          {j.status === "accepted" && <>{btn("printing", "Start printing")}{btn("rejected", "Return job", <input name="reason" placeholder="Reason" style={{ width: 200 }} />, "btn ghost")}</>}
          {j.status === "printing" && <>{btn("post_processing", "Printing done → post-processing")}<span className="muted">or upload QC below if no post-processing is needed.</span></>}
          {j.status === "post_processing" && <span className="muted">When finished, weigh the parts and upload the QC photo below.</span>}
          {j.status === "qc_uploaded" && btn("packed_ready", "Packed and ready for pickup", <select name="box" defaultValue={j.selected_box_code || "BOX_S"}>{BOXES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>)}
          {j.status === "packed_ready" && <>{btn("handed_over", "Handed to courier")}<a className="btn ghost" href={`/documents/${j.order_id}?type=packing-slip`} target="_blank">Print packing slip</a></>}
          {j.status === "handed_over" && <span>Done. Payout is included in next Monday&apos;s settlement.</span>}
          {j.status === "rejected" && <span>Returned to Layer27{j.vendor_notes ? `: ${j.vendor_notes}` : ""}.</span>}
        </div>
      </div>

      <div className="card">
        <h2>Parts to print</h2>
        <p className="muted">Slice exactly as specified. Lowering infill or changing layer height is a breach of the partner agreement. Delete local copies within 24 hours of pickup.</p>
        <div className="tw"><table>
          <thead><tr><th>File</th><th>Material</th><th>Settings</th><th className="r">Qty</th><th className="r">Expected mass</th><th /></tr></thead>
          <tbody>{(items ?? []).map((it: any) => (
            <tr key={it.id}>
              <td><b>{it.display_name || it.cad_assets?.file_name}</b><div className="muted mono">{[it.cad_assets?.bounding_box_x_mm, it.cad_assets?.bounding_box_y_mm, it.cad_assets?.bounding_box_z_mm].join(" × ")} mm{it.cad_assets?.is_watertight === false && " · needs repair"}</div>
                {it.customer_application_notes && <div className="muted">Customer: “{it.customer_application_notes}”</div>}</td>
              <td>{label(it.manufacturer_final_material || it.material)} · {it.color}
                {it.selection_mode === "manufacturer_decides" && (
                  <form action={setFinalMaterial} className="inline" style={{ marginTop: 6 }}>
                    <input type="hidden" name="job_id" value={j.id} /><input type="hidden" name="item_id" value={it.id} />
                    <span className="muted">Use: {label(it.application_environment)} · {label(it.mechanical_stress_level)}</span>
                    <select name="material" defaultValue={it.manufacturer_final_material || it.material}>{MATS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
                    <input name="notes" placeholder="Why this material" defaultValue={it.manufacturer_decision_notes ?? ""} style={{ width: 180 }} />
                    <button className="btn sm ghost">Confirm</button>
                  </form>)}
              </td>
              <td className="mono">{it.layer_height_mm} mm{it.technology === "fdm" ? ` · ${it.infill_percentage}% infill` : ""}</td>
              <td className="r num">{it.quantity}</td>
              <td className="r num">{Number(it.total_batch_mass_grams || it.estimated_mass_grams * it.quantity).toFixed(0)} g</td>
              <td>{!["handed_over", "rejected"].includes(j.status) && <a className="btn sm" href={`/api/files/cad/${it.cad_assets?.id}`}>Download STL</a>}</td>
            </tr>))}</tbody>
        </table></div>
        <p className="muted">Downloads are logged with time and IP.</p>
      </div>

      {["printing", "post_processing", "qc_uploaded"].includes(j.status) && (
        <form action={submitQC} className="card">
          <h2>QC weigh-in</h2>
          <p className="muted">Put all finished, support-free parts on a calibrated scale and photograph the reading. Expected total: <b>{expected.toFixed(0)} g</b>. More than ±15% off blocks dispatch.</p>
          <input type="hidden" name="id" value={j.id} />
          <div className="form">
            <label className="f">Scale reading (g)<input name="grams" type="number" step="0.1" min="0" required defaultValue={j.actual_weighed_grams ?? ""} /></label>
            <label className="f">Photo on scale (under 4 MB)<input name="photo" type="file" accept="image/*" capture="environment" required /></label>
            <button className="btn">Upload QC</button>
          </div>
          {j.qc_photo_path && <p><a href={`/api/files/photo?b=qc-photos&p=${encodeURIComponent(j.qc_photo_path)}`} target="_blank">View last QC photo</a> · {j.actual_weighed_grams} g</p>}
        </form>
      )}

      {["packed_ready", "handed_over"].includes(j.status) && (
        <div className="card"><h2>Shipping</h2>
          <dl className="kv"><dt>Ship to</dt><dd>{a.name}, {a.city} – {a.pincode}</dd><dt>Courier</dt><dd>{j.orders?.courier_partner || "Layer27 books the pickup"}</dd><dt>AWB</dt><dd className="mono">{j.orders?.tracking_number || "—"}</dd></dl>
          <p className="muted">Use only the Layer27 label and packing slip. No business cards, invoices or your branding in the parcel.</p>
        </div>
      )}
    </>
  );
}
