"use client";
import { useState } from "react";
export default function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="inline">
      <input readOnly value={text} onFocus={(e) => e.target.select()} style={{ flex: 1, fontFamily: "JetBrains Mono, monospace", fontSize: ".8rem" }} />
      <button className="btn sm" type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* select fallback */ } }}>{done ? "Copied" : "Copy"}</button>
    </div>
  );
}
