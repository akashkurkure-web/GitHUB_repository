import { publicClient } from "@/lib/supabase/public";
import { loadCatalog } from "@/lib/orders";
import { priceItem, type Material, type Tier } from "@/lib/pricing";

export const inrShort = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/** Price of one piece of a product in its default material (before shipping and GST). */
export function productFrom(p: any, materials: Material[], tiers: Tier[]) {
  const vol = Number(p.volume_cm3 ?? 0);
  const m = materials.find((x) => x.material_code === p.default_material) ?? materials[0];
  if (!m || (!vol && !p.fixed_unit_price_inr)) return null;
  return priceItem(vol, m, { material: m.material_code, color: "", infill: p.default_infill ?? 25, layer: m.technology === "fdm" ? 0.2 : 0.05, quantity: 1, selection_mode: "manual_user" }, tiers,
    { fixedUnit: p.fixed_unit_price_inr != null ? Number(p.fixed_unit_price_inr) : null, setup: p.waive_setup_fee ? 0 : undefined }).line;
}

export async function publishedProducts() {
  const sb = publicClient();
  const [{ data }, cat] = await Promise.all([
    sb.from("catalog_products").select("*").eq("is_published", true).order("sort_order").order("name"),
    loadCatalog(sb as any),
  ]);
  return { products: data ?? [], ...cat };
}
