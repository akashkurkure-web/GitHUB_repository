import { serviceClient } from "@/lib/supabase/admin";
import { currentUser, fail, guestId, handle, json } from "@/lib/api";
import { computeOrder } from "@/lib/orders";
import { claimGuestFiles } from "@/lib/checkout-server";

export async function POST(req: Request) {
  try {
    const { user } = await currentUser();
    const gid = guestId();
    if (!user && !gid) return fail("Your session expired. Refresh the page.", 401);
    if (user) await claimGuestFiles(user.id);
    const input = await req.json();
    const email = user ? user.email! : String(input.guest?.email || "preview@guest.invalid");
    const c = await computeOrder(serviceClient(), user?.id ?? null, email, { ...input, payment: input.payment || "online" }, user ? null : gid);
    return json(c.summary);
  } catch (e) {
    return handle(e);
  }
}
