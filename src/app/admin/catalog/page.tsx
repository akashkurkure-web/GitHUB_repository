import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { inr, label } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import { can } from "@/lib/permissions";

export default async function Catalog({ searchParams }: { searchParams: { q?: string } }) {
  const { supabase, perms } = await requireAdmin();
  let q = supabase.from("catalog_products").select("*").order("sort_order").order("name");
  const term = (searchParams.q ?? "").replace(/[,()%*\\]/g, "").trim();
  if (term) q = q.or(`name.ilike.%${term}%,category.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (
    <>
      <div className="head"><div><h1>Shop products</h1><p className="muted">Ready-made parts customers can find with search and order without uploading a file.</p></div>
        <div className="row">
          <form className="inline"><input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search products" /><button className="btn sm ghost">Search</button></form>
          {can(perms, "catalog") && <Link className="btn" href="/admin/catalog/new">+ New product</Link>}
        </div></div>
      <div className="tw"><table>
        <thead><tr><th /><th>Product</th><th>Category</th><th>Default material</th><th className="r">Price</th><th>STL</th><th>Status</th></tr></thead>
        <tbody>{(data ?? []).map((p: any) => (
          <tr key={p.id}>
            <td style={{ width: 64 }}>{p.image_paths?.[0] ? <img src={mediaUrl(p.image_paths[0])} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8 }} /> : <span className="muted">—</span>}</td>
            <td><Link href={`/admin/catalog/${p.id}`}><b>{p.name}</b></Link><div className="muted mono">/shop/{p.slug}</div></td>
            <td>{p.category}</td><td>{label(p.default_material)}</td>
            <td className="r num">{p.fixed_unit_price_inr ? inr(p.fixed_unit_price_inr) : <span className="muted">from STL</span>}</td>
            <td>{p.cad_asset_id ? <span className="pill ok">{Number(p.volume_cm3 ?? 0).toFixed(1)} cm³</span> : <span className="pill bad">Missing</span>}</td>
            <td>{p.is_published ? <span className="pill ok">Live</span> : <span className="pill info">Draft</span>}{p.is_featured && <span className="pill warn" style={{ marginLeft: 4 }}>Featured</span>}</td>
          </tr>))}
          {!data?.length && <tr><td colSpan={7} className="empty">No products yet. Add your first ready-made part.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
