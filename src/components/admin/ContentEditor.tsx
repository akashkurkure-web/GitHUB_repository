"use client";
import { useState } from "react";
import type { Section } from "@/lib/content";

export default function ContentEditor({ section, value, action, disabled }: { section: Section; value: any; action: (f: FormData) => void; disabled?: boolean }) {
  const [v, setV] = useState<any>(value);
  const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return (
    <form action={action} className="card" style={{ gap: 16 }}>
      <input type="hidden" name="key" value={section.key} />
      <input type="hidden" name="json" value={JSON.stringify(v)} />
      <fieldset disabled={disabled} className="gate" style={{ gap: 16 }}>
        {section.fields.map((f) => {
          if (f.type === "bool") return (
            <label key={f.k} className="row" style={{ fontWeight: 600 }}><input type="checkbox" checked={Boolean(v[f.k])} onChange={(e) => set(f.k, e.target.checked)} style={{ width: "auto" }} />{f.label}</label>
          );
          if (f.type === "list") {
            const rows: any[] = Array.isArray(v[f.k]) ? v[f.k] : [];
            const upd = (i: number, k: string, x: string) => set(f.k, rows.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
            const move = (i: number, d: number) => { const n = [...rows]; const [r] = n.splice(i, 1); n.splice(i + d, 0, r); set(f.k, n); };
            return (
              <div key={f.k} style={{ display: "grid", gap: 8 }}>
                <span className="f">{f.label} <span className="muted" style={{ fontWeight: 400 }}>({rows.length}{f.maxItems ? ` of ${f.maxItems}` : ""})</span></span>
                {rows.map((r, i) => (
                  <div key={i} className="editor-row">
                    <div className="form" style={{ gridTemplateColumns: f.of.length > 1 && f.of.every((c) => c.type === "text") ? "repeat(auto-fit,minmax(160px,1fr))" : "1fr" }}>
                      {f.of.map((c) => (
                        <label key={c.k} className="f">{c.label}
                          {c.type === "text" ? <input value={r?.[c.k] ?? ""} maxLength={c.max} onChange={(e) => upd(i, c.k, e.target.value)} />
                            : <textarea value={r?.[c.k] ?? ""} maxLength={c.max} rows={c.type === "lines" ? 4 : 3} onChange={(e) => upd(i, c.k, e.target.value)} />}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                      <button type="button" className="btn sm ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                      <button type="button" className="btn sm ghost" onClick={() => set(f.k, rows.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                    </div>
                  </div>
                ))}
                {(!f.maxItems || rows.length < f.maxItems) && <div><button type="button" className="btn sm ghost" onClick={() => set(f.k, [...rows, Object.fromEntries(f.of.map((c) => [c.k, ""]))])}>+ Add</button></div>}
              </div>
            );
          }
          return (
            <label key={f.k} className="f">{f.label}
              {f.type === "text" ? <input value={v[f.k] ?? ""} maxLength={f.max} onChange={(e) => set(f.k, e.target.value)} />
                : <textarea value={v[f.k] ?? ""} maxLength={f.max} rows={f.k === "body" ? 22 : f.type === "lines" ? 5 : 3} onChange={(e) => set(f.k, e.target.value)} style={f.k === "body" ? { fontFamily: "JetBrains Mono, monospace", fontSize: ".82rem" } : undefined} />}
              {"help" in f && f.help && <span className="muted" style={{ fontWeight: 400 }}>{f.help}</span>}
            </label>
          );
        })}
        <div className="row"><button className="btn">Save and publish</button><span className="muted">Changes go live on the website straight away.</span></div>
      </fieldset>
    </form>
  );
}
