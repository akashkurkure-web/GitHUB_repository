import crypto from "crypto";
import { serviceClient } from "@/lib/supabase/admin";
import { currentUser, fail, guestId, handle, json } from "@/lib/api";
import { analyse, parseSTL } from "@/lib/stl";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { path, fileName, unitScale } = await req.json();
    const { user } = await currentUser();
    const g = guestId();
    const owner = user ? `u/${user.id}/` : g ? `g/${g}/` : null;
    if (!owner || typeof path !== "string" || !path.startsWith(owner) || !/^[ug]\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.stl$/i.test(path)) return fail("Upload not recognised. Try again.", 403);
    const scale = unitScale === 25.4 ? 25.4 : 1;

    const sb = serviceClient();
    const { data: blob, error } = await sb.storage.from("cad-files").download(path);
    if (error || !blob) return fail("We couldn't read the uploaded file. Try uploading again.");
    const buf = await blob.arrayBuffer();

    let m;
    try {
      m = analyse(parseSTL(buf), scale);
    } catch (e: any) {
      return fail(e?.message || "This doesn't look like a valid STL file.");
    }
    if (m.volume_cm3 <= 0.001) return fail("The model has no volume. Check that it's a closed solid.");
    const hash = crypto.createHash("sha256").update(Buffer.from(buf)).digest("hex");
    const warnings: string[] = [];
    if (m.watertight === false) warnings.push(`${m.open_edges} open edges`);
    if (Math.min(...m.bbox_mm) < 1) warnings.push("dimension under 1 mm");

    const { data: row, error: e2 } = await sb.from("cad_assets").insert({
      user_id: user?.id ?? null,
      guest_session_id: user ? null : g,
      file_name: String(fileName || "part.stl").slice(0, 200),
      storage_path: path,
      file_hash_sha256: hash,
      volume_cm3: Number(m.volume_cm3.toFixed(3)),
      surface_area_cm2: Number(m.surface_area_cm2.toFixed(2)),
      bounding_box_x_mm: Number(m.bbox_mm[0].toFixed(2)),
      bounding_box_y_mm: Number(m.bbox_mm[1].toFixed(2)),
      bounding_box_z_mm: Number(m.bbox_mm[2].toFixed(2)),
      is_watertight: m.watertight !== false,
      validation_status: m.watertight === false ? "NEEDS_REPAIR" : "VALID",
      analysis_warnings: warnings,
    }).select("id, file_name, volume_cm3, surface_area_cm2, bounding_box_x_mm, bounding_box_y_mm, bounding_box_z_mm, is_watertight").single();
    if (e2) throw e2;
    if (user) await sb.from("user_activity_logs").insert({ user_id: user.id, email: user.email, event_type: "cad_file_uploaded", metadata: { cad_asset_id: row.id } });
    return json({ asset: row, metrics: m });
  } catch (e) {
    return handle(e);
  }
}
