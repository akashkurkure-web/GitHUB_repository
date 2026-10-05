import Link from "next/link";
import { requireVendor } from "@/lib/auth";
import { inr, dt, label } from "@/lib/format";
import Pill from "@/components/Pill";
import Flash from "@/components/account/Flash";

export default async function VendorHome({ searchParams }: { searchParams: any }) {
  const { supabase, vendor } = await requireVendor();
  const { data: jobs } = await supabase.from("vendor_jobs")
    .select("id, job_number, status, sla_deadline_at, vendor_payout_amount, sla_penalty_amount, is_warranty_reprint, orders(order_number, is_mmr_same_day_express)")
    .eq("vendor_id", vendor.id).order("sla_deadline_at", { ascending: true }).limit(200);
  const now = Date.now();
  const groups: [string, string[], string][] = [
    ["New jobs — accept within 4 working hours", ["queued_for_vendor"], "var(--warn)"],
    ["In progress", ["accepted", "printing", "post_processing", "qc_uploaded", "packed_ready"], "var(--accent)"],
    ["Completed", ["handed_over"], "var(--ok)"],
  ];
  const open = (jobs ?? []).filter((j) => !["handed_over", "rejected"].includes(j.status));
  const late = open.filter((j) => new Date(j.sla_deadline_at).getTime() < now).length;
  return (
    <>
      <Flash sp={searchParams} />
      <div className="head"><div><h1>Job queue</h1><p className="muted">{vendor.company_name} · pickup {vendor.shiprocket_pickup_location}</p></div></div>
      <div className="kpis">
        <div className="kpi" style={{ ["--c" as string]: "var(--warn)" }}><span>New</span><b>{(jobs ?? []).filter((j) => j.status === "queued_for_vendor").length}</b></div>
        <div className="kpi" style={{ ["--c" as string]: "var(--accent)" }}><span>In progress</span><b>{open.length}</b></div>
        <div className="kpi" style={{ ["--c" as string]: "var(--bad)" }}><span>Past SLA</span><b>{late}</b></div>
      </div>
      {groups.map(([title, statuses, c]) => {
        const list = (jobs ?? []).filter((j) => statuses.includes(j.status));
        return (
          <div key={title} className="card" style={{ borderTop: `4px solid ${c}` }}>
            <h2>{title}</h2>
            <div className="tw"><table>
              <thead><tr><th>Job</th><th>Order</th><th>Status</th><th>Deadline</th><th className="r">Payout</th></tr></thead>
              <tbody>{list.map((j: any) => {
                const lateH = (now - new Date(j.sla_deadline_at).getTime()) / 3600_000;
                return (
                  <tr key={j.id}>
                    <td><Link className="mono" href={`/vendor/jobs/${j.id}`}>{j.job_number}</Link>{j.is_warranty_reprint && <span className="pill bad" style={{ marginLeft: 6 }}>Reprint</span>}{j.orders?.is_mmr_same_day_express && <span className="pill warn" style={{ marginLeft: 6 }}>Express</span>}</td>
                    <td className="mono">{j.orders?.order_number}</td>
                    <td><Pill s={j.status} /></td>
                    <td>{dt(j.sla_deadline_at)}{j.status !== "handed_over" && lateH > 0 && <div><span className="pill bad">{lateH.toFixed(0)} h late</span></div>}</td>
                    <td className="r num">{inr(Number(j.vendor_payout_amount) - Number(j.sla_penalty_amount))}</td>
                  </tr>);
              })}
                {!list.length && <tr><td colSpan={5} className="empty">Nothing here.</td></tr>}</tbody>
            </table></div>
          </div>
        );
      })}
    </>
  );
}
