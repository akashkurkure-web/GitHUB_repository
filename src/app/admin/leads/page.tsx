import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { inr, dt } from "@/lib/format";

const STAGES = ["HOT_LEAD", "WARM_LEAD_UPLOADED_CAD", "REGISTERED_BROWSER"];
export default async function Leads({ searchParams }: { searchParams: { stage?: string } }) {
  const { supabase } = await requireAdmin();
  let q = supabase.from("crm_leads_and_prospects_view").select("*").order("unpaid_pipeline_value_inr", { ascending: false }).limit(300);
  if (searchParams.stage) q = q.eq("lead_stage", searchParams.stage);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const tone: Record<string, string> = { HOT_LEAD: "bad", WARM_LEAD_UPLOADED_CAD: "warn", REGISTERED_BROWSER: "info" };
  return (
    <>
      <div className="head"><div><h1>Leads</h1><p className="muted">Hot = has a GSTIN or ₹2,000+ in unpaid quotes. Warm = uploaded a CAD file but hasn't paid.</p></div></div>
      <div className="filters">
        <Link href="/admin/leads" className={!searchParams.stage ? "on" : ""}>All</Link>
        {STAGES.map((s) => <Link key={s} href={`/admin/leads?stage=${s}`} className={searchParams.stage === s ? "on" : ""}>{s.replace(/_/g, " ").toLowerCase()}</Link>)}
      </div>
      <div className="tw"><table>
        <thead><tr><th>Stage</th><th>Name</th><th>Contact</th><th>Company / GSTIN</th><th className="r">CAD files</th><th className="r">Unpaid pipeline</th><th className="r">Lifetime paid</th><th>Last active</th></tr></thead>
        <tbody>{(data ?? []).map((l: any) => (
          <tr key={l.user_id}>
            <td><span className={`pill ${tone[l.lead_stage]}`}>{l.lead_stage.replace(/_/g, " ")}</span></td>
            <td>{l.full_name || "—"}</td>
            <td>{l.email}<div className="muted">{l.phone_number}</div></td>
            <td>{l.company_name || "—"}<div className="muted mono">{l.gstin}</div></td>
            <td className="r num">{l.uploaded_cad_files_count}</td>
            <td className="r num">{inr(l.unpaid_pipeline_value_inr)}</td>
            <td className="r num">{inr(l.lifetime_paid_value_inr)}</td>
            <td>{dt(l.last_active_at)}</td>
          </tr>))}
          {!data?.length && <tr><td colSpan={8} className="empty">No leads in this stage.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
