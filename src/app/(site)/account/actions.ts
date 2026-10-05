"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { cancelOrder, UserError } from "@/lib/orders";
import { GSTIN_RE, PINCODE_RE } from "@/lib/pricing";
import { ORDER_RANK } from "@/lib/format";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string, ok = true) => redirect(`${path}?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);

async function uploadPhotos(files: File[], bucket: string, prefix: string) {
  const svc = serviceClient(), paths: string[] = [];
  if (files.reduce((n, f) => n + (f?.size || 0), 0) > 4 * 1024 * 1024) throw new UserError("Photos must be under 4 MB in total. Use smaller or fewer photos.");
  for (const [i, file] of files.entries()) {
    if (!file || !file.size) continue;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new UserError("Photos must be JPG, PNG, WEBP or HEIC.");
    if (file.size > 4 * 1024 * 1024) throw new UserError("Each photo must be under 4 MB.");
    const path = `${prefix}/${i}-${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const { error } = await svc.storage.from(bucket).upload(path, file, { contentType: file.type });
    if (error) throw new Error(error.message);
    paths.push(path);
  }
  return paths;
}

export async function saveProfile(f: FormData) {
  const { user } = await requireUser();
  const gstin = s(f, "gstin").toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) back("/account/profile", "That GSTIN doesn't match the 15-character format.", false);
  const pin = s(f, "pincode");
  if (pin && !PINCODE_RE.test(pin)) back("/account/profile", "Pincode must be 6 digits.", false);
  const { error } = await serviceClient().from("profiles").update({
    full_name: s(f, "full_name"), phone_number: s(f, "phone_number"), company_name: s(f, "company_name") || null, gstin: gstin || null,
    default_shipping_address: { name: s(f, "full_name"), phone: s(f, "phone_number"), line1: s(f, "line1"), line2: s(f, "line2"), city: s(f, "city"), state: s(f, "state"), pincode: pin },
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);
  if (error) back("/account/profile", error.message, false);
  revalidatePath("/account");
  back("/account/profile", "Profile saved.");
}

export async function cancelMyOrder(f: FormData) {
  const { user } = await requireUser();
  const id = s(f, "id"), path = `/account/orders/${id}`;
  const svc = serviceClient();
  const { data: o } = await svc.from("orders").select("id, user_id, status, status_rank").eq("id", id).single();
  if (!o || o.user_id !== user.id) back("/account", "Order not found.", false);
  const { data: jobs } = await svc.from("vendor_jobs").select("status").eq("order_id", id);
  const started = (jobs ?? []).some((j) => !["queued_for_vendor", "rejected"].includes(j.status));
  if (o!.status_rank > ORDER_RANK.paid || started) back(path, "Printing has started, so the order can't be cancelled online. Raise a support ticket.", false);
  try { await cancelOrder(svc, id, "source"); } catch (e: any) { back(path, e instanceof UserError ? e.message : "Cancellation failed. Contact support.", false); }
  revalidatePath(path);
  back(path, o!.status === "paid" ? "Order cancelled. Your refund is on its way." : "Order cancelled.");
}

export async function submitReview(f: FormData) {
  const { user, profile } = await requireUser();
  const id = s(f, "order_id"), path = `/account/orders/${id}`;
  const svc = serviceClient();
  const { data: o } = await svc.from("orders").select("id, user_id, status").eq("id", id).single();
  if (!o || o.user_id !== user.id || o.status !== "delivered") back(path, "You can review an order after it's delivered.", false);
  const n = (k: string) => Math.min(5, Math.max(1, Number(f.get(k)) || 5));
  const { data: existing } = await svc.from("product_service_reviews").select("id").eq("order_id", id).eq("user_id", user.id).maybeSingle();
  if (existing) back(path, "You've already reviewed this order.", false);
  const { data: r, error } = await svc.from("product_service_reviews").insert({
    order_id: id, user_id: user.id, reviewer_display_name: (profile.full_name || "Customer").split(" ")[0],
    reviewer_company_or_city: s(f, "city") || "Mumbai, MH",
    overall_rating: n("overall"), print_surface_quality_rating: n("surface"), dimensional_accuracy_rating: n("accuracy"), packaging_and_delivery_rating: n("delivery"),
    review_title: s(f, "title").slice(0, 120) || "Review", review_comment: s(f, "comment").slice(0, 2000) || "—",
  }).select("generated_reward_coupon_code, status").single();
  if (error) back(path, error.message, false);
  revalidatePath(path);
  back(path, r?.generated_reward_coupon_code ? `Thank you! Your reward code is ${r.generated_reward_coupon_code}.` : r?.status === "flagged_for_resolution" ? "Thanks for telling us. Our team will contact you to put this right." : "Thanks for your review!");
}

export async function submitClaim(f: FormData) {
  const { user } = await requireUser();
  const id = s(f, "order_id"), path = `/account/orders/${id}`;
  const svc = serviceClient();
  const { data: o } = await svc.from("orders").select("id, user_id, status, delivered_at, updated_at").eq("id", id).single();
  if (!o || o.user_id !== user.id || o.status !== "delivered") back(path, "Claims can be raised after delivery.", false);
  const deliveredAt = new Date(o!.delivered_at || o!.updated_at).getTime();
  const { data: st } = await svc.from("portal_settings").select("claim_window_hours").eq("id", 1).maybeSingle();
  const windowH = Number(st?.claim_window_hours ?? 48);
  if (Date.now() - deliveredAt > windowH * 3600_000) back(path, `The ${windowH}-hour claim window has passed. Raise a support ticket instead.`, false);
  const type = s(f, "claim_type");
  if (!["transit_box_crushed", "dimensional_tolerance_error", "missing_batch_quantity", "surface_delamination"].includes(type)) back(path, "Choose what went wrong.", false);
  const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) back(path, "Add at least one unboxing or caliper photo.", false);
  let paths: string[] = [];
  try { paths = await uploadPhotos(files.slice(0, 4), "claim-photos", `${user.id}/${id}`); } catch (e: any) { back(path, e.message, false); }
  const { error } = await svc.from("defect_warranty_claims").insert({
    order_id: id, user_id: user.id, claim_type: type, customer_description: s(f, "description").slice(0, 2000),
    unboxing_or_caliper_photo_urls: paths.map((p) => `/api/files/photo?b=claim-photos&p=${encodeURIComponent(p)}`),
  });
  if (error) back(path, error.message, false);
  revalidatePath(path);
  back(path, "Claim received. We review claims within one working day.");
}

export async function openTicket(f: FormData) {
  const { user } = await requireUser();
  const cat = s(f, "category");
  if (!["dfm_help", "shipping_delay", "dimensional_defect", "gst_invoice", "b2b_quote", "other"].includes(cat)) back("/account/support", "Choose a topic.", false);
  const orderId = s(f, "order_id") || null;
  const svc = serviceClient();
  if (orderId) {
    const { data: o } = await svc.from("orders").select("user_id").eq("id", orderId).maybeSingle();
    if (!o || o.user_id !== user.id) back("/account/support", "That order isn't on your account.", false);
  }
  let evidence: string | null = null;
  const photo = f.get("photo");
  if (photo instanceof File && photo.size) {
    try { const [p] = await uploadPhotos([photo], "claim-photos", `${user.id}/tickets`); evidence = `/api/files/photo?b=claim-photos&p=${encodeURIComponent(p)}`; }
    catch (e: any) { back("/account/support", e.message, false); }
  }
  const { error } = await svc.from("support_tickets").insert({
    user_id: user.id, order_id: orderId, category: cat, priority: cat === "dimensional_defect" ? "urgent" : "high",
    issue_summary: s(f, "summary").slice(0, 3000), evidence_photo_url: evidence,
  });
  if (error) back("/account/support", error.message, false);
  revalidatePath("/account/support");
  back("/account/support", "Ticket opened. We reply within one working day.");
}

export async function applyCredit(f: FormData) {
  const { user } = await requireUser();
  const gstin = s(f, "gstin").toUpperCase(), company = s(f, "company");
  if (!company || !GSTIN_RE.test(gstin)) back("/account/business", "Enter your company name and a valid GSTIN.", false);
  const cycle = [7, 15, 30].includes(Number(f.get("cycle"))) ? Number(f.get("cycle")) : 15;
  const { error } = await serviceClient().from("corporate_credit_accounts").insert({
    user_id: user.id, company_name: company, gstin, billing_cycle_days: cycle, status: "pending_approval",
  });
  if (error) back("/account/business", error.code === "23505" ? "You've already applied." : error.message, false);
  await serviceClient().from("profiles").update({ company_name: company, gstin }).eq("id", user.id);
  revalidatePath("/account/business");
  back("/account/business", "Application received. We usually decide within two working days.");
}
