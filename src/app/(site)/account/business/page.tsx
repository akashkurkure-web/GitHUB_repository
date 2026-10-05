import { requireUser } from "@/lib/auth";
import { inr, dt, d, label } from "@/lib/format";
import Pill from "@/components/Pill";
import Flash from "@/components/account/Flash";
import { applyCredit } from "../actions";

export default async function Business({ searchParams }: { searchParams: any }) {
  const { supabase, user, profile } = await requireUser();
  const { data: acc } = await supabase.from("corporate_credit_accounts").select("*").eq("user_id", user.id).maybeSingle();
  const { data: ledger } = acc ? await supabase.from("corporate_credit_ledger").select("*").eq("credit_account_id", acc.id).order("created_at", { ascending: false }).limit(50) : { data: [] as any[] };
  return (
    <>
      <Flash sp={searchParams} />
      {!acc ? (
        <form action={applyCredit} className="card">
          <h2>Apply for a company credit account</h2>
          <p className="muted">Order now, pay by NEFT within 7, 15 or 30 days. Includes a 10% account discount once approved.</p>
          <div className="form">
            <label className="f">Registered company name<input name="company" required defaultValue={profile.company_name ?? ""} /></label>
            <label className="f">GSTIN<input name="gstin" required maxLength={15} defaultValue={profile.gstin ?? ""} /></label>
            <label className="f">Preferred cycle<select name="cycle" defaultValue="15"><option value="7">7 days</option><option value="15">15 days</option><option value="30">30 days</option></select></label>
          </div>
          <div><button className="btn">Apply</button></div>
        </form>
      ) : (
        <>
          <div className="card">
            <div className="head"><div><h2>{acc.company_name}</h2><p className="muted mono">{acc.gstin}</p></div><Pill s={acc.status} /></div>
            <div className="kpis">
              <div className="kpi"><span>Limit</span><b>{inr(acc.approved_credit_limit_inr)}</b></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--warn)" }}><span>Used</span><b>{inr(acc.used_credit_balance_inr)}</b></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--ok)" }}><span>Available</span><b>{inr(acc.available_credit_inr)}</b></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--accent)" }}><span>Terms</span><b>{acc.billing_cycle_days} days</b></div>
            </div>
            {acc.next_statement_due_date && <p>Next statement due {d(acc.next_statement_due_date)}.</p>}
          </div>
          <div className="tw"><table>
            <thead><tr><th>Date</th><th>Type</th><th className="r">Amount</th><th>UTR</th></tr></thead>
            <tbody>{(ledger ?? []).map((l: any) => <tr key={l.id}><td>{dt(l.created_at)}</td><td>{label(l.transaction_type)}</td><td className="r num">{inr(l.amount_inr)}</td><td className="mono">{l.bank_utr_reference || "—"}</td></tr>)}
              {!ledger?.length && <tr><td colSpan={4} className="empty">No transactions yet.</td></tr>}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
