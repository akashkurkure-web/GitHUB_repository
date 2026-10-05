import { getSession } from "@/lib/auth";
import { getSite } from "@/lib/site";
import CheckoutClient from "@/components/account/CheckoutClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

export default async function Checkout() {
  const { supabase, profile, user } = await getSession();
  const { settings } = await getSite();
  const { data: st } = await supabase.from("portal_settings").select("guest_checkout_enabled").eq("id", 1).maybeSingle();
  const { data: credit } = user ? await supabase.from("corporate_credit_accounts").select("status").eq("user_id", user.id).maybeSingle() : { data: null };
  return (
    <main className="wrap page">
      <h1>Checkout</h1>
      {!settings.accepting_orders && <div className="alert">{settings.paused_message}</div>}
      <CheckoutClient
        signedIn={Boolean(user)}
        guestAllowed={st?.guest_checkout_enabled ?? true}
        profile={profile ? { full_name: profile.full_name, phone: profile.phone_number, company: profile.company_name, gstin: profile.gstin, wallet: Number(profile.wallet_balance_inr), address: profile.default_shipping_address || {} } : { wallet: 0, address: {} }}
        creditActive={credit?.status === "active"}
        razorpay={Boolean(process.env.RAZORPAY_KEY_ID) && settings.online_payment_enabled}
        proforma={settings.proforma_enabled}
      />
    </main>
  );
}
