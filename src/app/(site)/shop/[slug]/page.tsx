import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { publicClient } from "@/lib/supabase/public";
import { loadCatalog } from "@/lib/orders";
import { getSite } from "@/lib/site";
import { mediaUrl } from "@/lib/media";
import ProductOrder from "@/components/site/ProductOrder";

export const dynamic = "force-dynamic";
async function load(slug: string) {
  const { data } = await publicClient().from("catalog_products").select("*").eq("slug", slug).eq("is_published", true).maybeSingle();
  return data;
}
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await load(params.slug);
  return p ? { title: p.name, description: p.short_description || undefined, openGraph: p.image_paths?.[0] ? { images: [mediaUrl(p.image_paths[0])] } : undefined } : {};
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const p = await load(params.slug);
  if (!p || !p.cad_asset_id) notFound();
  const [{ materials, tiers }, { settings }] = await Promise.all([loadCatalog(publicClient() as any), getSite()]);
  const allowed = materials.filter((m) => !p.allowed_materials?.length || p.allowed_materials.includes(m.material_code));
  return (
    <main className="wrap page">
      <nav className="muted" style={{ fontSize: ".85rem" }}><Link href="/shop">Shop</Link> › <Link href={`/shop?cat=${encodeURIComponent(p.category)}`}>{p.category}</Link> › {p.name}</nav>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="gallery">
          <div className="main">{p.image_paths?.[0] ? <img src={mediaUrl(p.image_paths[0])} alt={p.name} /> : <span className="muted">Photo coming soon</span>}</div>
          {p.image_paths?.length > 1 && <div className="thumbs">{p.image_paths.slice(1).map((x: string) => <img key={x} src={mediaUrl(x)} alt="" />)}</div>}
          {p.description && <div className="card"><h3>About this part</h3><p style={{ whiteSpace: "pre-line" }}>{p.description}</p></div>}
          {p.bbox_mm && <div className="card"><dl className="kv"><dt>Size</dt><dd className="mono">{p.bbox_mm.map((x: number) => Number(x).toFixed(1)).join(" × ")} mm</dd><dt>Dispatch</dt><dd>within {p.lead_time_days} days</dd><dt>Shipping</dt><dd>₹{settings.shipping_inr} across India{settings.express_enabled && `, same-day in MMR ₹${settings.express_inr}`}</dd></dl></div>}
        </div>
        <ProductOrder product={{ id: p.id, slug: p.slug, name: p.name, cad_asset_id: p.cad_asset_id, volume_cm3: Number(p.volume_cm3 ?? 0), bbox_mm: (p.bbox_mm ?? [0, 0, 0]).map(Number), default_material: p.default_material, default_color: p.default_color, default_infill: p.default_infill, fixed_unit_price_inr: p.fixed_unit_price_inr != null ? Number(p.fixed_unit_price_inr) : null, waive_setup_fee: p.waive_setup_fee, category: p.category, short_description: p.short_description }} materials={allowed} tiers={tiers} />
      </div>
    </main>
  );
}
