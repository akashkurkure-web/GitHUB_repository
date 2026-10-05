import { serviceClient } from "@/lib/supabase/admin";

export type Stage =
  | "LEAD_WELCOME" | "LEAD_ABANDONED_QUOTE" | "B2B_PROFORMA_SENT" | "ORDER_PAID" | "PRINTING_STARTED"
  | "QC_PASSED_PACKED" | "ORDER_SHIPPED" | "OUT_FOR_DELIVERY" | "ORDER_DELIVERED" | "REFUND_ISSUED" | "VENDOR_NEW_JOB_ALERT";

function e164(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  return d;
}

/**
 * Sends a WhatsApp template through the Meta Cloud API when WHATSAPP_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are set. Template name = stage code in lower case
 * (create and get them approved in Meta Business Manager). Never throws.
 */
export async function notify(stage: Stage, to: { phone?: string | null; user_id?: string | null; order_id?: string | null; cad_asset_id?: string | null }, params: string[] = []) {
  try {
    if (!to.phone) return;
    const sb = serviceClient();
    const row = { user_id: to.user_id ?? null, order_id: to.order_id ?? null, cad_asset_id: to.cad_asset_id ?? null, recipient_phone: to.phone, stage_code: stage };
    const { data: log, error } = await sb.from("whatsapp_notification_logs").insert(row).select("id").single();
    if (error) return; // duplicate stage for this order: already sent
    const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      await sb.from("whatsapp_notification_logs").update({ delivery_status: "failed", error_message: "WhatsApp not configured" }).eq("id", log.id);
      return;
    }
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: e164(to.phone),
        type: "template",
        template: {
          name: stage.toLowerCase(),
          language: { code: "en" },
          components: params.length ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] : [],
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    await sb.from("whatsapp_notification_logs").update(
      res.ok ? { delivery_status: "sent", meta_message_id: j?.messages?.[0]?.id ?? null } : { delivery_status: "failed", error_message: j?.error?.message ?? `HTTP ${res.status}` }
    ).eq("id", log.id);
  } catch {
    /* notifications must never break an order */
  }
}
