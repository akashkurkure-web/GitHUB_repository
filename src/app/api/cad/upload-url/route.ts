import { serviceClient } from "@/lib/supabase/admin";
import { currentUser, fail, guestId, handle, json } from "@/lib/api";

const MAX = 50 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const { fileName, size } = await req.json();
    if (typeof fileName !== "string" || !/\.stl$/i.test(fileName)) return fail("Only .stl files can be quoted instantly.");
    if (typeof size !== "number" || size <= 84 || size > MAX) return fail("The file must be under 50 MB.");
    const { user } = await currentUser();
    const owner = user ? `u/${user.id}` : guestId() ? `g/${guestId()}` : null;
    if (!owner) return fail("Your session expired. Refresh the page and try again.", 401);

    const sb = serviceClient();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const q = sb.from("cad_assets").select("id", { count: "exact", head: true }).gte("created_at", since);
    const { count } = user ? await q.eq("user_id", user.id) : await q.eq("guest_session_id", guestId()!);
    if ((count ?? 0) >= 40) return fail("Upload limit reached for this hour. Try again later or contact us for bulk quotes.", 429);

    const path = `${owner}/${crypto.randomUUID()}.stl`;
    const { data, error } = await sb.storage.from("cad-files").createSignedUploadUrl(path);
    if (error) throw error;
    return json({ path, token: data.token });
  } catch (e) {
    return handle(e);
  }
}
