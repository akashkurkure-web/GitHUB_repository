import Link from "next/link";
import type { Metadata } from "next";
import ProductCard from "@/components/site/ProductCard";
import { fill, getSite } from "@/lib/site";
import { inrShort, productFrom, publishedProducts } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop & search", description: "Search ready-made 3D printed parts, materials and answers. Order online with GST invoice." };

const words = (q: string) => q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9+.-]/g, "")).filter((w) => w.length > 1);
const score = (text: string, ws: string[]) => { const t = text.toLowerCase(); return ws.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0); };
const snippet = (text: string, ws: string[]) => {
  const t = text.replace(/\s+/g, " "); const i = Math.max(0, ws.map((w) => t.toLowerCase().indexOf(w)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0);
  return (i > 60 ? "…" : "") + t.slice(Math.max(0, i - 60), i + 160) + "…";
};

export default async function Shop({ searchParams }: { searchParams: { q?: string; cat?: string; tech?: string; sort?: string } }) {
  const [{ content, biz }, { products, materials, tiers }] = await Promise.all([getSite(), publishedProducts()]);
  const q = (searchParams.q ?? "").slice(0, 100);
  const ws = words(q);
  const techOf = (p: any) => materials.find((m) => m.material_code === p.default_material)?.technology;
  const priced = products.map((p: any) => ({ p, price: productFrom(p, materials, tiers), s: ws.length ? score([p.name, p.category, p.short_description, p.description, (p.tags || []).join(" ")].join(" "), ws) : 1 }));
  let list = priced.filter((x) => x.s > 0);
  if (searchParams.cat) list = list.filter((x) => x.p.category === searchParams.cat);
  if (searchParams.tech) list = list.filter((x) => techOf(x.p) === searchParams.tech);
  list.sort((a, b) => searchParams.sort === "price" ? (a.price ?? 1e9) - (b.price ?? 1e9) : searchParams.sort === "name" ? a.p.name.localeCompare(b.p.name) : (b.s - a.s) || (a.p.sort_order - b.p.sort_order));
  const cats = Array.from(new Set(products.map((p: any) => p.category))).sort();

  // Answers: FAQ, materials, policies
  type A = { title: string; text: string; href: string; c: string; tag: string; s: number };
  const answers: A[] = [];
  if (ws.length) {
    for (const f of content.faq.items ?? []) { const s = score(`${f.q} ${f.q} ${f.a}`, ws); if (s) answers.push({ title: f.q, text: f.a, href: "/#faq", c: "var(--blue)", tag: "FAQ", s: s + 1 }); }
    for (const m of materials) { const s = score(`${m.display_name} ${m.material_code} ${m.best_for ?? ""} ${m.description ?? ""} ${m.technology === "fdm" ? "fdm filament" : "resin msla"}`, ws); if (s) answers.push({ title: `${m.display_name} — ₹${m.retail_rate_per_gram_inr}/g`, text: m.best_for || m.description || (m.technology === "fdm" ? "FDM material" : "8K resin material"), href: "/#materials", c: "var(--teal)", tag: "Material", s }); }
    for (const slug of ["shipping", "refunds", "terms", "privacy"]) {
      const page = content[`legal.${slug}`]; const body = fill(page.body, biz);
      for (const block of body.split(/\n(?=## )/)) { const s = score(block, ws); if (s >= Math.min(2, ws.length)) answers.push({ title: `${page.title}: ${block.split("\n")[0].replace(/^## /, "")}`, text: snippet(block.split("\n").slice(1).join(" "), ws), href: `/legal/${slug}`, c: "var(--amber)", tag: "Policy", s }); }
    }
    answers.sort((a, b) => b.s - a.s);
  }
  const link = (k: string, v?: string) => { const u = new URLSearchParams(Object.entries({ ...searchParams, [k]: v ?? "" }).filter(([, x]) => x) as [string, string][]); return `/shop${u.toString() ? `?${u}` : ""}`; };

  return (
    <main className="wrap page">
      <div className="blk-head" style={{ marginBottom: 0 }}><span className="eyebrow">Shop &amp; search</span><h2>{content.shop.heading}</h2><p className="lede">{content.shop.subtitle}</p></div>
      <form className="searchbar" role="search">
        <input name="q" defaultValue={q} placeholder="Try: phone stand, PETG, GST invoice, delivery to Pune" aria-label="Search" autoFocus={!q} />
        {searchParams.cat && <input type="hidden" name="cat" value={searchParams.cat} />}
        <button className="btn">Search</button>
      </form>

      {answers.length > 0 && (
        <section style={{ display: "grid", gap: 10 }}>
          <h3>Answers</h3>
          <div className="answers">{answers.slice(0, 5).map((a, i) => (
            <Link key={i} href={a.href} className="answer" style={{ ["--c" as string]: a.c, color: "inherit" }}><span className="muted" style={{ fontSize: ".7rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>{a.tag}</span><b>{a.title}</b><span className="muted" style={{ fontSize: ".88rem" }}>{a.text.length > 240 ? a.text.slice(0, 240) + "…" : a.text}</span></Link>
          ))}</div>
        </section>
      )}

      <div className="shop">
        <aside className="facets">
          <div><b>Category</b><Link href={link("cat")} className={!searchParams.cat ? "on" : ""}>All</Link>{cats.map((c) => <Link key={c} href={link("cat", c)} className={searchParams.cat === c ? "on" : ""}>{c}</Link>)}</div>
          <div><b>Process</b><Link href={link("tech")} className={!searchParams.tech ? "on" : ""}>Any</Link><Link href={link("tech", "fdm")} className={searchParams.tech === "fdm" ? "on" : ""}>FDM (strong)</Link><Link href={link("tech", "msla_resin")} className={searchParams.tech === "msla_resin" ? "on" : ""}>Resin (fine detail)</Link></div>
          <div><b>Sort</b><Link href={link("sort")} className={!searchParams.sort ? "on" : ""}>Best match</Link><Link href={link("sort", "price")} className={searchParams.sort === "price" ? "on" : ""}>Price: low to high</Link><Link href={link("sort", "name")} className={searchParams.sort === "name" ? "on" : ""}>Name</Link></div>
        </aside>
        <section style={{ display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
          <p className="muted">{list.length} {list.length === 1 ? "product" : "products"}{q && <> for “{q}”</>}</p>
          {list.length ? <div className="products">{list.map(({ p, price }) => <ProductCard key={p.id} p={p} price={price ? inrShort(price) : null} />)}</div> : (
            <div className="card" style={{ textAlign: "center" }}>
              <h3>No ready-made part matches{q && ` “${q}”`}</h3>
              <p className="muted">Upload your own design and get a price in seconds, or ask us to make it.</p>
              <div className="row" style={{ justifyContent: "center" }}><Link className="btn" href="/quote">Upload a design</Link><Link className="btn ghost" href="/account/support">Ask an engineer</Link></div>
            </div>
          )}
          <div className="card" style={{ background: "var(--accent-soft)" }}>
            <div className="head"><div><b>Have your own design?</b><p className="muted">Upload an STL for an instant price in any material.</p></div><Link className="btn" href="/quote">Instant quote</Link></div>
          </div>
        </section>
      </div>
    </main>
  );
}
