import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { inr, dt, label } from "@/lib/format";
import Pill from "@/components/Pill";
import Flash from "@/components/account/Flash";
import Timeline from "@/components/account/Timeline";
import PayNow from "@/components/account/PayNow";
import { cancelMyOrder, submitClaim, submitReview } from "../../actions";

export default async function MyOrder({ params, searchParams }: { params: { id: string }; searchParams: any }) {
  const { supabase, user } = await requireUser();
  const [{ data: o }, { data: items }, { data: review }, { data: claims }, { data: notes }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", params.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("order_items").select("*, cad_assets(file_name)").eq("order_id", params.id),
    supabase.from("product_service_reviews").select("id, overall_rating, status").eq("order_id", params.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("defect_warranty_claims").select("claim_number, status, claim_type, created_at").eq("order_id", params.id),
    supabase.from("gst_credit_notes").select("id, credit_note_number, total_credit_amount").eq("order_id", params.id),
  ]);
  if (!o) notFound();
  const payable = Number(o.total_amount) - Number(o.wallet_applied_inr);
  const deliveredAt = o.delivered_at ? new Date(o.delivered_at).getTime() : null;
  const claimOpen = o.status === "delivered" && deliveredAt && Date.now() - deliveredAt < 48 * 3600_000;
  const canCancel = ["pending_payment", "proforma_issued", "paid"].includes(o.status);

  return (
    <>
      <Flash sp={searchParams} />
      <div className="head">
        <div><Link href="/account" className="muted">← All orders</Link><h1 className="mono">{o.order_number}</h1><p className="muted">Placed {dt(o.created_at)} · <Pill s={o.status} /></p></div>
        <div className="row">
          {o.invoice_number && <Link className="btn ghost" href={`/documents/${o.id}?type=invoice`}>Tax invoice</Link>}
          {o.proforma_number && <Link className="btn ghost" href={`/documents/${o.id}?type=proforma`}>Proforma</Link>}
          {(notes ?? []).map((n) => <Link key={n.id} className="btn ghost" href={`/documents/${o.id}?type=credit-note&cn=${n.id}`}>Credit note</Link>)}
        </div>
      </div>
      <Timeline status={o.status} />

      {["pending_payment", "proforma_issued"].includes(o.status) && (
        <div className="card">
          <h2>{o.status === "proforma_issued" ? "Waiting for your bank transfer" : "Waiting for payment"}</h2>
          {o.status === "proforma_issued" && <p className="muted">Transfer {inr(payable)} using the bank details on the proforma and quote <b className="mono">{o.proforma_number}</b>. Printing starts once we receive it. You can also pay online instead.</p>}
          <PayNow orderId={o.id} label={`Pay ${inr(payable)} online`} />
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h2>Parts</h2>
          {(items ?? []).map((it: any) => (
            <div key={it.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
              <b>{it.display_name || it.cad_assets?.file_name}</b>
              <div className="muted">{label(it.manufacturer_final_material || it.material)} · {it.color} · {it.layer_height_mm} mm{it.technology === "fdm" ? ` · ${it.infill_percentage}% infill` : ""} · {it.quantity} pcs</div>
              {it.manufacturer_decision_notes && <div className="muted">Engineer: {it.manufacturer_decision_notes}</div>}
              <div className="num">{inr(it.total_line_price)}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Delivery</h2>
          <dl className="kv">
            <dt>Ship to</dt><dd>{[o.shipping_address?.name, o.shipping_address?.line1, o.shipping_address?.line2, o.shipping_address?.city, o.shipping_address?.pincode].filter(Boolean).join(", ")}</dd>
            <dt>Service</dt><dd>{o.is_mmr_same_day_express ? "MMR same-day express" : "Standard"}</dd>
            <dt>Courier</dt><dd>{o.courier_partner || "Assigned at dispatch"}</dd>
            <dt>Tracking</dt><dd className="mono">{o.tracking_number || "—"}</dd>
            <dt>Public tracking</dt><dd><Link href={`/track/${o.share_token}`}>Share link</Link></dd>
          </dl>
          <h2 style={{ marginTop: 8 }}>Bill</h2>
          <dl className="kv num">
            <dt>Taxable</dt><dd>{inr(o.taxable_amount)}</dd>
            {o.is_intra_state ? <><dt>CGST + SGST</dt><dd>{inr(Number(o.cgst_amount) + Number(o.sgst_amount))}</dd></> : <><dt>IGST</dt><dd>{inr(o.igst_amount)}</dd></>}
            {Number(o.wallet_applied_inr) > 0 && <><dt>Wallet used</dt><dd>{inr(o.wallet_applied_inr)}</dd></>}
            <dt><b>Total</b></dt><dd><b>{inr(o.total_amount)}</b></dd>
          </dl>
          {canCancel && (
            <form action={cancelMyOrder}><input type="hidden" name="id" value={o.id} />
              <button className="btn sm ghost">{o.status === "paid" ? "Cancel and refund" : "Cancel order"}</button></form>
          )}
        </div>
      </div>

      {o.status === "delivered" && !review && (
        <form action={submitReview} className="card">
          <h2>How did we do?</h2>
          <input type="hidden" name="order_id" value={o.id} />
          <div className="form">
            {[["overall", "Overall"], ["surface", "Surface finish"], ["accuracy", "Dimensional accuracy"], ["delivery", "Packaging & delivery"]].map(([k, t]) => (
              <label key={k} className="f">{t}<select name={k} defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n}</option>)}</select></label>
            ))}
            <label className="f">City or company<input name="city" placeholder="Pune, MH" /></label>
          </div>
          <label className="f">Title<input name="title" required maxLength={120} /></label>
          <label className="f">Your review<textarea name="comment" required maxLength={2000} /></label>
          <div><button className="btn">Submit review</button></div>
        </form>
      )}
      {review && <div className="card"><p>You rated this order {"★".repeat(review.overall_rating)}. Thank you.</p></div>}

      {(claims ?? []).length > 0 && <div className="card"><h2>Warranty claims</h2>{claims!.map((c) => <p key={c.claim_number}><span className="mono">{c.claim_number}</span> · {label(c.claim_type)} · <Pill s={c.status} /></p>)}</div>}
      {claimOpen && (
        <form action={submitClaim} className="card">
          <h2>Something wrong with your parts?</h2>
          <p className="muted">Claims are open for 48 hours after delivery. Include an unboxing photo or a caliper reading.</p>
          <input type="hidden" name="order_id" value={o.id} />
          <label className="f">What went wrong<select name="claim_type" required defaultValue=""><option value="" disabled>Choose…</option><option value="dimensional_tolerance_error">Dimensions out of tolerance</option><option value="surface_delamination">Layers splitting / surface defect</option><option value="missing_batch_quantity">Pieces missing</option><option value="transit_box_crushed">Box crushed in transit</option></select></label>
          <label className="f">Details<textarea name="description" required /></label>
          <label className="f">Photos (up to 4, under 4 MB in total)<input type="file" name="photos" accept="image/*" multiple required /></label>
          <div><button className="btn">Submit claim</button></div>
        </form>
      )}
    </>
  );
}
