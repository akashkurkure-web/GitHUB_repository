import { cache } from "react";
import { publicClient } from "@/lib/supabase/public";
import { DEFAULTS } from "@/lib/content";

export type PortalSettings = {
  shipping_inr: number; express_inr: number; express_enabled: boolean; express_max_print_hours: number;
  referral_friend_inr: number; referral_reward_inr: number; claim_window_hours: number;
  online_payment_enabled: boolean; proforma_enabled: boolean; accepting_orders: boolean; paused_message: string;
};
export const DEFAULT_SETTINGS: PortalSettings = {
  shipping_inr: 90, express_inr: 249, express_enabled: true, express_max_print_hours: 6, referral_friend_inr: 200, referral_reward_inr: 200,
  claim_window_hours: 48, online_payment_enabled: true, proforma_enabled: true, accepting_orders: true, paused_message: "We are not taking new orders right now.",
};

export function normalizeSettings(row: any): PortalSettings {
  const r = { ...DEFAULT_SETTINGS, ...(row || {}) };
  for (const k of ["shipping_inr", "express_inr", "express_max_print_hours", "referral_friend_inr", "referral_reward_inr", "claim_window_hours"] as const) (r as any)[k] = Number(r[k]);
  return r;
}

/** Everything the public site needs, read once per request. Falls back to defaults if the database is unreachable. */
export const getSite = cache(async () => {
  const sb = publicClient();
  const [c, s, b] = await Promise.all([
    sb.from("site_content").select("key, value"),
    sb.from("portal_settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("portal_business_identity").select("*").eq("id", 1).maybeSingle(),
  ]);
  const content: Record<string, any> = {};
  for (const k of Object.keys(DEFAULTS)) content[k] = { ...DEFAULTS[k] };
  for (const row of c.data ?? []) content[row.key] = { ...(DEFAULTS[row.key] || {}), ...(row.value || {}) };
  return { content, settings: normalizeSettings(s.data), biz: b.data || {} };
});

/** Fills {brand}, {gstin}… placeholders in editable text. */
export function fill(text: string, biz: any) {
  const map: Record<string, string> = {
    brand: biz?.brand_name ?? "", legal_name: biz?.legal_entity_name ?? "", gstin: biz?.gstin ?? "", email: biz?.support_email ?? "",
    grievance_officer: biz?.grievance_officer_name ?? "", address: [biz?.registered_address_line1, biz?.city, biz?.state, biz?.pincode].filter(Boolean).join(", "),
  };
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}
