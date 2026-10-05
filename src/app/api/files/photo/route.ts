import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/api";

/** Short-lived link to a QC or claim photo, for the people allowed to see it. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("b"), path = url.searchParams.get("p") || "";
  if (!bucket || !["qc-photos", "claim-photos"].includes(bucket) || path.includes("..")) return new Response("Bad request", { status: 400 });
  const { sb, user } = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  let ok = prof?.role === "admin";
  if (!ok && bucket === "claim-photos") ok = path.startsWith(`${user.id}/`);
  if (!ok && bucket === "qc-photos" && prof?.role === "vendor") {
    const jobId = path.split("/")[0];
    const { data: job } = await sb.from("vendor_jobs").select("id").eq("id", jobId).maybeSingle(); // RLS: own jobs only
    ok = Boolean(job);
  }
  if (!ok) return new Response("Not allowed.", { status: 403 });
  const { data } = await serviceClient().storage.from(bucket).createSignedUrl(path, 120);
  if (!data) return new Response("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
