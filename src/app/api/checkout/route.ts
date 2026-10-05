import { serviceClient } from "@/lib/supabase/admin";
import { currentUser, fail, guestId, handle, json } from "@/lib/api";
import { computeOrder, insertOrder, markOrderPaid, UserError } from "@/lib/orders";
import { claimGuestFiles } from "@/lib/checkout-server";
import { createRazorpayOrder, razorpayEnabled } from "@/lib/razorpay";
import { notify } from "@/lib/notify";

/** Places an order for a signed-in customer or a guest. All money is recalculated here. */
export async function POST(req: Request) {
  try {
    const { user } = await currentUser();
    const gid = guestId();
    const input = await req.json();
    if (!user && !gid) return fail("Your session expired. Refresh the page and try again.", 401);
    if (user) await claimGuestFiles(user.id);
    if (!["online", "proforma", "credit"].includes(input.payment)) return fail("Choose a payment method.");
    if (!user && input.payment === "credit") return fail("Sign in to use a company credit line.");
    if (input.payment === "proforma" && !input.gstin) return fail("A proforma invoice needs your company GSTIN.");
    const sb = serviceClient();
    const { data: st } = await sb.from("portal_settings").select("online_payment_enabled, proforma_enabled").eq("id", 1).maybeSingle();
    if (input.payment === "online" && st && !st.online_payment_enabled) return fail("Online payment is switched off right now. Choose bank transfer.");
    if (input.payment === "proforma" && st && !st.proforma_enabled) return fail("Bank transfer orders are switched off right now. Pay online instead.");

    const email = user ? user.email! : String(input.guest?.email || "").trim().toLowerCase();
    const c = await computeOrder(sb, user?.id ?? null, email, input, user ? null : gid);
    if (input.payment === "credit") {
      if (!c.credit || c.credit.status !== "active") throw new UserError("Your company credit line isn't active yet.");
      if (Number(c.credit.available_credit_inr) < c.payable) throw new UserError("Not enough credit available for this order.");
    }
    if (input.payment === "online" && c.payable > 0 && !razorpayEnabled()) throw new UserError("Online payment isn't switched on yet. Choose proforma / bank transfer, or contact us.");

    const order = await insertOrder(sb, user?.id ?? null, input, c, user ? null : gid);
    let name = input.guest?.name || input.address?.name || "", phone = input.address?.phone || "";
    if (user) {
      const { data: prof } = await sb.from("profiles").select("full_name, phone_number").eq("id", user.id).single();
      name = prof?.full_name || name; phone = phone || prof?.phone_number || "";
      await sb.from("profiles").update({ default_shipping_address: input.address }).eq("id", user.id);
    }
    const next = user ? `/account/orders/${order.id}` : `/track/${order.share_token}`;

    if (c.payable <= 0) {
      await markOrderPaid(sb, order.id, { provider: "wallet", method: "wallet" });
      return json({ order_id: order.id, done: true, next });
    }
    if (input.payment === "credit") {
      const { error } = await sb.rpc("debit_credit_line", { p_account: c.credit.id, p_order: order.id, p_amount: c.payable });
      if (error) throw new UserError(error.message);
      await markOrderPaid(sb, order.id, { provider: "credit_line", method: "credit_line" });
      return json({ order_id: order.id, done: true, next });
    }
    if (input.payment === "proforma") {
      await notify("B2B_PROFORMA_SENT", { phone, user_id: user?.id ?? null, order_id: order.id }, [order.order_number]);
      return json({ order_id: order.id, done: true, proforma: true, next });
    }
    const rz = await createRazorpayOrder(c.payable, order.order_number, { order_id: order.id });
    await sb.from("orders").update({ razorpay_order_id: rz.id }).eq("id", order.id);
    return json({
      order_id: order.id, next, token: user ? null : order.share_token,
      razorpay: { key: process.env.RAZORPAY_KEY_ID, order_id: rz.id, amount: rz.amount, name, email, phone, order_number: order.order_number },
    });
  } catch (e) {
    return handle(e);
  }
}
