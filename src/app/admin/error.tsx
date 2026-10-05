"use client";
export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card">
      <h2>That didn't work</h2>
      <div className="alert">{error.message || "Something went wrong while talking to the database."}</div>
      <p className="muted">If this mentions a missing table or permission, check that both SQL migrations ran and that your account has the admin role.</p>
      <div><button className="btn" onClick={reset}>Try again</button></div>
    </div>
  );
}
