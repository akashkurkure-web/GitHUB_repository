import Gate from "@/components/Gate";
import { requireAdmin } from "@/lib/auth";
import { label } from "@/lib/format";
import { updateMaterial, updateTier } from "../actions";

export default async function Pricing() {
  const { supabase, perms } = await requireAdmin();
  const [{ data: mats, error: e1 }, { data: tiers, error: e2 }] = await Promise.all([
    supabase.from("material_pricing_catalog").select("*").order("technology").order("retail_rate_per_gram_inr"),
    supabase.from("quantity_discount_tiers").select("*").order("min_quantity"),
  ]);
  if (e1 || e2) throw new Error((e1 || e2)!.message);
  return (
    <Gate perms={perms} m="catalog">
      <div className="head"><div><h1>Pricing</h1><p className="muted">Changes apply to new quotes straight away. Existing orders keep their price.</p></div></div>
      <div className="card">
        <h2>Materials</h2>
        <p className="muted">Names, descriptions, colours and rates customers see in the shop, quote tool and homepage.</p>
        {(mats ?? []).map((m) => (
          <details key={m.material_code} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
            <summary className="row" style={{ cursor: "pointer", justifyContent: "space-between" }}>
              <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 6, background: m.swatch_hex || "var(--blue)", marginRight: 8 }} /><b>{m.display_name}</b> <span className="muted">{label(m.technology)}</span></span>
              <span className="row"><span className="mono">₹{m.retail_rate_per_gram_inr}/g · ₹{m.machine_hour_rate_inr}/h</span>{m.is_active ? <span className="pill ok">Live</span> : <span className="pill bad">Hidden</span>}</span>
            </summary>
            <form action={updateMaterial} style={{ display: "grid", gap: 12, marginTop: 10 }}>
              <input type="hidden" name="code" value={m.material_code} />
              <div className="form">
                <label className="f">Name shown to customers<input name="display_name" defaultValue={m.display_name} /></label>
                <label className="f">Best for (one line)<input name="best_for" defaultValue={m.best_for ?? ""} maxLength={160} /></label>
                <label className="f">Card colour<input name="swatch" type="color" defaultValue={m.swatch_hex || "#2f6fed"} style={{ height: 40 }} /></label>
                <label className="f">Sort order<input name="sort" type="number" defaultValue={m.sort_order ?? 100} /></label>
                <label className="f">₹ per gram<input name="rate" type="number" step="0.01" min="0" defaultValue={m.retail_rate_per_gram_inr} /></label>
                <label className="f">Machine ₹ per hour<input name="mh" type="number" step="0.01" min="0" defaultValue={m.machine_hour_rate_inr} /></label>
                <label className="f">Print speed g/h<input name="speed" type="number" step="0.01" min="1" defaultValue={m.print_speed_grams_per_hr} /></label>
                <label className="f">Setup fee ₹<input name="setup" type="number" step="1" min="0" defaultValue={m.base_setup_fee_inr} /></label>
                <label className="f">Minimum order ₹<input name="moq" type="number" step="1" min="0" defaultValue={m.minimum_order_value_inr} /></label>
              </div>
              <label className="f">Description<textarea name="description" defaultValue={m.description ?? ""} maxLength={1000} /></label>
              <label className="f">Colours offered (one per line: Name, #hex)<textarea name="colors" rows={5} defaultValue={(Array.isArray(m.colors) ? m.colors : []).map((c: any) => `${c[0]}, ${c[1]}`).join("\n")} placeholder={"Matte Black, #1d1f21\nWhite, #f2f2ee"} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: ".82rem" }} /><span className="muted" style={{ fontWeight: 400 }}>Leave empty to use the standard colour list.</span></label>
              <div className="row"><label className="row"><input name="active" type="checkbox" defaultChecked={m.is_active} style={{ width: "auto" }} />Offered to customers</label><button className="btn sm">Save material</button></div>
            </form>
          </details>
        ))}
      </div>
      <div className="card">
        <h2>Batch discount tiers</h2>
        <div className="tw"><table>
          <thead><tr><th>Quantity</th><th>Discount % · Label · Live</th></tr></thead>
          <tbody>{(tiers ?? []).map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.min_quantity}{t.max_quantity ? `–${t.max_quantity}` : "+"} pcs</td>
              <td><form action={updateTier} className="inline">
                <input type="hidden" name="id" value={t.id} />
                <input name="pct" type="number" step="0.5" min="0" max="80" defaultValue={t.discount_percentage} style={{ width: 90 }} />
                <input name="label" defaultValue={t.tier_badge_label} style={{ width: 260 }} />
                <input name="active" type="checkbox" defaultChecked={t.is_active} style={{ width: "auto" }} />
                <button className="btn sm">Save</button>
              </form></td>
            </tr>))}</tbody>
        </table></div>
      </div>
    </Gate>
  );
}
