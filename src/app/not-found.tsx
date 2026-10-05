import Link from "next/link";
export default function NotFound() {
  return (
    <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <h1>Page not found</h1>
        <p className="muted">The link may be old, or you may need to sign in with a different account.</p>
        <div><Link className="btn" href="/">Go to the homepage</Link></div>
      </div>
    </main>
  );
}
