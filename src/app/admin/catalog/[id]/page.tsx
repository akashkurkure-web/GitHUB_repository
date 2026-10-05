import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { inr, label } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import { loadCatalog } from "@/lib/orders";
import { priceItem } from "@/lib/pricing";
import Gate from "@/components/Gate";
import { saveProduct, uploadProductStl, uploadProductImages, productImageAction, deleteProduct } from "../../actions";

export default async function EditProduct({ params, searchParams }: { params: { id: string }; searchParams: { new?: string } }) {
  const { supabase, perms } = await requireAdmin();
  const isNew = params.id === "new";
  const { data: p } = isNew ? { data: null as any } : await supabase.from("catalog_products").select("*, cad_assets(file_name, volume_cm3, bounding_box_x_mm, bounding_box_y_mm, bounding_box_z_mm, is_watertight)").eq("id", params.id).maybeSingle();
  if (!isNew && !p) notFound();
  const { materials, tiers } = await loadCatalog(supabase as any);
  const { data: cats } = await supabase.from("catalog_products").select("category");
  const categories = Array.from(new Set((cats ?? []).map((c) => c.category))).sort();
  const def = materials.find((m) => m.material_code === (p?.default_material ?? "pla")) ?? materials[0];
  const vol = Number(p?.volume_cm3 ?? p?.cad_assets?.volume_cm3 ?? 0);
  const preview = vol && def ? priceItem(vol, def, { material: def.material_code, color: "", infill: p?.default_infill ?? 25, layer: def.technology === "fdm" ? 0.2 : 0.05, quantity: 1, selection_mode: "manual_user" }, tiers, { fixedUnit: p?.fixed_unit_price_inr ? Number(p.fixed_unit_price_inr) : null, setup: p?.waive_setup_fee ? 0 : undefined }) : null;

  return (
    <Gate perms={perms} m="catalog">
      <div className="head">
        <div><Link href="/admin/catalog" className="muted">← Shop products</Link><h1>{isNew ? "New product" : p.name}</h1>
          {!isNew && <p className="muted">{p.is_published ? <a href={`/shop/${p.slug}`} target="_blank">View in shop ↗</a> : "Draft — not visible to customers"}</p>}</div>
        {!isNew && <form action={deleteProduct}><input type="hidden" name="id" value={p.id} /><button className="btn ghost">Delete product</button></form>}
      </div>
      {searchParams.new && <div className="notice">Product created. Now upload its STL file and photos, then tick “Published”.</div>}

      <form action={saveProduct} className="card">
        <h2>Details</h2>
        {!isNew && <input type="hidden" name="id" value={p.id} />}
        <div className="form">
          <label className="f">Name<input name="name" required defaultValue={p?.name ?? ""} maxLength={120} /></label>
          <label className="f">Web address (slug)<input name="slug" defaultValue={p?.slug ?? ""} placeholder="made from the name" /></label>
          <label className="f">Category<input name="category" list="cats" defaultValue={p?.category ?? "General"} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label className="f">Search tags (comma separated)<input name="tags" defaultValue={(p?.tags ?? []).join(", ")} placeholder="cable, clip, desk" /></label>
        </div>
        <label className="f">Short description (shown on cards)<input name="short_description" defaultValue={p?.short_description ?? ""} maxLength={200} /></label>
        <label className="f">Full description<textarea name="description" rows={5} defaultValue={p?.description ?? ""} /></label>
        <h2>Printing &amp; price</h2>
        <div className="form">
          <label className="f">Default material<select name="default_material" defaultValue={p?.default_material ?? "pla"}>{materials.map((m) => <option key={m.material_code} value={m.material_code}>{m.display_name}</option>)}</select></label>
          <label className="f">Default colour<input name="default_color" defaultValue={p?.default_color ?? ""} placeholder="Matte Black" /></label>
          <label className="f">Default infill %<input name="default_infill" type="number" min={20} max={100} defaultValue={p?.default_infill ?? 25} /></label>
          <label className="f">Fixed price per piece ₹ (blank = from STL)<input name="fixed_unit_price_inr" type="number" step="0.01" min={0} defaultValue={p?.fixed_unit_price_inr ?? ""} /></label>
          <label className="f">Dispatch in (days)<input name="lead_time_days" type="number" min={1} defaultValue={p?.lead_time_days ?? 3} /></label>
          <label className="f">Sort order<input name="sort_order" type="number" defaultValue={p?.sort_order ?? 100} /></label>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <span className="f">Materials customers may choose (none ticked = all)</span>
          <div className="row">{materials.map((m) => <label key={m.material_code} className="row" style={{ fontSize: ".85rem" }}><input type="checkbox" name="allowed" value={m.material_code} defaultChecked={p?.allowed_materials?.includes(m.material_code)} style={{ width: "auto" }} />{m.display_name}</label>)}</div>
        </div>
        <div className="row">
          <label className="row"><input type="checkbox" name="waive_setup_fee" defaultChecked={p?.waive_setup_fee ?? true} style={{ width: "auto" }} />No setup fee</label>
          <label className="row"><input type="checkbox" name="is_featured" defaultChecked={p?.is_featured} style={{ width: "auto" }} />Featured on homepage</label>
          <label className="row"><input type="checkbox" name="is_published" defaultChecked={p?.is_published} style={{ width: "auto" }} disabled={!p?.cad_asset_id} />Published {!p?.cad_asset_id && <span className="muted">(upload the STL first)</span>}</label>
        </div>
        {preview && <div className="notice">Customer price for 1 piece in {def.display_name}: <b>{inr(preview.line)}</b> before shipping and GST ({preview.mass} g, {preview.hours} h print).</div>}
        <div><button className="btn">{isNew ? "Create product" : "Save details"}</button></div>
      </form>

      {!isNew && (
        <div className="grid2">
          <form action={uploadProductStl} className="card">
            <h2>3D file</h2>
            <input type="hidden" name="id" value={p.id} />
            {p.cad_assets ? <dl className="kv"><dt>File</dt><dd><a href={`/api/files/cad/${p.cad_asset_id}`}>{p.cad_assets.file_name}</a></dd><dt>Size</dt><dd className="mono">{[p.cad_assets.bounding_box_x_mm, p.cad_assets.bounding_box_y_mm, p.cad_assets.bounding_box_z_mm].join(" × ")} mm</dd><dt>Volume</dt><dd className="mono">{Number(p.cad_assets.volume_cm3).toFixed(2)} cm³{p.cad_assets.is_watertight === false && " · needs repair"}</dd></dl>
              : <p className="alert">No STL yet. The product can&apos;t be published or ordered without one.</p>}
            <label className="f">{p.cad_assets ? "Replace STL" : "Upload STL"} (under 4.5 MB)<input type="file" name="stl" accept=".stl" required /></label>
            <label className="row" style={{ fontSize: ".85rem" }}><input type="checkbox" name="inches" style={{ width: "auto" }} />File is in inches</label>
            <div><button className="btn">Upload STL</button></div>
          </form>
          <div className="card">
            <h2>Photos</h2>
            <div className="thumbs">
              {(p.image_paths ?? []).map((path: string, i: number) => (
                <div key={path} style={{ display: "grid", gap: 4, justifyItems: "center" }}>
                  <img src={mediaUrl(path)} alt="" />
                  <div className="inline">
                    {i > 0 && <form action={productImageAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="path" value={path} /><input type="hidden" name="op" value="cover" /><button className="btn sm ghost" title="Make cover">★</button></form>}
                    <form action={productImageAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="path" value={path} /><input type="hidden" name="op" value="remove" /><button className="btn sm ghost" title="Remove">✕</button></form>
                  </div>
                </div>
              ))}
              {!p.image_paths?.length && <p className="muted">No photos yet. The shop shows a placeholder.</p>}
            </div>
            <form action={uploadProductImages} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={p.id} />
              <label className="f">Add photos (JPG/PNG/WEBP, under 4.5 MB total)<input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple required /></label>
              <div><button className="btn">Upload photos</button></div>
            </form>
          </div>
        </div>
      )}
    </Gate>
  );
}
