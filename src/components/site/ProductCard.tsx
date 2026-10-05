import Link from "next/link";
import { mediaUrl } from "@/lib/media";

export default function ProductCard({ p, price }: { p: any; price: string | null }) {
  return (
    <Link href={`/shop/${p.slug}`} className="product">
      <div className="ph">{p.image_paths?.[0] ? <img src={mediaUrl(p.image_paths[0])} alt={p.name} loading="lazy" /> :
        <svg width="64" height="64" viewBox="0 0 30 30" aria-hidden="true"><rect x="3" y="20" width="24" height="5" rx="1.5" fill="#ff8a3d" /><rect x="6" y="13" width="18" height="5" rx="1.5" fill="#ffc15e" /><rect x="9" y="6" width="12" height="5" rx="1.5" fill="#34d1c9" /></svg>}</div>
      <div className="body">
        <span className="muted" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>{p.category}</span>
        <b>{p.name}</b>
        {p.short_description && <span className="muted" style={{ fontSize: ".85rem" }}>{p.short_description}</span>}
        {price && <span className="price">from {price}</span>}
        <span className="muted" style={{ fontSize: ".78rem" }}>Dispatch in {p.lead_time_days} days</span>
      </div>
    </Link>
  );
}
