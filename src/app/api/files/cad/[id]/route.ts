import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/api";

/** Logged, short-lived download of a CAD file for admins and the assigned vendor. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { sb, user } = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (!prof || !["admin", "vendor"].includes(prof.role)) return new Response("Not allowed.", { status: 403 });
  // RLS decides: admins see all, vendors only files on their own jobs
  const { data: asset } = await sb.from("cad_assets").select("id, storage_path, file_name").eq("id", params.id).maybeSingle();
  if (!asset) return new Response("Not found or not yours.", { status: 404 });
  const svc = serviceClient();
  await svc.from("cad_download_audit_logs").insert({
    cad_asset_id: asset.id, downloaded_by_user_id: user.id, downloader_role: prof.role,
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null, user_agent: req.headers.get("user-agent"),
  });
  const { data, error } = await svc.storage.from("cad-files").createSignedUrl(asset.storage_path, 60, { download: asset.file_name });
  if (error || !data) return new Response("File unavailable.", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
