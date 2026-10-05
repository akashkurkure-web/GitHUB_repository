import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { inr, d, label } from "@/lib/format";
import { rupeesInWords } from "@/lib/words";
import PrintButton from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document", robots: { index: false } };

const STATE_NAMES: Record<string, string> = { "27": "Maharashtra", "24": "Gujarat", "29": "Karnataka", "07": "Delhi", "33": "Tamil Nadu", "36": "Telangana", "09": "Uttar Pradesh", "19": "West Bengal", "08": "Rajasthan", "23": "Madhya Pradesh", "32": "Kerala", "06": "Haryana", "03": "Punjab", "30": "Goa", "37": "Andhra Pradesh" };

export default async function Doc({ params, searchParams }: { params: { id: string }; searchParams: { type?: string; cn?: string; t?: string } }) {
  const type = searchParams.type || "invoice";
  const { user, profile, supabase } = await getSession();
  const svc = serviceClient();
  const { data: o } = await svc.from("orders").select("*").eq("id", params.id).maybeSingle();
  if (!o) notFound();
  const byLink = Boolean(searchParams.t && o.share_token && searchParams.t === o.share_token && type !== "packing-slip");
  if (!user && !byLink) redirect(`/login?next=${encodeURIComponent(`/documents/${params.id}?type=${type}`)}`);

  // Access rules: staff, the buyer, the private-link holder, or the assigned partner (packing slip only)
  let allowed = byLink || profile?.role === "admin" || (Boolean(user) && o.user_id === user!.id && type !== "packing-slip");
  if (!allowed && type === "packing-slip" && profile?.role === "vendor") {
    const { data: job } = await supabase.from("vendor_jobs").select("id").eq("order_id", o.id).maybeSingle(); // RLS: own jobs
    allowed = Boolean(job);
  }
  if (!allowed) notFound();

  const [{ data: items }, { data: biz }, { data: buyer }] = await Promise.all([
    svc.from("order_items").select("*, cad_assets(file_name)").eq("order_id", o.id),
    svc.from("portal_business_identity").select("*").eq("id", 1).single(),
    o.user_id ? svc.from("profiles").select("full_name, email, phone_number").eq("id", o.user_id).single() : Promise.resolve({ data: { full_name: o.guest_name, email: o.guest_email, phone_number: o.shipping_address?.phone } } as any),
  ]);
  let cn: any = null;
  if (type === "credit-note") {
    const { data } = await svc.from("gst_credit_notes").select("*").eq("id", searchParams.cn || "").eq("order_id", o.id).maybeSingle();
    if (!data) notFound();
    cn = data;
  }
  if (type === "invoice" && !o.invoice_number) notFound();
  if (type === "proforma" && !o.proforma_number) notFound();

  const title = { invoice: "TAX INVOICE", proforma: "PROFORMA INVOICE", "credit-note": "CREDIT NOTE", "packing-slip": "PACKING SLIP" }[type] || "TAX INVOICE";
  const a = o.shipping_address || {};
  const showMoney = type !== "packing-slip";
  const sign = type === "credit-note" ? -1 : 1;
  const total = type === "credit-note" ? Number(cn.total_credit_amount) : Number(o.total_amount);

  return (
    <main style={{ padding: "24px 16px", background: "var(--bg)", minHeight: "100vh" }}>
      <div className="noprint row" style={{ maxWidth: 860, margin: "0 auto 14px", justifyContent: "space-between" }}>
        <a href={byLink && !user ? `/track/${o.share_token}` : profile?.role === "admin" ? `/admin/orders/${o.id}` : profile?.role === "vendor" ? "/vendor" : `/account/orders/${o.id}`}>← Back</a>
        <PrintButton />
      </div>
      <div className="doc">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap", borderBottom: "2px solid #111", paddingBottom: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{biz?.brand_name}</div>
            {showMoney && <>
              <div>{biz?.legal_entity_name}</div>
              <div>{biz?.registered_address_line1}, {biz?.city}, {biz?.state} – {biz?.pincode}</div>
              <div>GSTIN: <b>{biz?.gstin}</b> · State code 27 (Maharashtra)</div>
            </>}
            <div>{biz?.support_email} · {biz?.escalation_phone}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
            {type === "invoice" && <><div>Invoice no: <b>{o.invoice_number}</b></div><div>Date: {d(o.paid_at || o.created_at)}</div></>}
            {type === "proforma" && <><div>Proforma no: <b>{o.proforma_number}</b></div><div>Date: {d(o.created_at)}</div><div>Valid for 7 days</div></>}
            {type === "credit-note" && <><div>Credit note no: <b>{cn.credit_note_number}</b></div><div>Date: {d(cn.created_at)}</div><div>Against invoice {cn.original_invoice_number} dated {d(cn.original_invoice_date)}</div><div>Reason: {cn.reason_code}</div></>}
            <div>Order: {o.order_number}</div>
            {type === "packing-slip" && <div>Packed: ____ / ____ / ______</div>}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: "12px 0" }}>
          {showMoney && <div>
            <b>Bill to</b><br />{o.customer_legal_name || buyer?.full_name}<br />
            {o.customer_gstin ? <>GSTIN: <b>{o.customer_gstin}</b><br /></> : <>Unregistered (B2C)<br /></>}
            {buyer?.email}<br />
            Place of supply: {o.place_of_supply_code} – {STATE_NAMES[o.place_of_supply_code] || a.state}
            {o.b2b_po_number && <><br />PO: {o.b2b_po_number}</>}
          </div>}
          <div>
            <b>Ship to</b><br />{a.name}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state} – {a.pincode}<br />Phone: {a.phone}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>#</th><th>Description</th><th>HSN</th><th className="r">Qty</th>{showMoney && <><th className="r">Rate</th><th className="r">Amount</th></>}</tr></thead>
          <tbody>
            {(items ?? []).map((it: any, i: number) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>3D printed part – {it.display_name || it.cad_assets?.file_name}<br /><span style={{ color: "#555" }}>{label(it.manufacturer_final_material || it.material)}, {it.color}, {it.layer_height_mm} mm{it.technology === "fdm" ? `, ${it.infill_percentage}% infill` : ""}</span></td>
                <td>{o.hsn_code}</td><td className="r">{it.quantity}</td>
                {showMoney && <><td className="r">{inr(Number(it.total_line_price) / it.quantity)}</td><td className="r">{inr(sign * Number(it.total_line_price))}</td></>}
              </tr>
            ))}
          </tbody>
        </table>

        {showMoney && (
          <table style={{ width: "100%", maxWidth: 380, marginLeft: "auto", marginTop: 12, borderCollapse: "collapse" }}>
            <tbody>
              {type !== "credit-note" ? <>
                <tr><td>Items</td><td className="r">{inr(o.original_subtotal_amount)}</td></tr>
                {Number(o.discount_amount) > 0 && <tr><td>Discount{o.coupon_code ? ` (${o.coupon_code})` : ""}</td><td className="r">− {inr(o.discount_amount)}</td></tr>}
                {Number(o.referral_discount_inr) > 0 && <tr><td>Referral discount</td><td className="r">− {inr(o.referral_discount_inr)}</td></tr>}
                <tr><td>Freight</td><td className="r">{inr(o.shipping_amount)}</td></tr>
                <tr><td><b>Taxable value</b></td><td className="r"><b>{inr(o.taxable_amount)}</b></td></tr>
                {o.is_intra_state ? <><tr><td>CGST @ 9%</td><td className="r">{inr(o.cgst_amount)}</td></tr><tr><td>SGST @ 9%</td><td className="r">{inr(o.sgst_amount)}</td></tr></>
                  : <tr><td>IGST @ 18%</td><td className="r">{inr(o.igst_amount)}</td></tr>}
                <tr><td><b>Invoice total</b></td><td className="r"><b>{inr(o.total_amount)}</b></td></tr>
                {Number(o.wallet_applied_inr) > 0 && <tr><td>Paid from wallet</td><td className="r">{inr(o.wallet_applied_inr)}</td></tr>}
              </> : <>
                <tr><td>Taxable value reversed</td><td className="r">{inr(cn.reversed_taxable_amount)}</td></tr>
                {Number(cn.reversed_igst_amount) > 0 ? <tr><td>IGST reversed</td><td className="r">{inr(cn.reversed_igst_amount)}</td></tr>
                  : <><tr><td>CGST reversed</td><td className="r">{inr(cn.reversed_cgst_amount)}</td></tr><tr><td>SGST reversed</td><td className="r">{inr(cn.reversed_sgst_amount)}</td></tr></>}
                <tr><td><b>Total credit</b></td><td className="r"><b>{inr(cn.total_credit_amount)}</b></td></tr>
                <tr><td>Refunded to</td><td className="r">{cn.refund_destination === "store_wallet" ? "Store wallet" : "Original payment method"}</td></tr>
              </>}
            </tbody>
          </table>
        )}
        {showMoney && <p style={{ marginTop: 10 }}><b>Amount in words:</b> {rupeesInWords(total)}</p>}
        {type === "invoice" && <p>Payment: {o.payment_provider}{o.payment_id ? ` · ${o.payment_id}` : ""}{o.b2b_utr_number ? ` · UTR ${o.b2b_utr_number}` : ""}. Tax is not payable on reverse charge.</p>}
        {type === "proforma" && (
          <div style={{ border: "1px solid #ccc", padding: 10, marginTop: 10 }}>
            <b>Bank details for NEFT / RTGS / IMPS</b><br />
            Account name: {process.env.BANK_ACCOUNT_NAME || "— set BANK_ACCOUNT_NAME —"}<br />
            Bank: {process.env.BANK_NAME || "— set BANK_NAME —"}<br />
            Account no: {process.env.BANK_ACCOUNT_NO || "— set BANK_ACCOUNT_NO —"} · IFSC: {process.env.BANK_IFSC || "— set BANK_IFSC —"}<br />
            Reference: <b>{o.proforma_number}</b>. This is not a tax invoice. The tax invoice is issued when payment is received.
          </div>
        )}
        {type === "packing-slip" && <p style={{ marginTop: 14 }}>QC weight checked ☐ · Supports removed ☐ · Count matches ☐ · Packed by: ____________</p>}
        <p style={{ marginTop: 24, color: "#555" }}>This is a computer-generated document. For {biz?.legal_entity_name}.</p>
      </div>
    </main>
  );
}
