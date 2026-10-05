import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { DEFAULTS, SCHEMA } from "@/lib/content";
import { can } from "@/lib/permissions";
import ContentEditor from "@/components/admin/ContentEditor";
import { saveContent, resetContent } from "../../actions";

export default async function EditContent({ params }: { params: { key: string } }) {
  const { supabase, perms } = await requireAdmin();
  const section = SCHEMA.find((s) => s.key === decodeURIComponent(params.key));
  if (!section) notFound();
  const { data } = await supabase.from("site_content").select("value").eq("key", section.key).maybeSingle();
  const value = { ...(DEFAULTS[section.key] || {}), ...(data?.value || {}) };
  const editable = can(perms, "content");
  return (
    <>
      <div className="head">
        <div><Link href="/admin/content" className="muted">← Website content</Link><h1>{section.title}</h1><p className="muted">Shows on: {section.where}</p></div>
        <div className="row">
          {section.where.startsWith("/") && <a className="btn ghost" href={section.where} target="_blank">Preview page</a>}
          {data && editable && <form action={resetContent}><input type="hidden" name="key" value={section.key} /><button className="btn ghost">Reset to default</button></form>}
        </div>
      </div>
      {!editable && <div className="notice">View only. Ask an owner for the Website content permission to edit.</div>}
      <ContentEditor section={section} value={value} action={saveContent} disabled={!editable} />
    </>
  );
}
