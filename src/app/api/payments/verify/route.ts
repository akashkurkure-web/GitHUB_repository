import { serviceClient } from "@/lib/supabase/admin";
import { fail, handle, json } from "@/lib/api";
import { fetchPayment, verifyPaymentSignature } from "@/lib/razorpay";
import { markOrderPaid } from "@/lib/orders";
import { orderForBuyer } from "@/lib/order-access";

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const o = await orderForBuyer(b.order_id, b.token);
    if (!o) return fail("Order not found.", 404);
    if (!b.razorpay_order_id || b.razorpay_order_id !== o.razorpay_order_id) return fail("Payment doesn't match this order.");
    if (!verifyPaymentSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) return fail("Payment signature check failed. If money was taken, it will be confirmed automatically within a few minutes.");
    let method: string | null = null;
    try { method = (await fetchPayment(b.razorpay_payment_id)).method; } catch { /* optional */ }
    await markOrderPaid(serviceClient(), o.id, { provider: "razorpay", method, payment_id: b.razorpay_payment_id });
    return json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
