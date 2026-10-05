"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { analyse, parseSTL } from "@/lib/stl";
import { slugify } from "@/lib/media";
import { requireAdmin, requirePerm, audit } from "@/lib/auth";
import { ORDER_RANK, ORDER_STATUSES, JOB_STATUSES } from "@/lib/format";
import { serviceClient } from "@/lib/supabase/admin";
import { cancelOrder, markOrderPaid, onDelivered, UserError } from "@/lib/orders";
import { notify, type Stage } from "@/lib/notify";
import { sanitize } from "@/lib/content";
import { MODULE_KEYS, PRESETS } from "@/lib/permissions";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => Number(f.get(k) ?? 0);
const nn = (f: FormData, k: string) => (s(f, k) === "" ? null : Number(f.get(k)));
function fail(e: { message: string } | null) {
  if (e) throw new Error(e.message);
}

/* ---------- Orders ---------- */
export async function updateOrderStatus(f: FormData) {
  await requirePerm("orders");
  const id = s(f, "id"), status = s(f, "status");
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) throw new Error("Unknown order status.");
  if (["cancelled", "refunded"].includes(status)) throw new Error("Use 'Cancel order' below so refunds and credit notes are handled.");
  const svc = serviceClient();
  const { data: o } = await svc.from("orders").select("id, user_id, order_number, status, tracking_number, shipping_address").eq("id", id).single();
  if (!o) throw new Error("Order not found.");
  if (status === "paid" && ["draft", "pending_payment", "proforma_issued"].includes(o.status)) {
    await markOrderPaid(svc, id, { provider: "neft", method: "bank_transfer", utr: s(f, "utr") || null });
  } else {
    const { error } = await svc.from("orders").update({ status, status_rank: ORDER_RANK[status] }).eq("id", id);
    fail(error);
  }
  if (status === "delivered") await onDelivered(svc, id);
  const stage: Record<string, Stage> = { shipped: "ORDER_SHIPPED", out_for_delivery: "OUT_FOR_DELIVERY", delivered: "ORDER_DELIVERED" };
  if (stage[status]) {
    const { data: p } = o.user_id ? await svc.from("profiles").select("phone_number").eq("id", o.user_id).single() : { data: null as any };
    await notify(stage[status], { phone: p?.phone_number || o.shipping_address?.phone, user_id: o.user_id, order_id: id }, [o.order_number, o.tracking_number || ""].filter(Boolean));
  }
  await audit("order_status", "orders", id, { status, utr: s(f, "utr") || undefined });
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin");
}

export async function adminCancelOrder(f: FormData) {
  await requirePerm("orders");
  const id = s(f, "id"), to = s(f, "refund_to") === "wallet" ? "wallet" : "source";
  try {
    const result = await cancelOrder(serviceClient(), id, to);
    await audit("cancel_order", "orders", id, { result, refund_to: to });
  } catch (e: any) {
    throw new Error(e instanceof UserError ? e.message : e?.message || "Cancellation failed.");
  }
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/orders");
}

export async function updateShipping(f: FormData) {
  const { supabase } = await requirePerm("orders");
  const id = s(f, "id");
  const { error } = await supabase.from("orders").update({
    courier_partner: s(f, "courier_partner") || null,
    tracking_number: s(f, "tracking_number") || null,
    is_mmr_same_day_express: f.get("express") === "on",
  }).eq("id", id);
  fail(error);
  await audit("order_shipping", "orders", id, { tracking: s(f, "tracking_number") });
  revalidatePath(`/admin/orders/${id}`);
}

export async function assignVendor(f: FormData) {
  const { supabase } = await requirePerm("production");
  const order_id = s(f, "order_id"), vendor_id = s(f, "vendor_id");
  const hours = n(f, "sla_hours") || 48;
  if (!vendor_id) throw new Error("Choose a vendor.");
  const { data, error } = await supabase.from("vendor_jobs").insert({
    order_id, vendor_id,
    vendor_payout_amount: n(f, "payout"),
    sla_deadline_at: new Date(Date.now() + hours * 3600_000).toISOString(),
  }).select("id, job_number").single();
  fail(error);
  const { data: v } = await supabase.from("vendors").select("phone_number").eq("id", vendor_id).single();
  await notify("VENDOR_NEW_JOB_ALERT", { phone: v?.phone_number, order_id }, [data!.job_number]);
  await audit("assign_vendor", "vendor_jobs", data!.id, { order_id, vendor_id, job: data!.job_number });
  revalidatePath(`/admin/orders/${order_id}`);
  revalidatePath("/admin/vendor-jobs");
}

/* ---------- Vendor jobs ---------- */
export async function updateJobStatus(f: FormData) {
  const { supabase } = await requirePerm("production");
  const id = s(f, "id"), status = s(f, "status");
  if (!(JOB_STATUSES as readonly string[]).includes(status)) throw new Error("Unknown job status.");
  const patch: Record<string, unknown> = { status };
  const penalty = nn(f, "sla_penalty_amount");
  if (penalty !== null) patch.sla_penalty_amount = penalty;
  const { error } = await supabase.from("vendor_jobs").update(patch).eq("id", id);
  fail(error);
  await audit("job_status", "vendor_jobs", id, patch);
  revalidatePath("/admin/vendor-jobs");
}

/* ---------- Vendors ---------- */
export async function createVendor(f: FormData) {
  const { supabase } = await requirePerm("production");
  const row = {
    company_name: s(f, "company_name"),
    email: s(f, "email").toLowerCase(),
    phone_number: s(f, "phone_number"),
    gstin: s(f, "gstin").toUpperCase() || null,
    pan_number: s(f, "pan_number").toUpperCase() || null,
    shiprocket_pickup_location: s(f, "pickup") || "Mumbai_Primary_Vendor_Hub",
    base_payout_share_percent: n(f, "share") || 45,
  };
  if (!row.company_name || !row.email || !row.phone_number) throw new Error("Company, email and phone are required.");
  const { data, error } = await supabase.from("vendors").insert(row).select("id").single();
  fail(error);
  // If this person already signed up, upgrade their role so they reach /vendor.
  await supabase.from("profiles").update({ role: "vendor" }).eq("email", row.email).neq("role", "admin");
  await audit("create_vendor", "vendors", data!.id, { company: row.company_name });
  revalidatePath("/admin/vendors");
}

export async function toggleVendor(f: FormData) {
  const { supabase } = await requirePerm("production");
  const id = s(f, "id"), active = s(f, "active") === "true";
  const { error } = await supabase.from("vendors").update({ is_active: active }).eq("id", id);
  fail(error);
  await audit(active ? "activate_vendor" : "deactivate_vendor", "vendors", id);
  revalidatePath("/admin/vendors");
}

/* ---------- Customers ---------- */
export async function setRole(f: FormData) {
  const { supabase, profile } = await requirePerm("team");
  const id = s(f, "id"), role = s(f, "role");
  if (!["customer", "vendor", "admin"].includes(role)) throw new Error("Unknown role.");
  if (id === profile.id && role !== "admin") throw new Error("You cannot remove your own admin role.");
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  fail(error);
  await audit("set_role", "profiles", id, { role });
  revalidatePath("/admin/customers");
}

export async function setB2BVerified(f: FormData) {
  const { supabase } = await requirePerm("customers");
  const id = s(f, "id"), v = s(f, "value") === "true";
  const { error } = await supabase.from("profiles").update({ is_verified_b2b: v }).eq("id", id);
  fail(error);
  await audit("verify_b2b", "profiles", id, { verified: v });
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${id}`);
}

/* ---------- Coupons ---------- */
export async function createCoupon(f: FormData) {
  const { supabase } = await requirePerm("marketing");
  const until = s(f, "valid_until");
  const row = {
    code: s(f, "code").toUpperCase().replace(/\s+/g, ""),
    description: s(f, "description"),
    discount_type: s(f, "discount_type"),
    discount_value: n(f, "discount_value"),
    min_order_subtotal_inr: n(f, "min_order") || 499,
    max_discount_cap_inr: nn(f, "cap"),
    max_total_uses: nn(f, "max_total_uses"),
    max_uses_per_user: n(f, "per_user") || 1,
    first_order_only: f.get("first_order_only") === "on",
    b2b_gstin_only: f.get("b2b_only") === "on",
    is_public_on_checkout: f.get("public") === "on",
    valid_until: until ? new Date(until + "T23:59:59+05:30").toISOString() : null,
  };
  if (!row.code || !row.description) throw new Error("Code and description are required.");
  const { data, error } = await supabase.from("promo_coupons").insert(row).select("id").single();
  fail(error);
  await audit("create_coupon", "promo_coupons", data!.id, { code: row.code });
  revalidatePath("/admin/coupons");
}

export async function toggleCoupon(f: FormData) {
  const { supabase } = await requirePerm("marketing");
  const id = s(f, "id"), active = s(f, "active") === "true";
  const { error } = await supabase.from("promo_coupons").update({ is_active: active }).eq("id", id);
  fail(error);
  await audit(active ? "enable_coupon" : "disable_coupon", "promo_coupons", id);
  revalidatePath("/admin/coupons");
}

/* ---------- Reviews ---------- */
export async function moderateReview(f: FormData) {
  const { supabase } = await requirePerm("marketing");
  const id = s(f, "id");
  const patch: Record<string, unknown> = {};
  if (s(f, "status")) patch.status = s(f, "status");
  if (f.has("reply")) patch.admin_public_reply = s(f, "reply") || null;
  const { error } = await supabase.from("product_service_reviews").update(patch).eq("id", id);
  fail(error);
  await audit("moderate_review", "product_service_reviews", id, patch);
  revalidatePath("/admin/reviews");
}

/* ---------- B2B credit ---------- */
export async function updateCredit(f: FormData) {
  const { supabase } = await requirePerm("finance");
  const id = s(f, "id");
  const patch = {
    status: s(f, "status"),
    approved_credit_limit_inr: n(f, "limit"),
    billing_cycle_days: n(f, "cycle"),
    corporate_tier_discount_percent: n(f, "discount"),
  };
  const { error } = await supabase.from("corporate_credit_accounts").update(patch).eq("id", id);
  fail(error);
  await audit("update_credit", "corporate_credit_accounts", id, patch);
  revalidatePath("/admin/credit");
}

export async function recordRepayment(f: FormData) {
  const { supabase } = await requirePerm("finance");
  const id = s(f, "id"), amount = n(f, "amount"), utr = s(f, "utr");
  if (amount <= 0 || !utr) throw new Error("Enter an amount and the bank UTR.");
  const { data: acc, error: e1 } = await supabase.from("corporate_credit_accounts").select("used_credit_balance_inr").eq("id", id).single();
  fail(e1);
  const { error: e2 } = await supabase.from("corporate_credit_ledger").insert({
    credit_account_id: id, transaction_type: "neft_repayment_credit", amount_inr: amount, bank_utr_reference: utr,
  });
  fail(e2);
  const used = Math.max(0, Number(acc!.used_credit_balance_inr) - amount);
  const { error: e3 } = await supabase.from("corporate_credit_accounts").update({ used_credit_balance_inr: used }).eq("id", id);
  fail(e3);
  await audit("credit_repayment", "corporate_credit_accounts", id, { amount, utr });
  revalidatePath("/admin/credit");
}

/* ---------- Support & warranty ---------- */
export async function updateTicket(f: FormData) {
  const { supabase } = await requirePerm("support");
  const id = s(f, "id");
  const { error } = await supabase.from("support_tickets").update({ status: s(f, "status") }).eq("id", id);
  fail(error);
  await audit("ticket_status", "support_tickets", id, { status: s(f, "status") });
  revalidatePath("/admin/support");
}

export async function updateClaim(f: FormData) {
  const { supabase } = await requirePerm("support");
  const id = s(f, "id");
  const patch: Record<string, unknown> = { status: s(f, "status"), fault_attributed_to: s(f, "fault") || null };
  if (patch.status === "reprint_dispatched" && !patch.fault_attributed_to) throw new Error("Choose who is at fault before sending a reprint.");
  const { data: claim } = await supabase.from("defect_warranty_claims").select("order_id, reprint_vendor_job_id").eq("id", id).single();
  if (patch.status === "reprint_dispatched" && claim && !claim.reprint_vendor_job_id) {
    const { data: orig } = await supabase.from("vendor_jobs").select("vendor_id, vendor_payout_amount").eq("order_id", claim.order_id).neq("status", "rejected").order("created_at").limit(1).maybeSingle();
    if (!orig) throw new Error("No original vendor job to reprint from. Assign a vendor on the order first.");
    const { data: job, error: je } = await supabase.from("vendor_jobs").insert({
      order_id: claim.order_id, vendor_id: orig.vendor_id, is_warranty_reprint: true, reprint_cost_borne_by: patch.fault_attributed_to,
      vendor_payout_amount: patch.fault_attributed_to === "vendor_fault" ? 0 : orig.vendor_payout_amount,
      sla_deadline_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    }).select("id").single();
    fail(je);
    patch.reprint_vendor_job_id = job!.id;
  }
  const { error } = await supabase.from("defect_warranty_claims").update(patch).eq("id", id);
  fail(error);
  await audit("claim_update", "defect_warranty_claims", id, patch);
  revalidatePath("/admin/support");
}

/* ---------- Pricing ---------- */
export async function updateMaterial(f: FormData) {
  const { supabase } = await requirePerm("catalog");
  const code = s(f, "code");
  const patch = {
    retail_rate_per_gram_inr: n(f, "rate"),
    machine_hour_rate_inr: n(f, "mh"),
    print_speed_grams_per_hr: n(f, "speed"),
    base_setup_fee_inr: n(f, "setup"),
    minimum_order_value_inr: n(f, "moq"),
    is_active: f.get("active") === "on",
    updated_at: new Date().toISOString(),
  };
  if (f.has("display_name")) {
    const colors = s(f, "colors").split("\n").map((l) => l.split(/[,|]/).map((x) => x.trim())).filter((r) => r[0] && /^#[0-9a-f]{6}$/i.test(r[1] || "")).map((r) => [r[0].slice(0, 30), r[1]]);
    Object.assign(patch, {
      display_name: s(f, "display_name").slice(0, 80) || code, best_for: s(f, "best_for").slice(0, 160) || null, description: s(f, "description").slice(0, 1000) || null,
      swatch_hex: /^#[0-9a-f]{6}$/i.test(s(f, "swatch")) ? s(f, "swatch") : null, colors: colors.length ? colors : null, sort_order: n(f, "sort") || 100,
    });
  }
  if (!(Number(patch.print_speed_grams_per_hr) > 0)) throw new Error("Print speed must be above 0.");
  const { error } = await supabase.from("material_pricing_catalog").update(patch).eq("material_code", code);
  fail(error);
  await audit("update_material", "material_pricing_catalog", code, patch);
  revalidatePath("/admin/pricing");
}

export async function updateTier(f: FormData) {
  const { supabase } = await requirePerm("catalog");
  const id = n(f, "id");
  const patch = { discount_percentage: n(f, "pct"), tier_badge_label: s(f, "label"), is_active: f.get("active") === "on" };
  const { error } = await supabase.from("quantity_discount_tiers").update(patch).eq("id", id);
  fail(error);
  await audit("update_tier", "quantity_discount_tiers", String(id), patch);
  revalidatePath("/admin/pricing");
}

/* ---------- Settings ---------- */
export async function saveIdentity(f: FormData) {
  const { supabase } = await requirePerm("settings");
  const keys = ["legal_entity_name", "brand_name", "gstin", "support_email", "escalation_phone", "registered_address_line1", "city", "pincode", "grievance_officer_name"];
  const patch: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, s(f, k)]));
  patch.gstin = String(patch.gstin).toUpperCase();
  patch.updated_at = new Date().toISOString();
  const { error } = await supabase.from("portal_business_identity").update(patch).eq("id", 1);
  fail(error);
  await audit("save_identity", "portal_business_identity", "1", patch);
  revalidatePath("/admin/settings");
}

export async function saveReviewReward(f: FormData) {
  const { supabase } = await requirePerm("marketing");
  const patch = {
    is_reward_enabled: f.get("enabled") === "on",
    discount_type: s(f, "discount_type"),
    discount_value: n(f, "discount_value"),
    min_order_subtotal_inr: n(f, "min_order"),
    max_discount_cap_inr: nn(f, "cap"),
    coupon_validity_days: n(f, "days"),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("review_reward_settings").update(patch).eq("id", 1);
  fail(error);
  await audit("save_review_reward", "review_reward_settings", "1", patch);
  revalidatePath("/admin/settings");
}

/* ---------- Vendor payouts ---------- */
export async function createSettlement(f: FormData) {
  const { supabase } = await requirePerm("finance");
  const vendor_id = s(f, "vendor_id"), start = s(f, "start"), end = s(f, "end");
  if (!vendor_id || !start || !end || start > end) throw new Error("Choose a vendor and a valid period.");
  const { data: v } = await supabase.from("vendors").select("gstin").eq("id", vendor_id).single();
  const { data: jobs } = await supabase.from("vendor_jobs").select("vendor_payout_amount, sla_penalty_amount")
    .eq("vendor_id", vendor_id).eq("status", "handed_over")
    .gte("updated_at", new Date(start + "T00:00:00+05:30").toISOString()).lte("updated_at", new Date(end + "T23:59:59+05:30").toISOString());
  if (!jobs?.length) throw new Error("No handed-over jobs for this vendor in that period.");
  const gross = jobs.reduce((a, j) => a + Number(j.vendor_payout_amount), 0);
  const pen = jobs.reduce((a, j) => a + Number(j.sla_penalty_amount), 0);
  const net = Math.max(0, gross - pen);
  const gst = v?.gstin ? Math.round(net * 0.18 * 100) / 100 : 0;
  const { data, error } = await supabase.from("vendor_payout_settlements").insert({
    settlement_number: `SET-${end.replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    vendor_id, period_start: start, period_end: end, total_jobs_count: jobs.length,
    gross_base_amount: gross, vendor_gst_amount: gst, sla_penalty_deductions: pen,
    net_transferred_amount: net, gst_itc_held_until_gstr2b: gst, status: "processing",
  }).select("id").single();
  fail(error);
  await audit("create_settlement", "vendor_payout_settlements", data!.id, { vendor_id, start, end, net });
  revalidatePath("/admin/payouts");
}

export async function markSettlementPaid(f: FormData) {
  const { supabase } = await requirePerm("finance");
  const id = s(f, "id"), utr = s(f, "utr");
  if (!utr) throw new Error("Enter the bank UTR.");
  const { error } = await supabase.from("vendor_payout_settlements").update({ bank_utr_number: utr, status: "paid" }).eq("id", id);
  fail(error);
  await audit("settlement_paid", "vendor_payout_settlements", id, { utr });
  revalidatePath("/admin/payouts");
}

export async function releaseSettlementGst(f: FormData) {
  const { supabase } = await requirePerm("finance");
  const id = s(f, "id");
  const { error } = await supabase.from("vendor_payout_settlements").update({ is_gstr2b_verified_and_released: true }).eq("id", id);
  fail(error);
  await audit("settlement_gst_released", "vendor_payout_settlements", id);
  revalidatePath("/admin/payouts");
}

/* ---------- Website content ---------- */
export async function saveContent(f: FormData) {
  const { supabase, profile } = await requirePerm("content");
  const key = s(f, "key");
  let raw: unknown;
  try { raw = JSON.parse(String(f.get("json") || "{}")); } catch { throw new Error("The form data was damaged. Reload and try again."); }
  const value = sanitize(key, raw);
  const { error } = await supabase.from("site_content").upsert({ key, value, updated_by: profile.id, updated_at: new Date().toISOString() });
  fail(error);
  await audit("save_content", "site_content", key);
  revalidatePath("/", "layout");
  revalidatePath(`/admin/content/${key}`);
}

export async function resetContent(f: FormData) {
  const { supabase } = await requirePerm("content");
  const key = s(f, "key");
  const { error } = await supabase.from("site_content").delete().eq("key", key);
  fail(error);
  await audit("reset_content", "site_content", key);
  revalidatePath("/", "layout");
  revalidatePath(`/admin/content/${key}`);
}

/* ---------- Team & access ---------- */
function permsFrom(f: FormData): { role: string; perms: string[] } {
  const role = s(f, "staff_role") || "custom";
  if (role !== "custom" && PRESETS[role]) return { role, perms: [...PRESETS[role].perms] };
  const perms = f.getAll("perm").map(String).filter((m) => (MODULE_KEYS as string[]).includes(m));
  if (!perms.length) throw new Error("Tick at least one module, or choose a preset.");
  return { role: "custom", perms };
}

export async function inviteStaff(f: FormData) {
  const { supabase, profile } = await requirePerm("team");
  const email = s(f, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
  const { role, perms } = permsFrom(f);
  const svc = serviceClient();
  const { data: existing } = await svc.from("profiles").select("id, role").eq("email", email).maybeSingle();
  if (existing?.role === "vendor") throw new Error("This email is a print partner account. Use a different email for staff.");
  if (existing) {
    const { error } = await supabase.from("staff_members").upsert({ user_id: existing.id, staff_role: role, permissions: perms, added_by: profile.id, updated_at: new Date().toISOString() });
    fail(error);
    await svc.from("profiles").update({ role: "admin" }).eq("id", existing.id);
  } else {
    const { error } = await supabase.from("staff_invites").upsert({ email, staff_role: role, permissions: perms, invited_by: profile.id });
    fail(error);
  }
  await audit("invite_staff", "staff", email, { role, perms, existing: Boolean(existing) });
  revalidatePath("/admin/team");
}

export async function updateStaff(f: FormData) {
  const { supabase, perms: mine } = await requirePerm("team");
  const id = s(f, "user_id");
  const { data: cur } = await supabase.from("staff_members").select("permissions").eq("user_id", id).single();
  if (cur?.permissions?.includes("*") && !mine.includes("*")) throw new Error("Only an owner can change another owner.");
  const { role, perms } = permsFrom(f);
  if (cur?.permissions?.includes("*") && !perms.includes("*")) {
    const { count } = await supabase.from("staff_members").select("user_id", { count: "exact", head: true }).contains("permissions", ["*"]);
    if ((count ?? 0) <= 1) throw new Error("Keep at least one owner.");
  }
  const { error } = await supabase.from("staff_members").update({ staff_role: role, permissions: perms, updated_at: new Date().toISOString() }).eq("user_id", id);
  fail(error);
  await audit("update_staff", "staff", id, { role, perms });
  revalidatePath("/admin/team");
}

export async function removeStaff(f: FormData) {
  const { supabase, profile, perms: mine } = await requirePerm("team");
  const id = s(f, "user_id");
  if (id === profile.id) throw new Error("You can't remove your own access.");
  const { data: cur } = await supabase.from("staff_members").select("permissions").eq("user_id", id).single();
  if (cur?.permissions?.includes("*")) {
    if (!mine.includes("*")) throw new Error("Only an owner can remove an owner.");
    const { count } = await supabase.from("staff_members").select("user_id", { count: "exact", head: true }).contains("permissions", ["*"]);
    if ((count ?? 0) <= 1) throw new Error("Keep at least one owner.");
  }
  const { error } = await supabase.from("staff_members").delete().eq("user_id", id);
  fail(error);
  await serviceClient().from("profiles").update({ role: "customer" }).eq("id", id);
  await audit("remove_staff", "staff", id);
  revalidatePath("/admin/team");
}

export async function cancelInvite(f: FormData) {
  const { supabase } = await requirePerm("team");
  const email = s(f, "email");
  const { error } = await supabase.from("staff_invites").delete().eq("email", email);
  fail(error);
  await audit("cancel_invite", "staff", email);
  revalidatePath("/admin/team");
}

/* ---------- Shop products ---------- */
const MATERIAL_CODES = ["pla", "petg", "abs", "asa", "tpu", "standard_resin", "tough_resin"];

export async function saveProduct(f: FormData) {
  const { supabase } = await requirePerm("catalog");
  const id = s(f, "id");
  const name = s(f, "name");
  if (!name) throw new Error("Give the product a name.");
  const slug = slugify(s(f, "slug") || name);
  const def = s(f, "default_material");
  if (!MATERIAL_CODES.includes(def)) throw new Error("Choose a default material.");
  const allowed = f.getAll("allowed").map(String).filter((m) => MATERIAL_CODES.includes(m));
  const row = {
    name: name.slice(0, 120), slug, category: s(f, "category").slice(0, 60) || "General",
    short_description: s(f, "short_description").slice(0, 200) || null, description: s(f, "description").slice(0, 5000) || null,
    tags: s(f, "tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20),
    default_material: def, allowed_materials: allowed.length ? Array.from(new Set([...allowed, def])) : null,
    default_color: s(f, "default_color") || null, default_infill: Math.min(100, Math.max(20, n(f, "default_infill") || 25)),
    fixed_unit_price_inr: nn(f, "fixed_unit_price_inr"), waive_setup_fee: f.get("waive_setup_fee") === "on",
    lead_time_days: Math.max(1, n(f, "lead_time_days") || 3), is_published: f.get("is_published") === "on",
    is_featured: f.get("is_featured") === "on", sort_order: n(f, "sort_order") || 100, updated_at: new Date().toISOString(),
  };
  if (row.is_published) {
    const { data: cur } = id ? await supabase.from("catalog_products").select("cad_asset_id").eq("id", id).single() : { data: null };
    if (!cur?.cad_asset_id) row.is_published = false;
  }
  const res = id
    ? await supabase.from("catalog_products").update(row).eq("id", id).select("id").single()
    : await supabase.from("catalog_products").insert(row).select("id").single();
  if (res.error) throw new Error(res.error.code === "23505" ? "Another product already uses that web address (slug)." : res.error.message);
  await audit(id ? "update_product" : "create_product", "catalog_products", res.data.id, { name, published: row.is_published });
  revalidatePath("/admin/catalog");
  revalidatePath("/shop", "layout");
  if (!id) redirect(`/admin/catalog/${res.data.id}?new=1`);
  revalidatePath(`/admin/catalog/${id}`);
}

export async function uploadProductStl(f: FormData) {
  const { supabase, profile } = await requirePerm("catalog");
  const id = s(f, "id");
  const file = f.get("stl");
  if (!(file instanceof File) || !file.size || !/\.stl$/i.test(file.name)) throw new Error("Choose an .stl file.");
  if (file.size > 4.5 * 1024 * 1024) throw new Error("Product STL must be under 4.5 MB here. Reduce the mesh, or upload it through the Instant quote page and ask a developer to link it.");
  const buf = await file.arrayBuffer();
  const m = analyse(parseSTL(buf), f.get("inches") === "on" ? 25.4 : 1);
  if (m.volume_cm3 <= 0.001) throw new Error("The model has no volume. Check it's a closed solid.");
  const svc = serviceClient();
  const path = `catalog/${crypto.randomUUID()}.stl`;
  const up = await svc.storage.from("cad-files").upload(path, buf, { contentType: "model/stl" });
  if (up.error) throw new Error(up.error.message);
  const hash = createHash("sha256").update(Buffer.from(buf)).digest("hex");
  const { data: asset, error } = await svc.from("cad_assets").insert({
    user_id: profile.id, file_name: file.name.slice(0, 200), storage_path: path, file_hash_sha256: hash,
    volume_cm3: Number(m.volume_cm3.toFixed(3)), surface_area_cm2: Number(m.surface_area_cm2.toFixed(2)),
    bounding_box_x_mm: Number(m.bbox_mm[0].toFixed(2)), bounding_box_y_mm: Number(m.bbox_mm[1].toFixed(2)), bounding_box_z_mm: Number(m.bbox_mm[2].toFixed(2)),
    is_watertight: m.watertight !== false, validation_status: m.watertight === false ? "NEEDS_REPAIR" : "VALID",
  }).select("id").single();
  fail(error);
  const { error: e2 } = await supabase.from("catalog_products").update({
    cad_asset_id: asset!.id, volume_cm3: Number(m.volume_cm3.toFixed(3)), bbox_mm: m.bbox_mm.map((x) => Number(x.toFixed(2))), updated_at: new Date().toISOString(),
  }).eq("id", id);
  fail(e2);
  await audit("product_stl", "catalog_products", id, { file: file.name });
  revalidatePath(`/admin/catalog/${id}`);
  revalidatePath("/shop", "layout");
}

export async function uploadProductImages(f: FormData) {
  const { supabase } = await requirePerm("catalog");
  const id = s(f, "id");
  const files = f.getAll("images").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) throw new Error("Choose at least one photo.");
  if (files.reduce((a, x) => a + x.size, 0) > 4.5 * 1024 * 1024) throw new Error("Photos must be under 4.5 MB in total per upload.");
  const { data: p } = await supabase.from("catalog_products").select("image_paths").eq("id", id).single();
  const svc = serviceClient(), paths: string[] = [];
  for (const file of files) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Photos must be JPG, PNG or WEBP.");
    const path = `${id}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const up = await svc.storage.from("catalog-media").upload(path, file, { contentType: file.type });
    if (up.error) throw new Error(up.error.message);
    paths.push(path);
  }
  const { error } = await supabase.from("catalog_products").update({ image_paths: [...(p?.image_paths ?? []), ...paths].slice(0, 8) }).eq("id", id);
  fail(error);
  await audit("product_images", "catalog_products", id, { added: paths.length });
  revalidatePath(`/admin/catalog/${id}`);
  revalidatePath("/shop", "layout");
}

export async function productImageAction(f: FormData) {
  const { supabase } = await requirePerm("catalog");
  const id = s(f, "id"), path = s(f, "path"), op = s(f, "op");
  const { data: p } = await supabase.from("catalog_products").select("image_paths").eq("id", id).single();
  let list: string[] = p?.image_paths ?? [];
  if (!list.includes(path)) return;
  if (op === "remove") { list = list.filter((x) => x !== path); await serviceClient().storage.from("catalog-media").remove([path]); }
  if (op === "cover") list = [path, ...list.filter((x) => x !== path)];
  const { error } = await supabase.from("catalog_products").update({ image_paths: list }).eq("id", id);
  fail(error);
  revalidatePath(`/admin/catalog/${id}`);
  revalidatePath("/shop", "layout");
}

export async function deleteProduct(f: FormData) {
  const { supabase } = await requirePerm("catalog");
  const id = s(f, "id");
  const { data: p } = await supabase.from("catalog_products").select("image_paths, name").eq("id", id).single();
  const { error } = await supabase.from("catalog_products").delete().eq("id", id);
  fail(error);
  if (p?.image_paths?.length) await serviceClient().storage.from("catalog-media").remove(p.image_paths);
  await audit("delete_product", "catalog_products", id, { name: p?.name });
  revalidatePath("/admin/catalog");
  revalidatePath("/shop", "layout");
  redirect("/admin/catalog");
}

/* ---------- Business settings ---------- */
export async function savePortalSettings(f: FormData) {
  const { supabase } = await requirePerm("settings");
  const b = (k: string) => f.get(k) === "on";
  const patch = {
    shipping_inr: Math.max(0, n(f, "shipping_inr")), express_inr: Math.max(0, n(f, "express_inr")), express_enabled: b("express_enabled"),
    express_max_print_hours: Math.max(0.5, n(f, "express_max_print_hours") || 6), referral_friend_inr: Math.max(0, n(f, "referral_friend_inr")),
    referral_reward_inr: Math.max(0, n(f, "referral_reward_inr")), claim_window_hours: Math.max(1, Math.round(n(f, "claim_window_hours") || 48)),
    online_payment_enabled: b("online_payment_enabled"), proforma_enabled: b("proforma_enabled"), guest_checkout_enabled: b("guest_checkout_enabled"),
    accepting_orders: b("accepting_orders"), paused_message: s(f, "paused_message").slice(0, 300) || "We are not taking new orders right now.",
    updated_at: new Date().toISOString(),
  };
  if (!patch.online_payment_enabled && !patch.proforma_enabled) throw new Error("Keep at least one way to pay switched on.");
  const { error } = await supabase.from("portal_settings").update(patch).eq("id", 1);
  fail(error);
  await audit("save_portal_settings", "portal_settings", "1", patch);
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
}

/* ---------- Customers (edit) ---------- */
export async function saveCustomer(f: FormData) {
  await requirePerm("customers");
  const id = s(f, "id");
  const gstin = s(f, "gstin").toUpperCase();
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new Error("That GSTIN doesn't match the 15-character format.");
  const { error } = await serviceClient().from("profiles").update({
    full_name: s(f, "full_name").slice(0, 120), phone_number: s(f, "phone_number").slice(0, 20), company_name: s(f, "company_name").slice(0, 160) || null, gstin: gstin || null, updated_at: new Date().toISOString(),
  }).eq("id", id).neq("role", "admin");
  fail(error);
  await audit("save_customer", "profiles", id);
  revalidatePath(`/admin/customers/${id}`);
}

export async function adjustWallet(f: FormData) {
  await requirePerm("customers");
  const id = s(f, "id"), amount = n(f, "amount"), reason = s(f, "reason");
  if (!amount || Math.abs(amount) > 100000) throw new Error("Enter an amount between −1,00,000 and 1,00,000.");
  if (!reason) throw new Error("Give a reason. It's saved in the audit log.");
  const { error } = await serviceClient().rpc("adjust_wallet", { p_user: id, p_delta: amount });
  if (error) throw new Error(error.message.includes("too low") ? "The wallet can't go below ₹0." : error.message);
  await audit("adjust_wallet", "profiles", id, { amount, reason });
  revalidatePath(`/admin/customers/${id}`);
}

/* ---------- Partners & coupons (edit) ---------- */
export async function updateVendor(f: FormData) {
  const { supabase } = await requirePerm("production");
  const id = s(f, "id");
  const patch = {
    company_name: s(f, "company_name"), phone_number: s(f, "phone_number"), gstin: s(f, "gstin").toUpperCase() || null, pan_number: s(f, "pan_number").toUpperCase() || null,
    shiprocket_pickup_location: s(f, "pickup") || "Mumbai_Primary_Vendor_Hub", base_payout_share_percent: n(f, "share") || 45,
  };
  if (!patch.company_name || !patch.phone_number) throw new Error("Company and phone are required.");
  const { error } = await supabase.from("vendors").update(patch).eq("id", id);
  fail(error);
  await audit("update_vendor", "vendors", id, patch);
  revalidatePath("/admin/vendors");
}

export async function updateCoupon(f: FormData) {
  const { supabase } = await requirePerm("marketing");
  const id = s(f, "id"), until = s(f, "valid_until");
  const patch = {
    description: s(f, "description"), discount_value: n(f, "discount_value"), min_order_subtotal_inr: n(f, "min_order"),
    max_discount_cap_inr: nn(f, "cap"), max_total_uses: nn(f, "max_total_uses"), max_uses_per_user: n(f, "per_user") || 1,
    valid_until: until ? new Date(until + "T23:59:59+05:30").toISOString() : null, is_public_on_checkout: f.get("public") === "on",
  };
  const { error } = await supabase.from("promo_coupons").update(patch).eq("id", id);
  fail(error);
  await audit("update_coupon", "promo_coupons", id, patch);
  revalidatePath("/admin/coupons");
}
