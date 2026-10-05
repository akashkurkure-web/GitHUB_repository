"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Password() {
  const [p, setP] = useState(""), [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (p.length < 8) return setMsg({ t: "Use at least 8 characters.", ok: false });
    const { error } = await createClient().auth.updateUser({ password: p });
    setMsg(error ? { t: error.message, ok: false } : { t: "Password updated.", ok: true });
  }
  return (
    <form onSubmit={save} className="card" style={{ maxWidth: 420 }}>
      <h2>Set a new password</h2>
      {msg && <div className={msg.ok ? "notice" : "alert"}>{msg.t}</div>}
      <label className="f">New password<input id="newpw" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></label>
      <div><button className="btn">Update password</button></div>
    </form>
  );
}
