"use client";
import { useState } from "react";
import { MODULES, PRESETS } from "@/lib/permissions";

export default function AccessPicker({ role = "support_agent", perms = [] as string[], isOwnerActor }: { role?: string; perms?: string[]; isOwnerActor: boolean }) {
  const [r, setR] = useState(role);
  const shown = r === "custom" ? perms : PRESETS[r]?.perms ?? [];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label className="f">Role
        <select name="staff_role" value={r} onChange={(e) => setR(e.target.value)}>
          {Object.entries(PRESETS).filter(([k]) => isOwnerActor || k !== "owner").map(([k, p]) => <option key={k} value={k}>{p.label} — {p.desc}</option>)}
        </select>
      </label>
      {r === "custom" && (
        <div className="form" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))" }}>
          {Object.entries(MODULES).filter(([k]) => isOwnerActor || k !== "team").map(([k, m]) => (
            <label key={k} className="row" style={{ fontSize: ".84rem", alignItems: "flex-start" }}>
              <input type="checkbox" name="perm" value={k} defaultChecked={perms.includes(k)} style={{ width: "auto", marginTop: 3 }} />
              <span><b>{m.label}</b><br /><span className="muted">{m.desc}</span></span>
            </label>
          ))}
        </div>
      )}
      {r !== "custom" && <span className="muted" style={{ fontSize: ".82rem" }}>Can change: {shown.includes("*") ? "everything" : shown.map((m) => MODULES[m as keyof typeof MODULES]?.label).join(", ")}</span>}
    </div>
  );
}
