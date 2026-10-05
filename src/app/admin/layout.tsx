import { requireAdmin } from "@/lib/auth";
import Sidebar, { ADMIN_NAV } from "@/components/Sidebar";
import { PRESETS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Back office", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, perms } = await requireAdmin();
  const { data: me } = await supabase.from("staff_members").select("staff_role").eq("user_id", profile.id).maybeSingle();
  const roleLabel = perms.includes("*") ? "Owner" : PRESETS[me?.staff_role ?? "custom"]?.label ?? "Staff";
  return (
    <div className="shell backoffice">
      <Sidebar email={profile.email} nav={ADMIN_NAV} badge="BACK OFFICE" root="/admin" perms={perms} roleLabel={roleLabel} />
      <main className="main">
        <div className="bo-bar"><span>Back office · staff only</span><span className="muted">Signed in as {profile.full_name || profile.email} · {roleLabel}</span></div>
        {children}
      </main>
    </div>
  );
}
