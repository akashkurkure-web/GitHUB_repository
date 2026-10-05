import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MATERIALS, DEFAULT_TIERS, GSTIN_RE, HSN, MMR_PIN, PINCODE_RE,
  fits, gstSplit, priceItem, recommend, round2, type ItemConfig, type Material, type Tier,
} from "@/lib/pricing";
import { ORDER_RANK } from "@/lib/format";
import { notify } from "@/lib/notify";
import { refundPayment, razorpayEnabled } from "@/lib/razorpay";
import { normalizeSettings } from "@/lib/site";

type SB = SupabaseClient<any, "public", any>;

export async function loadCatalog(sb: SB): Promise<{ materials: Material[]; tiers: Tier[] }> {
  const [{ data: m }, { data: t }] = await Promise.all([
    sb.from("material_pricing_catalog").select("*").eq("is_active", true).order("sort_order").order("retail_rate_per_gram_inr"),
    sb.from("quantity_discount_tiers").select("*").eq("is_active", true).order("min_quantity"),
  ]);
  const materials = (m?.length ? m : DEFAULT_MATERIALS).map((x: any) => ({
    ...x,
    density_g_cm3: Number(x.density_g_cm3), retail_rate_per_gram_inr: Number(x.retail_rate_per_gram_inr),
    machine_hour_rate_inr: Number(x.machine_hour_rate_inr), print_speed_grams_per_hr: Number(x.print_speed_grams_per_hr),
    base_setup_fee_inr: Number(x.base_setup_fee_inr), minimum_order_value_inr: Number(x.minimum_order_value_inr),
  })) as Material[];
  const tiers = (t?.length ? t : DEFAULT_TIERS).map((x: any) => ({ ...x, discount_percentage: Number(x.discount_percentage) })) as Tier[];
  return { materials, tiers };
}

export type Address = { name: string; phone: string; line1: string; line2?: string; city: string; state: string; pincode: string };
export type CheckoutInput = {
  items: { cad_asset_id: string; config: ItemConfig; catalog_product_id?: string | null }[];
  guest?: { email: string; name: string };
  coupon?: string;
  gstin?: string;
  legal_name?: string;
  po_number?: string;
  address: Address;
  express?: boolean;
  use_wallet?: boolean;
  payment: "online" | "proforma" | "credit";
};

export class UserError extends Error {}

/**
 * Computes an order entirely on the server from database prices.
 * Nothing the browser sends about money is trusted.
 */
export async function computeOrder(sb: SB, userId: string | null, email: string, input: CheckoutInput, guestId: string | null = null) {
  if (!input.items?.length) throw new UserError("Your cart is empty.");
  const { data: settingsRow } = await sb.from("portal_settings").select("*").eq("id", 1).maybeSingle();
  const settings = normalizeSettings(settingsRow);
  if (!settings.accepting_orders) throw new UserError(settings.paused_message);
  if (!userId && !(settingsRow?.guest_checkout_enabled ?? true)) throw new UserError("Please sign in or create an account to order.");
  if (!userId && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) throw new UserError("Enter your email so we can send your invoice and updates.");
  if (input.items.length > 25) throw new UserError("Up to 25 parts per order. Split larger orders.");
  const { materials, tiers } = await loadCatalog(sb);
  const gstin = (input.gstin || "").trim().toUpperCase() || null;
  if (gstin && !GSTIN_RE.test(gstin)) throw new UserError("The GSTIN doesn't match the 15-character format.");

  const ids = Array.from(new Set(input.items.map((i) => i.cad_asset_id)));
  const [{ data: assets }, { data: products }] = await Promise.all([
    sb.from("cad_assets").select("id, user_id, guest_session_id, file_name, volume_cm3, bounding_box_x_mm, bounding_box_y_mm, bounding_box_z_mm").in("id", ids),
    sb.from("catalog_products").select("*").in("cad_asset_id", ids).eq("is_published", true),
  ]);
  const byId = new Map((assets ?? []).map((a: any) => [a.id, a]));
  const productByAsset = new Map((products ?? []).map((pr: any) => [pr.cad_asset_id, pr]));

  const lines = input.items.map((it) => {
    const a: any = byId.get(it.cad_asset_id);
    const product: any = productByAsset.get(it.cad_asset_id) ?? null;
    const mine = a && ((userId && a.user_id === userId) || (!userId && guestId && a.guest_session_id === guestId));
    if (!a || (!mine && !product)) throw new UserError("One of the files in your cart isn't linked to you any more. Remove it and upload it again.");
    const cfg = { ...it.config };
    if (product) cfg.selection_mode = "manual_user";
    if (cfg.selection_mode !== "manual_user") cfg.material = recommend(cfg.environment, cfg.stress).code;
    if (product?.allowed_materials?.length && !product.allowed_materials.includes(cfg.material)) cfg.material = product.default_material;
    const mat = materials.find((m) => m.material_code === cfg.material);
    if (!mat) throw new UserError(`Material ${cfg.material} isn't available right now.`);
    const bbox = [Number(a.bounding_box_x_mm), Number(a.bounding_box_y_mm), Number(a.bounding_box_z_mm)];
    if (!fits(bbox, mat.technology)) throw new UserError(`${a.file_name} is larger than the ${mat.technology === "fdm" ? "FDM" : "resin"} build volume. Contact us to split it.`);
    const p = priceItem(Number(a.volume_cm3), mat, cfg, tiers, product ? { fixedUnit: product.fixed_unit_price_inr != null ? Number(product.fixed_unit_price_inr) : null, setup: product.waive_setup_fee ? 0 : undefined } : {});
    return { asset: a, cfg, mat, p, product, name: product?.name ?? a.file_name };
  });

  let subtotal = round2(lines.reduce((s, l) => s + l.p.line, 0));
  const moq = Math.max(...lines.map((l) => l.mat.minimum_order_value_inr));
  const moqTopUp = subtotal < moq ? round2(moq - subtotal) : 0;
  subtotal = round2(subtotal + moqTopUp);
  const totalHours = lines.reduce((s, l) => s + l.p.hours * l.p.qty, 0);

  const a = input.address || ({} as Address);
  if (!a.name || !a.line1 || !a.city || !a.state || !PINCODE_RE.test(a.pincode || "") || !/^\+?\d[\d\s-]{8,}$/.test(a.phone || ""))
    throw new UserError("Fill in the delivery address: name, phone, address, city, state and a 6-digit pincode.");
  const express = Boolean(input.express);
  if (express && !MMR_PIN.test(a.pincode)) throw new UserError("Same-day express is only for Mumbai, Thane and Navi Mumbai pincodes.");
  if (express && !settings.express_enabled) throw new UserError("Same-day express is paused right now. Choose standard delivery.");
  if (express && totalHours > settings.express_max_print_hours) throw new UserError(`Same-day express needs under ${settings.express_max_print_hours} hours of print time. Choose standard delivery.`);

  // Prior paid orders (for first-order rules)
  const { count: paidCount } = userId
    ? await sb.from("orders").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("status_rank", ORDER_RANK.paid).lte("status_rank", ORDER_RANK.delivered)
    : { count: 0 };

  // Company account discount
  const { data: credit } = userId ? await sb.from("corporate_credit_accounts").select("*").eq("user_id", userId).maybeSingle() : { data: null as any };
  const corporatePct = credit?.status === "active" ? Number(credit.corporate_tier_discount_percent) : 0;
  const corporateDiscount = round2((subtotal * corporatePct) / 100);

  // Coupon
  let shipping = express ? settings.express_inr : settings.shipping_inr;
  let coupon: any = null, couponDiscount = 0;
  const code = (input.coupon || "").trim().toUpperCase();
  if (code) {
    const { data: c } = await sb.from("promo_coupons").select("*").eq("code", code).maybeSingle();
    const now = Date.now();
    if (!c || !c.is_active) throw new UserError("That coupon code isn't valid.");
    if (new Date(c.valid_from).getTime() > now || (c.valid_until && new Date(c.valid_until).getTime() < now)) throw new UserError("That coupon has expired.");
    if (c.specific_user_email && c.specific_user_email.toLowerCase() !== email.toLowerCase()) throw new UserError("That coupon belongs to a different account.");
    if (c.max_total_uses != null && c.current_uses_count >= c.max_total_uses) throw new UserError("That coupon has been fully used.");
    if (!userId && (c.first_order_only || c.specific_user_email)) throw new UserError("Sign in or create an account to use that coupon.");
    if (c.first_order_only && (paidCount ?? 0) > 0) throw new UserError("That coupon is for first orders only.");
    if (c.b2b_gstin_only && !gstin) throw new UserError("That coupon needs a GSTIN on the order.");
    if (c.allowed_materials?.length && lines.some((l) => !c.allowed_materials.includes(l.mat.material_code))) throw new UserError("That coupon doesn't apply to every material in your cart.");
    if (subtotal < Number(c.min_order_subtotal_inr)) throw new UserError(`That coupon needs a subtotal of at least ₹${c.min_order_subtotal_inr}.`);
    const { count: mine } = userId
      ? await sb.from("coupon_redemptions").select("id", { count: "exact", head: true }).eq("coupon_id", c.id).eq("user_id", userId)
      : await sb.from("orders").select("id", { count: "exact", head: true }).eq("coupon_id", c.id).ilike("guest_email", email).gte("status_rank", ORDER_RANK.paid);
    if ((mine ?? 0) >= c.max_uses_per_user) throw new UserError("You've already used that coupon.");
    if (c.discount_type === "percentage") couponDiscount = (subtotal * Number(c.discount_value)) / 100;
    else if (c.discount_type === "flat_inr") couponDiscount = Number(c.discount_value);
    else shipping = 0;
    if (c.max_discount_cap_inr != null) couponDiscount = Math.min(couponDiscount, Number(c.max_discount_cap_inr));
    coupon = c;
  }

  // Referral welcome discount on the first paid order
  let referralDiscount = 0;
  if (userId && (paidCount ?? 0) === 0) {
    const { data: ref } = await sb.from("referral_rewards_ledger").select("friend_discount_inr, status").eq("referred_user_id", userId).maybeSingle();
    if (ref?.status === "pending_friend_order") referralDiscount = Number(ref.friend_discount_inr);
  }

  // Discounts never push the goods value below 45% (vendor cost floor)
  const floor = round2(subtotal * 0.45);
  let discounts = round2(corporateDiscount + couponDiscount + referralDiscount);
  if (subtotal - discounts < floor) {
    const over = discounts - (subtotal - floor);
    couponDiscount = Math.max(0, couponDiscount - over);
    discounts = round2(corporateDiscount + couponDiscount + referralDiscount);
    if (subtotal - discounts < floor) { referralDiscount = Math.max(0, round2(subtotal - floor - corporateDiscount - couponDiscount)); discounts = round2(corporateDiscount + couponDiscount + referralDiscount); }
  }
  couponDiscount = round2(couponDiscount);

  const goods = round2(subtotal - discounts);
  const taxable = round2(goods + shipping);
  const g = gstSplit(taxable, gstin);
  const total = round2(taxable + g.tax);

  let wallet = 0;
  if (userId && input.use_wallet) {
    const { data: prof } = await sb.from("profiles").select("wallet_balance_inr").eq("id", userId).single();
    wallet = round2(Math.min(Number(prof?.wallet_balance_inr ?? 0), total));
  }
  const payable = round2(total - wallet);

  return {
    lines, subtotal, moqTopUp, corporatePct, corporateDiscount, coupon, couponDiscount, referralDiscount,
    shipping, express, taxable, gst: g, total, wallet, payable, gstin, credit, totalHours: round2(totalHours),
    summary: {
      items: lines.map((l) => ({
        cad_asset_id: l.asset.id, file_name: l.name, material: l.mat.display_name, material_code: l.mat.material_code,
        qty: l.p.qty, unit: l.p.unit, mass: l.p.mass, hours: l.p.hours, discountPct: l.p.discountPct, line: l.p.line, tier: l.p.tier.tier_badge_label,
      })),
      subtotal, moqTopUp, corporatePct, corporateDiscount, couponCode: coupon?.code ?? null, couponDiscount, referralDiscount,
      shipping, taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst, intra: g.intra, total, wallet, payable,
      creditAvailable: credit?.status === "active" ? Number(credit.available_credit_inr) : null,
    },
  };
}

export async function insertOrder(sb: SB, userId: string | null, input: CheckoutInput, c: Awaited<ReturnType<typeof computeOrder>>, guestId: string | null = null) {
  const status = input.payment === "proforma" ? "proforma_issued" : "pending_payment";
  const { data: order, error } = await sb.from("orders").insert({
    user_id: userId,
    guest_email: userId ? null : (input.guest?.email || "").trim().toLowerCase(),
    guest_name: userId ? null : (input.guest?.name || input.address?.name || "").trim().slice(0, 120),
    guest_session_id: userId ? null : guestId,
    status, status_rank: ORDER_RANK[status],
    original_subtotal_amount: c.subtotal,
    coupon_id: c.coupon?.id ?? null, coupon_code: c.coupon?.code ?? null,
    discount_amount: round2(c.couponDiscount + c.corporateDiscount),
    referral_discount_inr: c.referralDiscount,
    subtotal_amount: round2(c.subtotal - c.couponDiscount - c.corporateDiscount - c.referralDiscount),
    shipping_amount: c.shipping,
    taxable_amount: c.taxable,
    hsn_code: HSN,
    customer_gstin: c.gstin,
    customer_legal_name: (input.legal_name || "").trim() || null,
    place_of_supply_code: c.gst.place,
    is_intra_state: c.gst.intra,
    cgst_amount: c.gst.cgst, sgst_amount: c.gst.sgst, igst_amount: c.gst.igst,
    total_amount: c.total,
    wallet_applied_inr: c.wallet,
    payment_provider: input.payment === "online" ? "razorpay" : input.payment === "credit" ? "credit_line" : "neft",
    b2b_po_number: (input.po_number || "").trim() || null,
    shipping_address: input.address,
    is_mmr_same_day_express: c.express,
  }).select("*").single();
  if (error) throw new Error(error.message);

  const rows = c.lines.map((l) => ({
    order_id: order.id, cad_asset_id: l.asset.id, display_name: l.name, catalog_product_id: l.product?.id ?? null,
    selection_mode: l.cfg.selection_mode, technology: l.mat.technology, material: l.mat.material_code,
    color: l.cfg.color || "Matte Black", infill_percentage: l.mat.technology === "fdm" ? Math.round(l.cfg.infill) : 100,
    layer_height_mm: l.cfg.layer, quantity: l.p.qty, single_unit_base_price: l.p.unit, setup_fee_once_inr: l.p.setup,
    quantity_discount_percent: l.p.discountPct, estimated_mass_grams: l.p.mass, total_batch_mass_grams: round2(l.p.mass * l.p.qty),
    unit_price: round2(l.p.line / l.p.qty), total_line_price: l.p.line,
    application_environment: l.cfg.environment ?? null, mechanical_stress_level: l.cfg.stress ?? null,
    customer_application_notes: (l.cfg.notes || "").slice(0, 1000) || null,
  }));
  const { error: e2 } = await sb.from("order_items").insert(rows);
  if (e2) {
    await sb.from("orders").delete().eq("id", order.id);
    throw new Error(e2.message);
  }
  if (c.wallet > 0) {
    const { error: e3 } = await sb.rpc("adjust_wallet", { p_user: userId, p_delta: -c.wallet });
    if (e3) {
      await sb.from("orders").delete().eq("id", order.id);
      throw new UserError("Your wallet balance changed. Refresh and try again.");
    }
  }
  if (input.payment === "proforma") {
    await sb.from("orders").update({ proforma_number: `PI-${order.order_number.replace("ORD-", "")}` }).eq("id", order.id);
  }
  await sb.from("user_activity_logs").insert({ user_id: userId, email: userId ? null : order.guest_email, event_type: "checkout_initiated", metadata: { order_id: order.id, payment: input.payment, guest: !userId } });
  return order;
}

/** Idempotent: safe to call from the browser callback and the webhook. */
export async function markOrderPaid(sb: SB, orderId: string, pay: { provider: string; method?: string | null; payment_id?: string | null; utr?: string | null }) {
  const { data: claimed } = await sb.from("orders")
    .update({ status: "paid", status_rank: ORDER_RANK.paid, paid_at: new Date().toISOString(), payment_provider: pay.provider, payment_method: pay.method ?? null, payment_id: pay.payment_id ?? null, b2b_utr_number: pay.utr ?? null })
    .eq("id", orderId).in("status", ["draft", "pending_payment", "proforma_issued"])
    .select("*").maybeSingle();
  if (!claimed) return false; // already processed

  const { data: inv } = await sb.rpc("generate_fy_gst_invoice_number");
  if (inv) await sb.from("orders").update({ invoice_number: inv }).eq("id", orderId).is("invoice_number", null);

  if (claimed.coupon_id) {
    const { error } = await sb.from("coupon_redemptions").insert({
      coupon_id: claimed.coupon_id, coupon_code: claimed.coupon_code, order_id: orderId, user_id: claimed.user_id,
      discount_applied_inr: claimed.discount_amount,
    });
    if (!error) {
      await sb.rpc("use_coupon", { p_coupon: claimed.coupon_id });
      await sb.from("user_review_reward_claims").update({ is_redeemed: true, redeemed_on_order_id: orderId, redeemed_at: new Date().toISOString() })
        .eq("coupon_id", claimed.coupon_id).eq("user_id", claimed.user_id);
    }
  }
  if (claimed.user_id) await sb.from("referral_rewards_ledger").update({ status: "in_transit_locked", qualifying_order_id: orderId })
    .eq("referred_user_id", claimed.user_id).eq("status", "pending_friend_order");
  await sb.from("user_activity_logs").insert({ user_id: claimed.user_id, event_type: "payment_completed", metadata: { order_id: orderId, provider: pay.provider } });
  const { data: p } = claimed.user_id ? await sb.from("profiles").select("phone_number, full_name").eq("id", claimed.user_id).single() : { data: null as any };
  await notify("ORDER_PAID", { phone: p?.phone_number || claimed.shipping_address?.phone, user_id: claimed.user_id, order_id: orderId }, [p?.full_name || claimed.guest_name || "there", claimed.order_number]);
  return true;
}

/** Called when an order is marked delivered: releases the referrer's reward. */
export async function onDelivered(sb: SB, orderId: string) {
  await sb.from("orders").update({ delivered_at: new Date().toISOString() }).eq("id", orderId).is("delivered_at", null);
  const { data: refs } = await sb.from("referral_rewards_ledger").update({ status: "credited_to_wallet", credited_at: new Date().toISOString() })
    .eq("qualifying_order_id", orderId).eq("status", "in_transit_locked").select("*");
  for (const r of refs ?? []) {
    await sb.rpc("adjust_wallet", { p_user: r.referrer_user_id, p_delta: Number(r.referrer_reward_inr) });
    const { data: rp } = await sb.from("profiles").select("total_referral_earnings_inr").eq("id", r.referrer_user_id).single();
    await sb.from("profiles").update({ total_referral_earnings_inr: Number(rp?.total_referral_earnings_inr ?? 0) + Number(r.referrer_reward_inr) }).eq("id", r.referrer_user_id);
  }
}

/**
 * Cancels an order. If money was collected it is returned to where it came
 * from (Razorpay, credit line, wallet) and a GST credit note is issued.
 */
export async function cancelOrder(sb: SB, orderId: string, refundTo: "source" | "wallet") {
  const { data: o } = await sb.from("orders").select("*").eq("id", orderId).single();
  if (!o) throw new UserError("Order not found.");
  if (!o.user_id) refundTo = "source"; // guests have no wallet
  if (["cancelled", "refunded"].includes(o.status)) return o.status;
  if (o.status_rank >= ORDER_RANK.shipped && o.status !== "rto_delivered") throw new UserError("This order has shipped. Handle it as a warranty claim or return instead.");

  const wasPaid = o.status_rank >= ORDER_RANK.paid;
  const wallet = Number(o.wallet_applied_inr);
  const paidOutside = round2(Number(o.total_amount) - wallet);
  let razorpayRefundId: string | null = null;

  if (wasPaid) {
    if (refundTo === "wallet") {
      await sb.rpc("adjust_wallet", { p_user: o.user_id, p_delta: round2(Number(o.total_amount)) });
    } else {
      if (wallet > 0) await sb.rpc("adjust_wallet", { p_user: o.user_id, p_delta: wallet });
      if (o.payment_provider === "razorpay" && o.payment_id && paidOutside > 0) {
        if (!razorpayEnabled()) throw new UserError("Razorpay keys aren't set, so the refund can't be sent. Refund to wallet instead.");
        razorpayRefundId = (await refundPayment(o.payment_id, paidOutside)).id;
      } else if (o.payment_provider === "credit_line" && paidOutside > 0) {
        const { data: acc } = await sb.from("corporate_credit_accounts").select("id, used_credit_balance_inr").eq("user_id", o.user_id).single();
        if (acc) {
          await sb.from("corporate_credit_ledger").insert({ credit_account_id: acc.id, order_id: orderId, transaction_type: "credit_note_reversal", amount_inr: paidOutside });
          await sb.from("corporate_credit_accounts").update({ used_credit_balance_inr: Math.max(0, Number(acc.used_credit_balance_inr) - paidOutside) }).eq("id", acc.id);
        }
      }
      // NEFT payments: refund by bank transfer manually; the credit note records it.
    }
    if (o.invoice_number) {
      const { data: cn } = await sb.rpc("generate_gst_credit_note_number");
      await sb.from("gst_credit_notes").insert({
        credit_note_number: cn, order_id: orderId, original_invoice_number: o.invoice_number,
        original_invoice_date: (o.paid_at || o.created_at).slice(0, 10), customer_gstin: o.customer_gstin,
        place_of_supply_code: o.place_of_supply_code, reversed_taxable_amount: o.taxable_amount,
        reversed_cgst_amount: o.cgst_amount, reversed_sgst_amount: o.sgst_amount, reversed_igst_amount: o.igst_amount,
        total_credit_amount: o.total_amount, refund_destination: refundTo === "wallet" ? "store_wallet" : "razorpay_source",
        razorpay_refund_id: razorpayRefundId,
      });
    }
  } else if (wallet > 0) {
    await sb.rpc("adjust_wallet", { p_user: o.user_id, p_delta: wallet });
  }

  const status = wasPaid ? "refunded" : "cancelled";
  await sb.from("orders").update({ status, status_rank: ORDER_RANK[status] }).eq("id", orderId);
  await sb.from("referral_rewards_ledger").update({ status: "voided_order_cancelled" }).eq("qualifying_order_id", orderId).eq("status", "in_transit_locked");
  await sb.from("vendor_jobs").update({ status: "rejected" }).eq("order_id", orderId).not("status", "in", "(handed_over,rejected)");
  if (wasPaid) {
    const { data: p } = o.user_id ? await sb.from("profiles").select("phone_number").eq("id", o.user_id).single() : { data: null as any };
    await notify("REFUND_ISSUED", { phone: p?.phone_number || o.shipping_address?.phone, user_id: o.user_id, order_id: orderId }, [o.order_number]);
  }
  return status;
}

/** After a verified sign-in: move guest orders placed with this email into the account. */
export async function claimGuestOrders(sb: SB, userId: string, email: string | undefined | null) {
  if (!email) return 0;
  const { data } = await sb.from("orders").update({ user_id: userId }).is("user_id", null).ilike("guest_email", email).select("id");
  const ids = (data ?? []).map((o: any) => o.id);
  if (ids.length) {
    const { data: items } = await sb.from("order_items").select("cad_asset_id, catalog_product_id").in("order_id", ids);
    const own = (items ?? []).filter((i: any) => !i.catalog_product_id).map((i: any) => i.cad_asset_id);
    if (own.length) await sb.from("cad_assets").update({ user_id: userId, guest_session_id: null }).in("id", own).is("user_id", null);
  }
  return ids.length;
}
