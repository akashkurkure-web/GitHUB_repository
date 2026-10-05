import Gate from "@/components/Gate";
import { requirePermPage } from "@/lib/auth";
import { inr, d } from "@/lib/format";
import Pill from "@/components/Pill";
import { createSettlement, markSettlementPaid, releaseSettlementGst } from "../actions";

export default async function Payouts() {
  const { supabase, perms } = await requirePermPage("finance");
  const [{ data: vendors }, { data: rows }] = await Promise.all([
    supabase.from("vendors").select("id, company_name").order("company_name"),
    supabase.from("vendor_payout_settlements").select("*, vendors(company_name)").order("created_at", { ascending: false }).limit(200),
  ]);
  const today = new Date(Date.now() + 5.5 * 3600_000);
  const end = new Date(today); end.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7) - 1);
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return (
    <Gate perms={perms} m="finance">
      <div className="head"><div><h1>Vendor payouts</h1><p className="muted">Weekly base payout (less SLA penalties) by NEFT. GST is held until it appears in GSTR-2B, then released.</p></div></div>
      <form action={createSettlement} className="card">
        <h2>Create a settlement</h2>
        <div className="form">
          <label className="f">Vendor<select name="vendor_id" required defaultValue="">{<option value="" disabled>Choose…</option>}{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}</select></label>
          <label className="f">From<input type="date" name="start" defaultValue={iso(start)} required /></label>
          <label className="f">To<input type="date" name="end" defaultValue={iso(end)} required /></label>
          <button className="btn">Calculate</button>
        </div>
      </form>
      <div className="tw"><table>
        <thead><tr><th>Settlement</th><th>Vendor</th><th>Period</th><th className="r">Jobs</th><th className="r">Net payable</th><th className="r">GST held</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{(rows ?? []).map((r: any) => (
          <tr key={r.id}>
            <td className="mono">{r.settlement_number}</td><td>{r.vendors?.company_name}</td><td>{d(r.period_start)} – {d(r.period_end)}</td>
            <td className="r num">{r.total_jobs_count}</td><td className="r num">{inr(r.net_transferred_amount)}<div className="muted">gross {inr(r.gross_base_amount)} − {inr(r.sla_penalty_deductions)}</div></td>
            <td className="r num">{inr(r.gst_itc_held_until_gstr2b)}</td><td><Pill s={r.status} />{r.bank_utr_number && <div className="mono muted">{r.bank_utr_number}</div>}</td>
            <td>
              {r.status !== "paid" && <form action={markSettlementPaid} className="inline"><input type="hidden" name="id" value={r.id} /><input name="utr" placeholder="UTR" style={{ width: 120 }} required /><button className="btn sm">Mark paid</button></form>}
              {r.status === "paid" && Number(r.gst_itc_held_until_gstr2b) > 0 && !r.is_gstr2b_verified_and_released && <form action={releaseSettlementGst}><input type="hidden" name="id" value={r.id} /><button className="btn sm ghost">GST in 2B → release</button></form>}
              {r.is_gstr2b_verified_and_released && <span className="pill ok">GST released</span>}
            </td>
          </tr>))}
          {!rows?.length && <tr><td colSpan={8} className="empty">No settlements yet.</td></tr>}</tbody>
      </table></div>
    </Gate>
  );
}
