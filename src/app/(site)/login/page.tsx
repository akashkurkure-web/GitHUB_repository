"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ERR: Record<string, string> = {
  not_admin: "That account isn't an admin. Sign in with an admin account.",
  not_vendor: "That account isn't a print partner account.",
  vendor_inactive: "Your partner account is paused or not set up yet. Contact the Layer27 team.",
};

function Login() {
  const params = useSearchParams();
  const next = params.get("next") || "";
  const staff = next.startsWith("/admin");
  const partner = next.startsWith("/vendor");
  const [tab, setTab] = useState<"in" | "up" | "reset">(params.get("tab") === "up" ? "up" : "in");
  const [f, setF] = useState({ name: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(params.get("error") ? { t: ERR[params.get("error")!] || "Please sign in again.", ok: false } : null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const sb = createClient();
  useEffect(() => { sb.auth.getUser().then(({ data }) => setSignedIn(data.user?.email ?? null)); }, []); // eslint-disable-line
  const go = () => { window.location.href = `/auth/redirect${next ? `?next=${encodeURIComponent(next)}` : ""}`; };
  const base = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    if (tab === "in") {
      const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
      setBusy(false);
      if (error) return setMsg({ t: error.message === "Invalid login credentials" ? "Email or password is wrong." : error.message, ok: false });
      return go();
    }
    if (tab === "up") {
      if (f.password.length < 8) { setBusy(false); return setMsg({ t: "Use at least 8 characters for the password.", ok: false }); }
      const { data, error } = await sb.auth.signUp({
        email: f.email, password: f.password,
        options: { data: { full_name: f.name, phone: f.phone }, emailRedirectTo: `${base}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}` },
      });
      setBusy(false);
      if (error) return setMsg({ t: error.message, ok: false });
      if (data.session) return go();
      return setMsg({ t: "Check your email and click the confirmation link to finish creating your account.", ok: true });
    }
    const { error } = await sb.auth.resetPasswordForEmail(f.email, { redirectTo: `${base}/auth/callback?next=/account/password` });
    setBusy(false);
    setMsg(error ? { t: error.message, ok: false } : { t: "If that email has an account, a reset link is on its way.", ok: true });
  }

  async function google() {
    await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${base}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}` } });
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <main className="wrap page" style={{ maxWidth: 440 }}>
      <form onSubmit={submit} className="card" style={{ padding: 28, gap: 16 }}>
        <div style={{ display: "grid", gap: 4 }}>
          {(staff || partner) && <span className="pill info" style={{ justifySelf: "start" }}>{staff ? "Back office · staff only" : "Print partner portal"}</span>}
          <h1>{tab === "up" ? (staff ? "Activate your staff account" : "Create your account") : tab === "reset" ? "Reset password" : staff ? "Staff sign in" : partner ? "Partner sign in" : "Sign in"}</h1>
          <p className="muted">{staff ? "Use the email the owner invited. Customers can't open the back office." : partner ? "Use the email registered with Layer27." : next.startsWith("/checkout") ? "Sign in to finish your order. Your cart and uploaded files are kept." : "Track orders, re-order, earn rewards. Or keep shopping as a guest."}</p>
        </div>
        {signedIn && <div className="notice">Signed in as {signedIn}. <a href="#" onClick={async (e) => { e.preventDefault(); await sb.auth.signOut(); setSignedIn(null); }}>Sign out</a> or <a href="/auth/redirect">continue</a>.</div>}
        {msg && <div className={msg.ok ? "notice" : "alert"}>{msg.t}</div>}
        {tab !== "reset" && <div className="seg">
          <button type="button" aria-pressed={tab === "in"} onClick={() => setTab("in")}>Sign in</button>
          <button type="button" aria-pressed={tab === "up"} onClick={() => setTab("up")}>Create account</button>
        </div>}
        {tab === "up" && <>
          <label className="f">Full name<input id="name" required value={f.name} onChange={set("name")} autoComplete="name" /></label>
          <label className="f">Mobile number<input id="phone" required value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="+91" /></label>
        </>}
        <label className="f">Email<input id="email" type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></label>
        {tab !== "reset" && <label className="f">Password<input id="password" type="password" required value={f.password} onChange={set("password")} autoComplete={tab === "up" ? "new-password" : "current-password"} /></label>}
        <button className="btn lg" type="submit" disabled={busy}>{busy ? "Please wait…" : tab === "in" ? "Sign in" : tab === "up" ? "Create account" : "Send reset link"}</button>
        {tab !== "reset" && <button className="btn lg ghost" type="button" onClick={google}>Continue with Google</button>}
        {!staff && !partner && <p className="muted" style={{ fontSize: ".82rem" }}><a href="/shop">Continue as a guest →</a></p>}
        <p className="muted" style={{ fontSize: ".82rem" }}>
          {tab === "reset" ? <a href="#" onClick={(e) => { e.preventDefault(); setTab("in"); }}>Back to sign in</a> : <a href="#" onClick={(e) => { e.preventDefault(); setTab("reset"); }}>Forgot password?</a>}
        </p>
      </form>
    </main>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
