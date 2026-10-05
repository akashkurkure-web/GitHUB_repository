"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { openRazorpay } from "@/components/account/CheckoutClient";

export default function PayNow({ orderId, label, token, back }: { orderId: string; label: string; token?: string; back?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dest = back || `/account/orders/${orderId}`;
  async function pay() {
    setBusy(true); setErr("");
    const r = await fetch("/api/checkout/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: orderId, token }) });
    const j = await r.json();
    if (!r.ok) { setBusy(false); setErr(j.error); return; }
    openRazorpay(j.razorpay, orderId, (ok, msg) => { setBusy(false); if (ok) router.replace(`${dest}?paid=1`); else setErr(msg || ""); router.refresh(); }, token);
  }
  return <div style={{ display: "grid", gap: 6 }}><button className="btn lg" disabled={busy} onClick={pay}>{busy ? "Opening payment…" : label}</button>{err && <span className="toast bad">{err}</span>}</div>;
}
