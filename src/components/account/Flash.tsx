export default function Flash({ sp }: { sp: { ok?: string; err?: string; msg?: string; paid?: string; placed?: string } }) {
  if (sp.paid) return <div className="notice" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>Payment received. Your GST invoice is ready below and printing will be scheduled shortly.</div>;
  if (sp.placed) return <div className="notice" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>Order placed.</div>;
  if (sp.ok) return <div className="notice" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>{sp.ok}</div>;
  if (sp.err || sp.msg) return <div className="alert">{sp.err || sp.msg}</div>;
  return null;
}
