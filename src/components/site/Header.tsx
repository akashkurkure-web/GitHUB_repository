"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readCart } from "@/lib/cart";
import { createClient } from "@/lib/supabase/client";

export default function Header({ role, name }: { role: string | null; name?: string | null }) {
  const router = useRouter();
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const u = () => setN(readCart().length);
    u();
    window.addEventListener("l27-cart", u);
    window.addEventListener("storage", u);
    return () => { window.removeEventListener("l27-cart", u); window.removeEventListener("storage", u); };
  }, []);
  async function signOut() { await createClient().auth.signOut(); setOpen(false); router.replace("/"); router.refresh(); }
  return (
    <header className="topbar">
      <div className="wrap">
        <Link className="logo" href="/">
          <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true"><rect x="3" y="20" width="24" height="5" rx="1.5" fill="#ff8a3d" /><rect x="6" y="13" width="18" height="5" rx="1.5" fill="#ffc15e" /><rect x="9" y="6" width="12" height="5" rx="1.5" fill="#34d1c9" /></svg>
          Layer27 <small>MH·27</small>
        </Link>
        <form action="/shop" className="topsearch" role="search">
          <input name="q" placeholder="Search parts, materials, help" aria-label="Search" />
          <button aria-label="Search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg></button>
        </form>
        <nav className="topnav">
          <Link href="/shop">Shop</Link>
          <Link href="/quote">Instant quote</Link>
          <Link href="/#process">How it works</Link>
          <Link href="/#business">For business</Link>
          {!role && <><Link href="/login">Sign in</Link><Link href="/login?tab=up" className="btn sm">Create account</Link></>}
          {role && (
            <span style={{ position: "relative" }}>
              <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ background: "transparent", border: "1px solid rgba(255,255,255,.25)", color: "var(--on-navy)", borderRadius: 999, padding: "6px 12px", cursor: "pointer", font: "inherit", fontSize: ".85rem" }}>
                {name ? name.split(" ")[0] : "Account"} ▾
              </button>
              {open && (
                <div onMouseLeave={() => setOpen(false)} style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, display: "grid", minWidth: 190, zIndex: 50 }}>
                  {role === "admin" && <Link href="/admin" style={{ padding: "8px 10px", color: "var(--fg)" }}>Back office</Link>}
                  {role === "vendor" && <Link href="/vendor" style={{ padding: "8px 10px", color: "var(--fg)" }}>Partner portal</Link>}
                  <Link href="/account" style={{ padding: "8px 10px", color: "var(--fg)" }}>My orders</Link>
                  <Link href="/account/profile" style={{ padding: "8px 10px", color: "var(--fg)" }}>Profile</Link>
                  <button type="button" onClick={signOut} style={{ textAlign: "left", padding: "8px 10px", background: "transparent", border: 0, color: "var(--bad)", cursor: "pointer", font: "inherit" }}>Sign out</button>
                </div>
              )}
            </span>
          )}
          <Link href="/cart" className="cartlink" aria-label={`Cart, ${n} items`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 4h2l2.4 11h11.2L21 7H6.2" /><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /></svg>
            {n > 0 && <b>{n}</b>}
          </Link>
        </nav>
      </div>
    </header>
  );
}
