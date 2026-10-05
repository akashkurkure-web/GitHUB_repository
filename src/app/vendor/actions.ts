"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendor } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { ORDER_RANK } from "@/lib/format";
import { notify } from "@/lib/notify";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id: string, msg: string, ok = true): never => redirect(`/vendor/jobs/${id}?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);
const NEXT: Record<string, string[]> = {
  queued_for_vendor: ["accepted", "rejected"], accepted: ["printing", "rejected"], printing: ["post_processing", "qc_uploaded"],
  post_processing: ["qc_uploaded"], qc_uploaded: ["packed_ready"], packed_ready: ["handed_over"],
};

/** Loads the job through RLS (so only the vendor's own jobs are found). */
async function ownJob(id: string) {
  const { supabase } = await requireVendor();
  const { data: job } = await supabase.from("vendor_jobs").select("*, orders(id, order_number, status, status_rank, user_id, tracking_number)").eq("id", id).maybeSingle();
  if (!job) redirect("/vendor?err=" + encodeURIComponent("Job not found."));
  return job as any;
}
async function bumpOrder(orderId: string, status: string) {
  const svc = serviceClient();
  await svc.from("orders").update({ status, status_rank: ORDER_RANK[status] }).eq("id", orderId).lt("status_rank", ORDER_RANK[status]).gte("status_rank", ORDER_RANK.paid);
}
async function customerPhone(userId: string) {
  const { data } = await serviceClient().from("profiles").select("phone_number").eq("id", userId).single();
  return data?.phone_number;
}

export async function advanceJob(f: FormData) {
  const id = s(f, "id"), to = s(f, "to");
  const job = await ownJob(id);
  if (!NEXT[job.status]?.includes(to)) back(id, "That step isn't available right now.", false);
  if (to === "qc_uploaded") back(id, "Use the QC form below to upload the weighed photo.", false);
  if (to === "packed_ready" && !job.qc_photo_path) back(id, "Upload the QC photo first.", false);
  const svc = serviceClient();
  const patch: Record<string, unknown> = { status: to };
  if (to === "rejected") patch.vendor_notes = s(f, "reason").slice(0, 500) || "Rejected by vendor";
  if (to === "packed_ready") patch.selected_box_code = s(f, "box") || "BOX_S";
  await svc.from("vendor_jobs").update(patch).eq("id", id);
  const o = job.orders;
  if (to === "printing") { await bumpOrder(o.id, "in_production"); await notify("PRINTING_STARTED", { phone: await customerPhone(o.user_id), user_id: o.user_id, order_id: o.id }, [o.order_number]); }
  if (to === "packed_ready") { await bumpOrder(o.id, "packed"); await notify("QC_PASSED_PACKED", { phone: await customerPhone(o.user_id), user_id: o.user_id, order_id: o.id }, [o.order_number]); }
  if (to === "handed_over" && o.tracking_number) { await bumpOrder(o.id, "shipped"); await notify("ORDER_SHIPPED", { phone: await customerPhone(o.user_id), user_id: o.user_id, order_id: o.id }, [o.order_number, o.tracking_number]); }
  revalidatePath(`/vendor/jobs/${id}`); revalidatePath("/vendor");
  back(id, to === "rejected" ? "Job returned to Layer27." : to === "handed_over" && !o.tracking_number ? "Marked handed over. Layer27 will add the courier tracking." : "Updated.");
}

export async function submitQC(f: FormData) {
  const id = s(f, "id");
  const job = await ownJob(id);
  if (!["printing", "post_processing", "qc_uploaded"].includes(job.status)) back(id, "QC can be uploaded after printing.", false);
  const grams = Number(f.get("grams"));
  if (!(grams > 0)) back(id, "Enter the weight shown on the scale.", false);
  const photo = f.get("photo");
  if (!(photo instanceof File) || !photo.size) back(id, "Add a photo of the parts on the scale.", false);
  const file = photo as File;
  if (!/^image\//.test(file.type) || file.size > 4 * 1024 * 1024) back(id, "Photo must be an image under 4 MB.", false);

  const svc = serviceClient();
  const { data: items } = await svc.from("order_items").select("total_batch_mass_grams, estimated_mass_grams, quantity").eq("order_id", job.order_id);
  const expected = (items ?? []).reduce((n, i) => n + Number(i.total_batch_mass_grams || Number(i.estimated_mass_grams) * i.quantity), 0);
  const dev = expected > 0 ? Math.abs(grams - expected) / expected : 0;
  const path = `${id}/qc-${Date.now()}.${file.type.split("/")[1] || "jpg"}`;
  const { error } = await svc.storage.from("qc-photos").upload(path, file, { contentType: file.type });
  if (error) back(id, "Photo upload failed. Try again.", false);
  await svc.from("vendor_jobs").update({
    actual_weighed_grams: grams, qc_photo_path: path,
    defect_photo_urls: [...(Array.isArray(job.defect_photo_urls) ? job.defect_photo_urls : []), path],
    ...(dev <= 0.15 ? { status: "qc_uploaded" } : {}),
  }).eq("id", id);
  if (dev > 0.15) back(id, `Weight is ${(dev * 100).toFixed(0)}% off the expected ${expected.toFixed(0)} g. Dispatch is blocked. Check infill and part count, or message Layer27 to override.`, false);
  await bumpOrder(job.order_id, "qc_passed");
  revalidatePath(`/vendor/jobs/${id}`);
  back(id, `QC passed: ${grams} g vs expected ${expected.toFixed(0)} g.`);
}

export async function setFinalMaterial(f: FormData) {
  const id = s(f, "job_id"), itemId = s(f, "item_id"), mat = s(f, "material");
  const job = await ownJob(id);
  if (!["queued_for_vendor", "accepted"].includes(job.status)) back(id, "Material can only be set before printing.", false);
  if (!["pla", "petg", "abs", "asa", "tpu", "standard_resin", "tough_resin"].includes(mat)) back(id, "Choose a material.", false);
  const svc = serviceClient();
  const { data: it } = await svc.from("order_items").select("order_id, selection_mode").eq("id", itemId).single();
  if (!it || it.order_id !== job.order_id || it.selection_mode !== "manufacturer_decides") back(id, "This part's material is fixed by the customer.", false);
  await svc.from("order_items").update({ manufacturer_final_material: mat, manufacturer_decision_notes: s(f, "notes").slice(0, 500), is_material_locked_by_vendor: true }).eq("id", itemId);
  revalidatePath(`/vendor/jobs/${id}`);
  back(id, "Material confirmed.");
}
