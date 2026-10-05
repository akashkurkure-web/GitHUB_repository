import { serviceClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { markOrderPaid } from "@/lib/orders";

/**
 * Razorpay → Settings → Webhooks: URL https://yourdomain/api/webhooks/razorpay,
 * events payment.captured and order.paid, secret = RAZORPAY_WEBHOOK_SECRET.
 * Confirms payments even if the customer closed the browser.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";
  if (!verifyWebhookSignature(raw, sig)) return new Response("bad signature", { status: 401 });
  try {
    const evt = JSON.parse(raw);
    const pay = evt?.payload?.payment?.entity;
    if (pay && (evt.event === "payment.captured" || evt.event === "order.paid") && pay.order_id) {
      const sb = serviceClient();
      const { data: o } = await sb.from("orders").select("id, total_amount, wallet_applied_inr").eq("razorpay_order_id", pay.order_id).maybeSingle();
      const expected = o ? Math.round((Number(o.total_amount) - Number(o.wallet_applied_inr)) * 100) : -1;
      if (o && pay.amount === expected) await markOrderPaid(sb, o.id, { provider: "razorpay", method: pay.method, payment_id: pay.id });
    }
  } catch (e) {
    console.error("razorpay webhook", e);
  }
  return new Response("ok");
}
