import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Module } from "@/lib/permissions";

export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return { supabase, user, profile };
}

export async function requireUser(next = "/account") {
  const s = await getSession();
  if (!s.user || !s.profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  return s as { supabase: ReturnType<typeof createClient>; user: NonNullable<typeof s.user>; profile: any };
}

type Staff = { supabase: ReturnType<typeof createClient>; user: any; profile: any; perms: string[] };

/** Back-office gate: role must be 'admin'. Returns the staff member's module permissions. */
export async function requireAdmin(): Promise<Staff> {
  const s = await getSession();
  if (!s.user) redirect("/login?next=/admin");
  if (!s.profile || s.profile.role !== "admin") redirect("/login?error=not_admin");
  const { data } = await s.supabase.rpc("my_permissions");
  return { ...(s as any), perms: (data as string[]) ?? [] };
}

/** Use in server actions: throws (shown to the staff member) when a module isn't allowed. */
export async function requirePerm(m: Module): Promise<Staff> {
  const s = await requireAdmin();
  if (!can(s.perms, m)) throw new Error(`Your access doesn't include "${m}". Ask an owner to add it under Team & access.`);
  return s;
}

/** Use in pages: sends staff without the module back to the overview. */
export async function requirePermPage(m: Module): Promise<Staff> {
  const s = await requireAdmin();
  if (!can(s.perms, m)) redirect(`/admin?denied=${m}`);
  return s;
}

export async function requireVendor() {
  const s = await getSession();
  if (!s.user) redirect("/login?next=/vendor");
  if (!s.profile || s.profile.role !== "vendor") redirect("/login?error=not_vendor");
  const { data: vid } = await s.supabase.rpc("current_vendor_id");
  if (!vid) redirect("/login?error=vendor_inactive");
  const { data: vendor } = await s.supabase.from("vendors").select("*").eq("id", vid).single();
  return { ...(s as any), vendor } as { supabase: ReturnType<typeof createClient>; user: NonNullable<typeof s.user>; profile: any; vendor: any };
}

export async function audit(action: string, entity: string, entityId: string | null, details: Record<string, unknown> = {}) {
  const { supabase, profile } = await requireAdmin();
  await supabase.from("admin_audit_log").insert({
    admin_user_id: profile.id, admin_email: profile.email, action, entity, entity_id: entityId, details,
  });
}
