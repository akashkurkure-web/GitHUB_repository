import Gate from "@/components/Gate";
import { requirePermPage } from "@/lib/auth";
import { inr, d } from "@/lib/format";
import Pill from "@/components/Pill";
import { updateCredit, recordRepayment } from "../actions";

export default async function Credit() {
  const { supabase, perms } = await requirePermPage("finance");
  const { data, error } = await supabase.from("corporate_credit_accounts").select("*, profiles(email, full_name)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (
    <Gate perms={perms} m="finance">
      <div className="head"><div><h1>B2B credit</h1><p className="muted">Approve credit lines, change limits and record NEFT repayments against a UTR.</p></div></div>
      {(data ?? []).map((a: any) => (
        <div key={a.id} className="card">
          <div className="head">
            <div><h2>{a.company_name}</h2><p className="muted"><span className="mono">{a.gstin}</span> · {a.profiles?.email} · since {d(a.created_at)}</p></div>
            <Pill s={a.status} />
          </div>
          <div className="kpis">
            <div className="kpi"><span>Limit</span><b>{inr(a.approved_credit_limit_inr)}</b></div>
            <div className="kpi" style={{ ["--c" as string]: "var(--warn)" }}><span>Used</span><b>{inr(a.used_credit_balance_inr)}</b></div>
            <div className="kpi" style={{ ["--c" as string]: "var(--ok)" }}><span>Available</span><b>{inr(a.available_credit_inr)}</b></div>
            <div className="kpi" style={{ ["--c" as string]: "var(--accent)" }}><span>Next statement</span><b style={{ fontSize: "1.1rem" }}>{d(a.next_statement_due_date)}</b></div>
          </div>
          <form action={updateCredit} className="form">
            <input type="hidden" name="id" value={a.id} />
            <label className="f">Status<select name="status" defaultValue={a.status}><option value="pending_approval">pending approval</option><option value="active">active</option><option value="suspended_overdue">suspended overdue</option><option value="closed">closed</option></select></label>
            <label className="f">Limit ₹<input name="limit" type="number" step="1000" min="0" defaultValue={a.approved_credit_limit_inr} /></label>
            <label className="f">Cycle<select name="cycle" defaultValue={String(a.billing_cycle_days)}><option value="7">7 days</option><option value="15">15 days</option><option value="30">30 days</option></select></label>
            <label className="f">Account discount %<input name="discount" type="number" step="0.5" min="0" max="50" defaultValue={a.corporate_tier_discount_percent} /></label>
            <button className="btn">Save</button>
          </form>
          <form action={recordRepayment} className="form">
            <input type="hidden" name="id" value={a.id} />
            <label className="f">Repayment ₹<input name="amount" type="number" step="0.01" min="0" required /></label>
            <label className="f">Bank UTR<input name="utr" required /></label>
            <button className="btn ghost">Record repayment</button>
          </form>
        </div>
      ))}
      {!data?.length && <div className="card empty">No credit applications yet.</div>}
    </Gate>
  );
}
