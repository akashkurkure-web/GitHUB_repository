import Link from "next/link";
import type { Metadata } from "next";
import PrintVideo from "@/components/site/PrintVideo";
import ProcessFlows from "@/components/site/ProcessFlows";
import ProductCard from "@/components/site/ProductCard";
import { getSite } from "@/lib/site";
import { lines } from "@/lib/content";
import { inrShort, productFrom, publishedProducts } from "@/lib/shop";

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> {
  const { content } = await getSite();
  return { title: { absolute: content.seo.title }, description: content.seo.description };
}
const MAT_COLOR: Record<string, string> = { pla: "var(--blue)", petg: "var(--teal)", abs: "var(--amber)", asa: "var(--accent)", tpu: "var(--green)", standard_resin: "var(--rose)", tough_resin: "#7c5cff" };
const USE: Record<string, string> = {
  pla: "Fast prototypes, fit checks, display models", petg: "Tough mechanical parts, mild outdoor use", abs: "Enclosures and parts near heat",
  asa: "Outdoor and automotive, UV stable", tpu: "Flexible gaskets, grips, bumpers", standard_resin: "Fine detail, miniatures, smooth surfaces", tough_resin: "Detailed functional parts and clips",
};
const ICONS = [
  <svg key="a" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  <svg key="b" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l6-6 4 4 8-8" /><path d="M3 21h18" /></svg>,
  <svg key="c" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>,
];

export default async function Home() {
  const [{ content: c }, { products, materials, tiers }] = await Promise.all([getSite(), publishedProducts()]);
  const featured = products.filter((p: any) => p.is_featured).slice(0, 4);
  const shown = featured.length ? featured : products.slice(0, 4);
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div className="hero-copy">
            <span className="eyebrow">{c.hero.eyebrow}</span>
            <h1>{c.hero.headline} {c.hero.highlight && <em>{c.hero.highlight}</em>}</h1>
            <p className="lede">{c.hero.subtitle}</p>
            <div className="row"><Link className="btn lg" href="/quote">{c.hero.primary_cta}</Link><Link className="btn lg light" href="/shop">{c.hero.secondary_cta}</Link></div>
            <form action="/shop" className="searchbar" role="search" style={{ maxWidth: 520 }}>
              <input name="q" placeholder="What do you need? e.g. cable clip, PETG, delivery time" aria-label="Search" />
              <button className="btn">Search</button>
            </form>
            <div className="stats">{(c.stats.items ?? []).slice(0, 4).map((s: any, i: number) => <div key={i}><b>{s.value}</b><span>{s.label}</span></div>)}</div>
          </div>
          <PrintVideo kind="fdm" autoplay label="Animation of an FDM printer building a part layer by layer" />
        </div>
      </section>

      {shown.length > 0 && (
        <section className="blk">
          <div className="wrap">
            <div className="head" style={{ marginBottom: 20 }}><div className="blk-head" style={{ margin: 0 }}><span className="eyebrow">Ready to order</span><h2>Popular parts</h2></div><Link className="btn ghost" href="/shop">See all products</Link></div>
            <div className="products">{shown.map((p: any) => { const pr = productFrom(p, materials, tiers); return <ProductCard key={p.id} p={p} price={pr ? inrShort(pr) : null} />; })}</div>
          </div>
        </section>
      )}

      <section className={`blk${shown.length ? " alt" : ""}`} id="watch">
        <div className="wrap">
          <div className="blk-head"><span className="eyebrow">See it in action</span><h2>{c.watch.heading}</h2><p className="lede">{c.watch.subtitle}</p></div>
          <div className="vids">
            <div className="vcard c-orange"><PrintVideo kind="fdm2" label="Animation of FDM printing a bracket" /><h3>{c.watch.fdm_title} <span className="pill info">PLA · PETG · ABS · ASA · TPU</span></h3><p className="muted">{c.watch.fdm_text}</p></div>
            <div className="vcard c-teal"><PrintVideo kind="resin" label="Animation of MSLA resin printing with UV exposure" /><h3>{c.watch.resin_title} <span className="pill ok">Standard · Tough</span></h3><p className="muted">{c.watch.resin_text}</p></div>
          </div>
        </div>
      </section>

      <section className={`blk${shown.length ? "" : " alt"}`} id="process">
        <div className="wrap">
          <div className="blk-head"><span className="eyebrow">Process flows</span><h2>{c.process.heading}</h2><p className="lede">{c.process.subtitle}</p></div>
          <ProcessFlows />
          <div className="blk-head" style={{ marginTop: 56 }}><span className="eyebrow">How we price</span><h3 style={{ fontSize: "1.4rem" }}>Your price is calculated from the file itself</h3></div>
          <div className="pflow">
            {[["c-blue", "Your STL", "Volume, size and mesh check"], ["c-teal", "Material mass", "volume × infill × density"], ["c-amber", "Print cost", "grams × rate + hours × machine rate"], ["c-orange", "Batch discount", "up to 28% off, setup once"], ["c-green", "GST invoice", "CGST + SGST or IGST at 18%"]].map(([cl, t, d]) => (
              <div key={t} className={`pf ${cl}`}><b>{t}</b><span>{d}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="blk alt" id="materials">
        <div className="wrap">
          <div className="blk-head"><span className="eyebrow">Material catalogue</span><h2>{materials.length} {c.materials_section.heading.replace(/^\d+\s*/, "")}</h2><p className="lede">{c.materials_section.subtitle}</p></div>
          <div className="mats">
            {materials.map((m) => (
              <div key={m.material_code} className="mat" style={{ ["--c" as string]: m.swatch_hex || MAT_COLOR[m.material_code] || "var(--blue)" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div><span className={`pill ${m.technology === "fdm" ? "info" : "warn"}`}>{m.technology === "fdm" ? "FDM" : "MSLA resin"}</span><h3 style={{ marginTop: 8 }}>{m.display_name}</h3></div>
                  <div className="spool" />
                </div>
                <p className="muted">{m.best_for || USE[m.material_code]}</p>
                <div className="price">₹{m.retail_rate_per_gram_inr.toFixed(2)} <small>per gram</small></div>
                <dl className="kv"><dt>Machine time</dt><dd className="mono">₹{m.machine_hour_rate_inr}/h</dd><dt>Density</dt><dd className="mono">{m.density_g_cm3.toFixed(2)} g/cm³</dd></dl>
              </div>
            ))}
          </div>
          <div className="blk-head" style={{ marginTop: 56 }}><span className="eyebrow">Batch pricing</span><h3 style={{ fontSize: "1.4rem" }}>Order more, pay less per part</h3></div>
          <div className="tiers">
            {tiers.map((t, i) => (
              <div key={t.min_quantity} className="tier"><div className="bar" style={{ height: 48 + i * 26 }}>{t.discount_percentage ? `${t.discount_percentage}%` : "List"}</div><span className="mono">{t.min_quantity}{t.max_quantity ? `–${t.max_quantity}` : "+"} pcs</span><span className="muted">{t.tier_badge_label}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="blk">
        <div className="wrap">
          <div className="blk-head"><span className="eyebrow">Why teams trust us</span><h2>{c.trust.heading}</h2></div>
          <div className="grid3">
            {(c.trust.cards ?? []).slice(0, 3).map((card: any, i: number) => (
              <div key={i} className={`feature ${["c-blue", "c-teal", "c-rose"][i]}`}><div className="badge">{ICONS[i]}</div><h3>{card.title}</h3><ul>{lines(card.points).map((pt) => <li key={pt}>{pt}</li>)}</ul></div>
            ))}
          </div>
        </div>
      </section>

      <section className="blk alt" id="business">
        <div className="wrap band">
          <div className="blk-head" style={{ margin: 0 }}>
            <span className="eyebrow">{c.business.eyebrow}</span>
            <h2>{c.business.heading}</h2>
            <p className="lede">{c.business.text}</p>
            <dl className="kv" style={{ marginTop: 14 }}>{(c.business.points ?? []).map((pt: any, i: number) => <span key={i} style={{ display: "contents" }}><dt>{pt.label}</dt><dd>{pt.value}</dd></span>)}</dl>
            <div><Link className="btn" href="/account/business">{c.business.cta}</Link></div>
          </div>
          <div className="refer">
            <span className="eyebrow">Invite a colleague</span>
            <h3 style={{ fontSize: "1.5rem" }}>{c.referral.heading}</h3>
            <p className="muted">{c.referral.text}</p>
            <span className="eyebrow" style={{ marginTop: 8 }}>After your first delivery</span>
            <p className="muted">{c.referral.review_text}</p>
            <div><Link className="btn navy" href="/account">Get your referral link</Link></div>
          </div>
        </div>
      </section>

      <section className="blk" id="faq">
        <div className="wrap">
          <div className="blk-head"><span className="eyebrow">Questions</span><h2>Before you order</h2></div>
          {(c.faq.items ?? []).map((f: any, i: number) => <details key={i} className="faq"><summary>{f.q}</summary><p>{f.a}</p></details>)}
          <p style={{ marginTop: 16 }}><Link href="/shop">Search all answers →</Link></p>
        </div>
      </section>
    </>
  );
}
