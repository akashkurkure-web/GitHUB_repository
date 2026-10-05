import Link from "next/link";
import { getSite } from "@/lib/site";
import { lines } from "@/lib/content";
export const metadata = { title: "Become a print partner" };
export default async function Partners() {
  const { content, biz } = await getSite();
  const c = content.partners;
  return (
    <main className="wrap page">
      <div className="band">
        <div className="panel-navy">
          <span className="eyebrow">Print partner programme</span>
          <h2>{c.heading}</h2>
          <p style={{ color: "var(--on-navy-muted)" }}>{c.intro}</p>
          <dl className="kv"><dt>Payout</dt><dd>Weekly, every Monday, NEFT or IMPS</dd><dt>Dispatch</dt><dd>48 h standard, 72 h batch and resin</dd><dt>Materials</dt><dd>You supply filament and resin</dd><dt>GST</dt><dd>Released once it shows in our GSTR-2B</dd></dl>
          <div><Link className="btn" href="/partner-login">Partner sign in</Link></div>
        </div>
        <div className="legal">
          <h2>How to join</h2>
          <ol className="muted" style={{ display: "grid", gap: 8 }}>{lines(c.steps).map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="muted">Email: <b className="mono">{biz?.support_email}</b></p>
          <h2>What you need</h2>
          <ul className="muted" style={{ display: "grid", gap: 6 }}>{lines(c.requirements).map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      </div>
    </main>
  );
}
