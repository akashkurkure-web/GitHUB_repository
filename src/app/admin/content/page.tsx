import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SCHEMA } from "@/lib/content";
import { dt } from "@/lib/format";
import { can } from "@/lib/permissions";

export default async function ContentHome() {
  const { supabase, perms } = await requireAdmin();
  const { data } = await supabase.from("site_content").select("key, updated_at");
  const saved = new Map((data ?? []).map((r) => [r.key, r.updated_at]));
  return (
    <>
      <div className="head"><div><h1>Website content</h1><p className="muted">Every piece of text customers see. Sections you haven&apos;t edited show the built-in default.</p></div>
        <a className="btn ghost" href="/" target="_blank">Open website</a></div>
      {!can(perms, "content") && <div className="notice">View only. Ask an owner for the Website content permission to edit.</div>}
      <div className="tw"><table>
        <thead><tr><th>Section</th><th>Where it shows</th><th>Status</th><th /></tr></thead>
        <tbody>{SCHEMA.map((s) => (
          <tr key={s.key}>
            <td><b>{s.title}</b></td><td className="muted">{s.where}</td>
            <td>{saved.has(s.key) ? <span className="pill ok">Edited {dt(saved.get(s.key))}</span> : <span className="pill info">Default</span>}</td>
            <td><Link className="btn sm" href={`/admin/content/${s.key}`}>{can(perms, "content") ? "Edit" : "View"}</Link></td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}
