import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { inr, dt, d } from "@/lib/format";
import Pill from "@/components/Pill";
import Gate from "@/components/Gate";
import { saveCustomer, adjustWallet, setB2BVerified } from "../../actions";

export default async function Customer({ params }: { params: { id: string } }) {
  const { supabase, perms } = await requireAdmin();
  const { data: p } = await supabase.from("profiles").select("*").eq("id", params.id).maybeSingle();
  if (!p) notFound();
  const [{ data: orders }, { data: tickets }] = await Promise.all([
    supabase.from("orders").select("id, order_number, status, total_amount, created_at").eq("user_id", p.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("support_tickets").select("ticket_number, status, issue_summary, created_at").eq("user_id", p.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const a = p.default_shipping_address || {};
  return (
    <Gate perms={perms} m="customers">
      <div className="head"><div><Link href="/admin/customers" className="muted">← Customers</Link><h1>{p.full_name || p.email}</h1><p className="muted">{p.email} · joined {d(p.created_at)} · referral code <span className="mono">{p.referral_code}</span></p></div></div>
      <div className="grid2">
        <form action={saveCustomer} className="card">
          <h2>Details</h2>
          <input type="hidden" name="id" value={p.id} />
          <div className="form">
            <label className="f">Full name<input name="full_name" defaultValue={p.full_name ?? ""} /></label>
            <label className="f">Mobile<input name="phone_number" defaultValue={p.phone_number ?? ""} /></label>
            <label className="f">Company<input name="company_name" defaultValue={p.company_name ?? ""} /></label>
            <label className="f">GSTIN<input name="gstin" defaultValue={p.gstin ?? ""} maxLength={15} /></label>
          </div>
          <p className="muted" style={{ fontSize: ".82rem" }}>Saved address: {[a.line1, a.city, a.pincode].filter(Boolean).join(", ") || "none"}</p>
          <div><button className="btn">Save details</button></div>
        </form>
        <div className="card">
          <h2>Wallet &amp; B2B</h2>
          <div className="kpis"><div className="kpi" style={{ ["--c" as string]: "var(--ok)" }}><span>Wallet</span><b>{inr(p.wallet_balance_inr)}</b></div><div className="kpi"><span>Referral earnings</span><b>{inr(p.total_referral_earnings_inr)}</b></div></div>
          <form action={adjustWallet} className="form">
            <input type="hidden" name="id" value={p.id} />
            <label className="f">Add (+) or remove (−) ₹<input name="amount" type="number" step="0.01" required /></label>
            <label className="f">Reason (saved in audit log)<input name="reason" required placeholder="Goodwill for late delivery" /></label>
            <button className="btn ghost">Adjust wallet</button>
          </form>
          <form action={setB2BVerified} className="inline"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="value" value={String(!p.is_verified_b2b)} />
            <span className={`pill ${p.is_verified_b2b ? "ok" : "info"}`}>{p.is_verified_b2b ? "GSTIN verified" : "Not verified"}</span>{p.gstin && <button className="btn sm ghost">{p.is_verified_b2b ? "Revoke" : "Mark GSTIN verified"}</button>}</form>
        </div>
      </div>
      <div className="card"><h2>Orders</h2>
        <div className="tw"><table><thead><tr><th>Order</th><th>Status</th><th className="r">Total</th><th>Placed</th></tr></thead>
          <tbody>{(orders ?? []).map((o) => <tr key={o.id}><td><Link className="mono" href={`/admin/orders/${o.id}`}>{o.order_number}</Link></td><td><Pill s={o.status} /></td><td className="r num">{inr(o.total_amount)}</td><td>{dt(o.created_at)}</td></tr>)}
            {!orders?.length && <tr><td colSpan={4} className="empty">No orders yet.</td></tr>}</tbody></table></div></div>
      {(tickets ?? []).length > 0 && <div className="card"><h2>Support tickets</h2>{tickets!.map((t) => <p key={t.ticket_number}><span className="mono">{t.ticket_number}</span> · <Pill s={t.status} /> · {t.issue_summary}</p>)}</div>}
    </Gate>
  );
}
