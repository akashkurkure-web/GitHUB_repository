/** Pricing engine shared by the quote tool (preview) and the server (authoritative). */
export type Tech = "fdm" | "msla_resin";
export type Material = {
  material_code: string;
  display_name: string;
  technology: Tech;
  density_g_cm3: number;
  retail_rate_per_gram_inr: number;
  machine_hour_rate_inr: number;
  print_speed_grams_per_hr: number;
  base_setup_fee_inr: number;
  minimum_order_value_inr: number;
  best_for?: string | null;
  description?: string | null;
  swatch_hex?: string | null;
  colors?: [string, string][] | null;
  sort_order?: number;
};
export type Tier = { min_quantity: number; max_quantity: number | null; discount_percentage: number; tier_badge_label: string };
export type ItemConfig = {
  material: string;
  color: string;
  infill: number; // 20–100 (FDM only)
  layer: number; // mm
  quantity: number;
  selection_mode: "manual_user" | "ai_recommended" | "manufacturer_decides";
  environment?: string;
  stress?: string;
  notes?: string;
};

export const SHIPPING_INR = 90;
export const EXPRESS_INR = 249;
export const GST_RATE = 0.18;
export const HSN = "39269099";
export const SUPPLIER_STATE = "27";
export const BUILD_VOLUME: Record<Tech, [number, number, number]> = { fdm: [256, 256, 256], msla_resin: [218, 123, 220] };
export const LAYERS: Record<Tech, [number, string][]> = {
  fdm: [[0.28, "0.28 mm · draft"], [0.2, "0.20 mm · standard"], [0.12, "0.12 mm · fine"]],
  msla_resin: [[0.05, "0.05 mm · standard"], [0.025, "0.025 mm · ultra fine"]],
};
export const COLORS: Record<Tech, [string, string][]> = {
  fdm: [["Matte Black", "#1d1f21"], ["White", "#f2f2ee"], ["Grey", "#8a9096"], ["Signal Red", "#c8312b"], ["Cobalt Blue", "#2a4fd6"], ["Safety Orange", "#f07b1e"], ["Olive", "#6b7a3a"]],
  msla_resin: [["Grey", "#8e959b"], ["Clear", "#cfe3ea"], ["Black", "#202326"], ["White", "#ecebe6"]],
};

export const DEFAULT_MATERIALS: Material[] = [
  ["pla", "PLA+", "fdm", 1.24, 7.5, 45, 35], ["petg", "PETG", "fdm", 1.27, 9.5, 55, 30], ["abs", "ABS", "fdm", 1.04, 12.5, 70, 28],
  ["asa", "ASA", "fdm", 1.07, 14, 75, 28], ["tpu", "TPU 95A", "fdm", 1.21, 15, 80, 18],
  ["standard_resin", "Standard resin 8K", "msla_resin", 1.15, 18, 90, 22], ["tough_resin", "Tough resin", "msla_resin", 1.18, 24, 110, 20],
].map(([c, n, t, d, r, m, s]) => ({
  material_code: c as string, display_name: n as string, technology: t as Tech, density_g_cm3: d as number,
  retail_rate_per_gram_inr: r as number, machine_hour_rate_inr: m as number, print_speed_grams_per_hr: s as number,
  base_setup_fee_inr: 99, minimum_order_value_inr: 399,
}));
export const DEFAULT_TIERS: Tier[] = [
  { min_quantity: 1, max_quantity: 4, discount_percentage: 0, tier_badge_label: "Prototype" },
  { min_quantity: 5, max_quantity: 9, discount_percentage: 8, tier_badge_label: "Small batch" },
  { min_quantity: 10, max_quantity: 24, discount_percentage: 15, tier_badge_label: "Pilot run" },
  { min_quantity: 25, max_quantity: 99, discount_percentage: 22, tier_badge_label: "Volume" },
  { min_quantity: 100, max_quantity: null, discount_percentage: 28, tier_badge_label: "Production" },
];

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function tierFor(qty: number, tiers: Tier[]): Tier {
  return tiers.find((t) => qty >= t.min_quantity && (t.max_quantity == null || qty <= t.max_quantity)) ?? tiers[0] ?? DEFAULT_TIERS[0];
}

export function fits(bbox: number[], tech: Tech) {
  const a = [...bbox].sort((x, y) => y - x), b = [...BUILD_VOLUME[tech]].sort((x, y) => y - x);
  return a.every((v, i) => v <= b[i]);
}

export function recommend(environment = "indoor", stress = "display"): { code: string; why: string } {
  if (stress === "flex") return { code: "tpu", why: "Needs to bend and recover, so a flexible elastomer." };
  if (stress === "detail") return { code: "standard_resin", why: "Fine features print sharpest on 8K resin." };
  if (environment === "automotive" || environment === "outdoor") return { code: "asa", why: "UV and weather stable, holds shape in a hot car." };
  if (environment === "heat") return { code: "abs", why: "Softens near 100 °C, well above PLA." };
  if (stress === "high" || stress === "moderate") return { code: "petg", why: "Tougher and less brittle than PLA under load." };
  return { code: "pla", why: "General-purpose and fastest to print." };
}

export function colorsFor(m: Pick<Material, "technology" | "colors">): [string, string][] {
  return Array.isArray(m.colors) && m.colors.length ? m.colors : COLORS[m.technology];
}

/** Price one line. volume in cm³. opts.fixedUnit overrides the computed unit price; opts.setup overrides the setup fee. */
export function priceItem(volume_cm3: number, mat: Material, cfg: ItemConfig, tiers: Tier[], opts: { fixedUnit?: number | null; setup?: number } = {}) {
  const qty = Math.max(1, Math.min(5000, Math.floor(cfg.quantity || 1)));
  const infill = Math.min(100, Math.max(20, cfg.infill || 25)) / 100;
  const eff = mat.technology === "fdm" ? volume_cm3 * (0.3 + 0.7 * infill) : volume_cm3;
  const mass = eff * Number(mat.density_g_cm3);
  const base = mat.technology === "fdm" ? 0.2 : 0.05;
  const layer = cfg.layer > 0 ? cfg.layer : base;
  const hours = (mass / Number(mat.print_speed_grams_per_hr)) * Math.pow(base / layer, 0.6);
  const unit = opts.fixedUnit != null && opts.fixedUnit > 0 ? round2(opts.fixedUnit) : round2(mass * Number(mat.retail_rate_per_gram_inr) + hours * Number(mat.machine_hour_rate_inr));
  const tier = tierFor(qty, tiers);
  const gross = unit * qty;
  const disc = round2((gross * Number(tier.discount_percentage)) / 100);
  const setup = opts.setup != null ? opts.setup : Number(mat.base_setup_fee_inr);
  return {
    qty, mass: round2(mass), hours: round2(hours), unit, tier, discountPct: Number(tier.discount_percentage),
    setup, gross: round2(gross), discount: disc, line: round2(setup + gross - disc),
  };
}

export function gstSplit(taxable: number, buyerGstin?: string | null) {
  const state = buyerGstin && /^\d{2}/.test(buyerGstin) ? buyerGstin.slice(0, 2) : SUPPLIER_STATE;
  const intra = state === SUPPLIER_STATE;
  const tax = round2(taxable * GST_RATE);
  return intra
    ? { intra, place: state, cgst: round2(tax / 2), sgst: round2(tax - round2(tax / 2)), igst: 0, tax }
    : { intra, place: state, cgst: 0, sgst: 0, igst: tax, tax };
}

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PINCODE_RE = /^[1-9]\d{5}$/;
/** Mumbai, Thane, Navi Mumbai, Palghar, Raigad (Panvel) pincode prefixes for same-day. */
export const MMR_PIN = /^(400|401|410|421)\d{3}$/;
