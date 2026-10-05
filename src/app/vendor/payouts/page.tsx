import { requireVendor } from "@/lib/auth";
import { inr, d } from "@/lib/format";
import Pill from "@/components/Pill";

export default async function VendorPayouts() {
  const { supabase, vendor } = await requireVendor();
  const [{ data: settlements }, { data: done }] = await Promise.all([
    supabase.from("vendor_payout_settlements").select("*").eq("vendor_id", vendor.id).order("period_end", { ascending: false }),
    supabase.from("vendor_jobs").select("vendor_payout_amount, sla_penalty_amount, updated_at").eq("vendor_id", vendor.id).eq("status", "handed_over"),
  ]);
  const lastEnd = settlements?.[0]?.period_end ? new Date(settlements[0].period_end + "T23:59:59+05:30").getTime() : 0;
  const pending = (done ?? []).filter((j) => new Date(j.updated_at).getTime() > lastEnd);
  const pendingNet = pending.reduce((n, j) => n + Number(j.vendor_payout_amount) - Number(j.sla_penalty_amount), 0);
  return (
    <>
      <div className="head"><div><h1>Payouts</h1><p className="muted">Base payout every Monday. The 18% GST part is released after it appears in our GSTR-2B (14th–18th of next month).</p></div></div>
      <div className="kpis">
        <div className="kpi" style={{ ["--c" as string]: "var(--accent)" }}><span>Jobs since last settlement</span><b>{pending.length}</b></div>
        <div className="kpi" style={{ ["--c" as string]: "var(--ok)" }}><span>Estimated next payout</span><b>{inr(pendingNet)}</b></div>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Settlement</th><th>Period</th><th className="r">Jobs</th><th className="r">Gross</th><th className="r">Penalties</th><th className="r">Paid</th><th className="r">GST held</th><th>UTR</th><th>Status</th></tr></thead>
        <tbody>{(settlements ?? []).map((s) => (
          <tr key={s.id}><td className="mono">{s.settlement_number}</td><td>{d(s.period_start)} – {d(s.period_end)}</td><td className="r num">{s.total_jobs_count}</td><td className="r num">{inr(s.gross_base_amount)}</td><td className="r num">− {inr(s.sla_penalty_deductions)}</td>
            <td className="r num">{inr(s.net_transferred_amount)}</td><td className="r num">{inr(s.gst_itc_held_until_gstr2b)}{s.is_gstr2b_verified_and_released && " ✓"}</td><td className="mono">{s.bank_utr_number || "—"}</td><td><Pill s={s.status} /></td></tr>))}
          {!settlements?.length && <tr><td colSpan={9} className="empty">No settlements yet.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
