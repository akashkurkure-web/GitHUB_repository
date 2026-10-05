import { serviceClient } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/api";

/** The signed-in owner, or anyone holding the order's private link token, may act on it. */
export async function orderForBuyer(orderId: string, token?: string | null) {
  const sb = serviceClient();
  const { data: o } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return null;
  if (token && o.share_token && token.length >= 12 && token === o.share_token) return o;
  const { user } = await currentUser();
  return user && o.user_id === user.id ? o : null;
}
