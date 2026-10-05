import { serviceClient } from "@/lib/supabase/admin";
import { guestId } from "@/lib/api";

/** Moves any files uploaded before sign-in onto the signed-in account. */
export async function claimGuestFiles(userId: string) {
  const g = guestId();
  if (!g) return;
  await serviceClient().from("cad_assets").update({ user_id: userId, guest_session_id: null }).eq("guest_session_id", g).is("user_id", null);
}
