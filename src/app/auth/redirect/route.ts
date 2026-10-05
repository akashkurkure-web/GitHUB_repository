import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";
import { claimGuestFiles } from "@/lib/checkout-server";
import { claimGuestOrders } from "@/lib/orders";

/** After any sign-in: claim guest uploads, apply referral, send each role home. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next");
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const { data: p } = await sb.from("profiles").select("role, referred_by_user_id, created_at").eq("id", user.id).single();

  try {
    await claimGuestFiles(user.id);
    if (user.email_confirmed_at && p?.role === "customer") await claimGuestOrders(serviceClient() as any, user.id, user.email);
    const ref = cookies().get("l27_ref")?.value;
    const isNew = p && Date.now() - new Date(p.created_at).getTime() < 7 * 24 * 3600_000;
    if (ref && p && !p.referred_by_user_id && isNew && p.role === "customer") {
      const svc = serviceClient();
      const { data: referrer } = await svc.from("profiles").select("id").eq("referral_code", ref).maybeSingle();
      if (referrer && referrer.id !== user.id) {
        await svc.from("profiles").update({ referred_by_user_id: referrer.id }).eq("id", user.id);
        const { data: st } = await svc.from("portal_settings").select("referral_friend_inr, referral_reward_inr").eq("id", 1).maybeSingle();
        await svc.from("referral_rewards_ledger").insert({ referrer_user_id: referrer.id, referred_user_id: user.id, friend_discount_inr: st?.referral_friend_inr ?? 200, referrer_reward_inr: st?.referral_reward_inr ?? 200 });
      }
    }
    await serviceClient().from("user_activity_logs").insert({ user_id: user.id, email: user.email, auth_provider: user.app_metadata?.provider ?? "email", event_type: "user_login" });
  } catch { /* never block sign-in */ }

  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const home = p?.role === "admin" ? "/admin" : p?.role === "vendor" ? "/vendor" : "/account";
  const res = NextResponse.redirect(`${origin}${safeNext && !(safeNext.startsWith("/admin") && p?.role !== "admin") ? safeNext : home}`);
  res.cookies.delete("l27_ref");
  return res;
}
