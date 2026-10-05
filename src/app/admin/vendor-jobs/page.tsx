import Gate from "@/components/Gate";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { inr, dt, label, JOB_STATUSES } from "@/lib/format";
import Pill from "@/components/Pill";
import { updateJobStatus } from "../actions";

export default async function VendorJobs({ searchParams }: { searchParams: { status?: string; late?: string } }) {
  const { supabase, perms } = await requireAdmin();
  let q = supabase.from("vendor_jobs")
    .select("*, vendors(company_name), orders(id, order_number)")
    .order("sla_deadline_at", { ascending: true }).limit(200);
  if (searchParams.status) q = q.eq("status", searchParams.status);
  if (searchParams.late) q = q.not("status", "in", "(handed_over,rejected)").lt("sla_deadline_at", new Date().toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const now = Date.now();

  return (
    <Gate perms={perms} m="production">
      <div className="head"><div><h1>Vendor jobs</h1><p className="muted">Sorted by SLA deadline. Late penalties per the vendor agreement: 1–12 h 5%, 12–24 h 15%, over 48 h cancel and re-route.</p></div></div>
      <div className="filters">
        <Link href="/admin/vendor-jobs" className={!searchParams.status && !searchParams.late ? "on" : ""}>All</Link>
        <Link href="/admin/vendor-jobs?late=1" className={searchParams.late ? "on" : ""}>Past SLA</Link>
        {JOB_STATUSES.map((s) => <Link key={s} href={`/admin/vendor-jobs?status=${s}`} className={searchParams.status === s ? "on" : ""}>{label(s)}</Link>)}
      </div>
      <div className="tw"><table>
        <thead><tr><th>Job</th><th>Order</th><th>Vendor</th><th>Status</th><th>SLA</th><th className="r">Payout</th><th>QC weight</th><th>Update</th></tr></thead>
        <tbody>{(data ?? []).map((j: any) => {
          const open = !["handed_over", "rejected"].includes(j.status);
          const lateH = open ? (now - new Date(j.sla_deadline_at).getTime()) / 3600_000 : 0;
          const suggest = lateH > 48 ? 100 : lateH > 12 ? 15 : lateH > 0 ? 5 : 0;
          return (
            <tr key={j.id}>
              <td className="mono">{j.job_number}{j.is_warranty_reprint && <div><span className="pill bad">Reprint</span></div>}</td>
              <td><Link className="mono" href={`/admin/orders/${j.orders?.id}`}>{j.orders?.order_number}</Link></td>
              <td>{j.vendors?.company_name}</td>
              <td><Pill s={j.status} /></td>
              <td>{dt(j.sla_deadline_at)}{lateH > 0 && <div><span className="pill bad">{lateH.toFixed(0)} h late · {suggest}% penalty</span></div>}</td>
              <td className="r num">{inr(j.vendor_payout_amount)}{Number(j.sla_penalty_amount) > 0 && <div className="muted">− {inr(j.sla_penalty_amount)}</div>}</td>
              <td className="mono">{j.actual_weighed_grams ? `${j.actual_weighed_grams} g` : "—"}</td>
              <td>
                <form action={updateJobStatus} className="inline">
                  <input type="hidden" name="id" value={j.id} />
                  <select name="status" defaultValue={j.status}>{JOB_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
                  <input name="sla_penalty_amount" type="number" step="0.01" min="0" placeholder="Penalty ₹" defaultValue={Number(j.sla_penalty_amount) > 0 ? j.sla_penalty_amount : suggest ? ((Number(j.vendor_payout_amount) * suggest) / 100).toFixed(2) : ""} style={{ width: 110 }} />
                  <button className="btn sm">Save</button>
                </form>
              </td>
            </tr>);
        })}
          {!data?.length && <tr><td colSpan={8} className="empty">No jobs here.</td></tr>}
        </tbody>
      </table></div>
    </Gate>
  );
}
