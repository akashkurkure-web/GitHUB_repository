import { serviceClient } from "@/lib/supabase/admin";
import { fail, handle, json } from "@/lib/api";
import { createRazorpayOrder, razorpayEnabled } from "@/lib/razorpay";
import { orderForBuyer } from "@/lib/order-access";

/** Re-opens payment for an order still waiting for payment (account or private link). */
export async function POST(req: Request) {
  try {
    const { order_id, token } = await req.json();
    const o = await orderForBuyer(order_id, token);
    if (!o) return fail("Order not found.", 404);
    if (!["pending_payment", "proforma_issued"].includes(o.status)) return fail("This order doesn't need payment.");
    if (!razorpayEnabled()) return fail("Online payment isn't switched on yet. Pay by bank transfer using the proforma.");
    const sb = serviceClient();
    const payable = Math.round((Number(o.total_amount) - Number(o.wallet_applied_inr)) * 100) / 100;
    const rz = await createRazorpayOrder(payable, o.order_number, { order_id: o.id });
    await sb.from("orders").update({ razorpay_order_id: rz.id, payment_provider: "razorpay" }).eq("id", o.id);
    const { data: p } = o.user_id ? await sb.from("profiles").select("full_name, phone_number, email").eq("id", o.user_id).single() : { data: null as any };
    return json({ order_id: o.id, razorpay: { key: process.env.RAZORPAY_KEY_ID, order_id: rz.id, amount: rz.amount, name: p?.full_name || o.guest_name || "", email: p?.email || o.guest_email || "", phone: p?.phone_number || o.shipping_address?.phone || "", order_number: o.order_number } });
  } catch (e) {
    return handle(e);
  }
}
