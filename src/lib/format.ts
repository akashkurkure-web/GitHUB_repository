export const inr = (n: number | string | null | undefined) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const d = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";

export const label = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ");

export const ORDER_STATUSES = [
  "draft", "pending_payment", "proforma_issued", "paid", "in_production", "qc_passed",
  "packed", "shipped", "out_for_delivery", "delivered", "cancelled", "refunded", "rto_delivered",
] as const;

export const JOB_STATUSES = [
  "queued_for_vendor", "accepted", "printing", "post_processing",
  "qc_uploaded", "packed_ready", "handed_over", "rejected",
] as const;

export const ORDER_RANK: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s, i) => [s, i]));

/** Colour family for a status pill */
export function tone(status: string): string {
  if (["delivered", "handed_over", "paid", "qc_passed", "published", "active", "resolved", "credited_to_wallet", "paid"].includes(status)) return "ok";
  if (["cancelled", "refunded", "rejected", "rto_delivered", "flagged_for_resolution", "suspended_overdue", "urgent"].includes(status)) return "bad";
  if (["pending_payment", "proforma_issued", "pending_moderation", "pending_approval", "open", "queued_for_vendor", "high", "pending_admin_review", "processing"].includes(status)) return "warn";
  return "info";
}
