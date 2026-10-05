"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { colorsFor, LAYERS, priceItem, type Material, type Tier } from "@/lib/pricing";
import { addToCart } from "@/lib/cart";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductOrder({ product: p, materials, tiers }: { product: any; materials: Material[]; tiers: Tier[] }) {
  const [mat, setMat] = useState(materials.find((m) => m.material_code === p.default_material)?.material_code ?? materials[0]?.material_code);
  const m = materials.find((x) => x.material_code === mat) ?? materials[0];
  const cols = colorsFor(m);
  const [color, setColor] = useState(Math.max(0, cols.findIndex(([n]) => n === p.default_color)));
  const [qty, setQty] = useState(1);
  const [layer, setLayer] = useState(m.technology === "fdm" ? 0.2 : 0.05);
  const [added, setAdded] = useState(false);
  const ci = color < cols.length ? color : 0;
  const lay = LAYERS[m.technology].some(([v]) => v === layer) ? layer : LAYERS[m.technology][m.technology === "fdm" ? 1 : 0][0];
  const cfg = { material: m.material_code, color: cols[ci][0], infill: p.default_infill ?? 25, layer: lay, quantity: qty, selection_mode: "manual_user" as const };
  const q = useMemo(() => priceItem(p.volume_cm3, m, cfg, tiers, { fixedUnit: p.fixed_unit_price_inr, setup: p.waive_setup_fee ? 0 : undefined }), [m, qty, lay]); // eslint-disable-line

  function add() {
    addToCart({ key: crypto.randomUUID(), cad_asset_id: p.cad_asset_id, catalog_product_id: p.id, file_name: p.name, volume_cm3: p.volume_cm3, bbox_mm: p.bbox_mm, watertight: true, config: cfg });
    setAdded(true);
  }
  return (
    <div className="card" style={{ gap: 16, position: "sticky", top: 80 }}>
      <div><span className="eyebrow">{p.category}</span><h1 style={{ marginTop: 6 }}>{p.name}</h1>{p.short_description && <p className="muted">{p.short_description}</p>}</div>
      <label className="f">Material<select value={m.material_code} onChange={(e) => { setMat(e.target.value); setAdded(false); }}>{materials.map((x) => <option key={x.material_code} value={x.material_code}>{x.display_name}</option>)}</select>
        {m.best_for && <span className="muted" style={{ fontWeight: 400 }}>{m.best_for}</span>}</label>
      <div style={{ display: "grid", gap: 6 }}><span className="f">Colour · <span className="mono">{cols[ci][0]}</span></span>
        <div className="swatches">{cols.map(([n, hex], i) => <button key={n} type="button" className="sw" style={{ background: hex }} aria-label={n} aria-pressed={i === ci} onClick={() => setColor(i)} />)}</div></div>
      <div className="row2">
        <label className="f">Finish<select value={lay} onChange={(e) => setLayer(Number(e.target.value))}>{LAYERS[m.technology].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Quantity<input type="number" min={1} max={5000} value={qty} onChange={(e) => { setQty(Math.max(1, Number(e.target.value) || 1)); setAdded(false); }} /></label>
      </div>
      <div className="bill">
        <div className="ln"><span>Price per piece</span><span>{inr(q.unit)}</span></div>
        {q.setup > 0 && <div className="ln"><span>Setup (once)</span><span>{inr(q.setup)}</span></div>}
        {q.discount > 0 && <div className="ln minus"><span>{q.tier.tier_badge_label} −{q.discountPct}%</span><span>− {inr(q.discount)}</span></div>}
        <div className="total"><span><span className="eyebrow">For {q.qty} {q.qty === 1 ? "piece" : "pieces"}</span><br /><span className="muted" style={{ fontSize: ".75rem" }}>Shipping and 18% GST added at checkout</span></span><b>{inr(q.line)}</b></div>
      </div>
      <div className="row">
        <button className="btn lg" onClick={add}>{added ? "Added ✓ Add again" : "Add to cart"}</button>
        {added && <Link className="btn lg navy" href="/checkout">Checkout</Link>}
      </div>
      {added && <p className="toast ok">Added to your cart. <Link href="/cart">View cart</Link> · <Link href="/shop">Keep shopping</Link></p>}
      <p className="muted" style={{ fontSize: ".8rem" }}>No account needed. You can check out as a guest.</p>
    </div>
  );
}
