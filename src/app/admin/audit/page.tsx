import { requirePermPage } from "@/lib/auth";
import { dt, label } from "@/lib/format";

export default async function Audit() {
  const { supabase } = await requirePermPage("audit");
  const { data, error } = await supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return (
    <>
      <div className="head"><div><h1>Audit log</h1><p className="muted">Every change made from this panel, newest first.</p></div></div>
      <div className="tw"><table>
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
        <tbody>{(data ?? []).map((a) => (
          <tr key={a.id}>
            <td>{dt(a.created_at)}</td><td>{a.admin_email}</td><td>{label(a.action)}</td>
            <td className="mono">{a.entity}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ""}</td>
            <td className="mono muted" style={{ maxWidth: 420, overflowWrap: "anywhere", fontSize: ".75rem" }}>{JSON.stringify(a.details)}</td>
          </tr>))}
          {!data?.length && <tr><td colSpan={5} className="empty">No changes recorded yet.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
