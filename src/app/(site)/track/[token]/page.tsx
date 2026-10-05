import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { dt, inr, label } from "@/lib/format";
import Pill from "@/components/Pill";
import Timeline from "@/components/account/Timeline";
import PayNow from "@/components/account/PayNow";
import Flash from "@/components/account/Flash";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your order", robots: { index: false } };

export default async function Track({ params, searchParams }: { params: { token: string }; searchParams: any }) {
  if (!/^[0-9a-f]{12,32}$/.test(params.token)) notFound();
  const sb = serviceClient();
  const { data: o } = await sb.from("orders").select("*").eq("share_token", params.token).maybeSingle();
  if (!o) notFound();
  const { data: items } = await sb.from("order_items").select("display_name, material, manufacturer_final_material, color, quantity, total_line_price, cad_assets(file_name)").eq("order_id", o.id);
  const { user } = await getSession();
  const isGuestOrder = !o.user_id;
  const payable = Number(o.total_amount) - Number(o.wallet_applied_inr);
  const t = params.token;
  return (
    <main className="wrap page" style={{ maxWidth: 900 }}>
      <Flash sp={searchParams} />
      <span className="eyebrow">Order tracking</span>
      <h1 className="mono">{o.order_number}</h1>
      <p className="muted"><Pill s={o.status} /> · updated {dt(o.updated_at)} · delivering to {o.shipping_address?.city}</p>
      <Timeline status={o.status} />
      <p className="muted" style={{ fontSize: ".82rem" }}>Keep this page&apos;s link private. Anyone with it can see this order.</p>

      {["pending_payment", "proforma_issued"].includes(o.status) && (
        <div className="card">
          <h2>{o.status === "proforma_issued" ? "Waiting for your bank transfer" : "Waiting for payment"}</h2>
          {o.proforma_number && <p className="muted">Transfer {inr(payable)} quoting <b className="mono">{o.proforma_number}</b>, or pay online now.</p>}
          <PayNow orderId={o.id} token={t} back={`/track/${t}`} label={`Pay ${inr(payable)} online`} />
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h2>Items</h2>
          {(items ?? []).map((it: any, i: number) => (
            <div key={i} className="row" style={{ justifyContent: "space-between" }}>
              <span><b>{it.display_name || it.cad_assets?.file_name}</b><br /><span className="muted">{label(it.manufacturer_final_material || it.material)} · {it.color} · {it.quantity} pcs</span></span>
              <span className="num">{inr(it.total_line_price)}</span>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8 }}><b>Total incl. GST</b><b className="num">{inr(o.total_amount)}</b></div>
        </div>
        <div className="card">
          <h2>Delivery</h2>
          <dl className="kv"><dt>Service</dt><dd>{o.is_mmr_same_day_express ? "MMR same-day express" : "Standard"}</dd><dt>Courier</dt><dd>{o.courier_partner || "Assigned at dispatch"}</dd><dt>AWB</dt><dd className="mono">{o.tracking_number || "—"}</dd></dl>
          <div className="row">
            {o.invoice_number && <Link className="btn sm ghost" href={`/documents/${o.id}?type=invoice&t=${t}`}>Tax invoice</Link>}
            {o.proforma_number && <Link className="btn sm ghost" href={`/documents/${o.id}?type=proforma&t=${t}`}>Proforma</Link>}
          </div>
        </div>
      </div>

      {isGuestOrder && !user && (
        <div className="card" style={{ borderTop: "4px solid var(--accent)" }}>
          <h2>Keep all your orders in one place</h2>
          <p className="muted">Create a free account with <b>{o.guest_email}</b>. This order moves into it automatically, and you can then leave a review, raise a warranty claim and earn referral rewards.</p>
          <div className="row"><Link className="btn" href={`/login?tab=up&next=/account`}>Create account</Link><Link className="btn ghost" href="/account/support">Need help?</Link></div>
        </div>
      )}
      {!isGuestOrder && user && <p><Link href={`/account/orders/${o.id}`}>Open this order in your account →</Link></p>}
    </main>
  );
}
