import crypto from "crypto";

const KEY_ID = () => process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = () => process.env.RAZORPAY_KEY_SECRET || "";
export const razorpayEnabled = () => Boolean(KEY_ID() && KEY_SECRET());

function auth() {
  return "Basic " + Buffer.from(`${KEY_ID()}:${KEY_SECRET()}`).toString("base64");
}

export async function createRazorpayOrder(amountInr: number, receipt: string, notes: Record<string, string>) {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amountInr * 100), currency: "INR", receipt: receipt.slice(0, 40), notes }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.description || "Razorpay could not create the payment.");
  return j as { id: string; amount: number; currency: string };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const expected = crypto.createHmac("sha256", KEY_SECRET()).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

export async function fetchPayment(paymentId: string) {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, { headers: { Authorization: auth() } });
  if (!res.ok) throw new Error("Could not read the payment from Razorpay.");
  return (await res.json()) as { id: string; order_id: string; status: string; method: string; amount: number };
}

export async function refundPayment(paymentId: string, amountInr: number) {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amountInr * 100), speed: "normal" }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.description || "Razorpay refund failed.");
  return j as { id: string };
}
