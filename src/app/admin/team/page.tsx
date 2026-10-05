import { requirePermPage } from "@/lib/auth";
import { d } from "@/lib/format";
import { MODULES, MODULE_KEYS, PRESETS, can } from "@/lib/permissions";
import AccessPicker from "@/components/admin/AccessPicker";
import { inviteStaff, updateStaff, removeStaff, cancelInvite } from "../actions";

const READ_RESTRICTED = ["finance", "team", "audit"];

export default async function Team() {
  const { supabase, profile, perms } = await requirePermPage("team");
  const isOwner = perms.includes("*");
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("staff_members").select("*, profiles!staff_members_user_id_fkey(email, full_name)").order("created_at"),
    supabase.from("staff_invites").select("*").order("created_at", { ascending: false }),
  ]);
  return (
    <>
      <div className="head"><div><h1>Team &amp; access</h1><p className="muted">Who can sign in to the back office and what each person can change. Customers and print partners never appear here.</p></div></div>

      <form action={inviteStaff} className="card">
        <h2>Add a staff member</h2>
        <p className="muted">If they already have an account, access starts immediately. If not, it starts when they create an account with this email at <span className="mono">/login</span>.</p>
        <label className="f">Email<input name="email" type="email" required placeholder="name@company.com" /></label>
        <AccessPicker isOwnerActor={isOwner} />
        <div><button className="btn">Give access</button></div>
      </form>

      <div className="card">
        <h2>Staff ({members?.length ?? 0})</h2>
        {(members ?? []).map((m: any) => {
          const self = m.user_id === profile.id;
          const owner = m.permissions.includes("*");
          return (
            <details key={m.user_id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
              <summary className="row" style={{ cursor: "pointer", justifyContent: "space-between" }}>
                <span><b>{m.profiles?.full_name || m.profiles?.email}</b> <span className="muted">{m.profiles?.email}</span></span>
                <span className="row"><span className={`pill ${owner ? "warn" : "info"}`}>{owner ? "Owner" : PRESETS[m.staff_role]?.label ?? "Custom"}</span>{self && <span className="pill ok">You</span>}<span className="muted">since {d(m.created_at)}</span></span>
              </summary>
              {self ? <p className="muted">You can&apos;t change your own access. Ask another owner.</p> : (owner && !isOwner) ? <p className="muted">Only an owner can change an owner.</p> : (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <form action={updateStaff} style={{ display: "grid", gap: 10 }}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <AccessPicker role={owner ? "owner" : m.staff_role in PRESETS ? m.staff_role : "custom"} perms={m.permissions} isOwnerActor={isOwner} />
                    <div><button className="btn sm">Save access</button></div>
                  </form>
                  <form action={removeStaff}><input type="hidden" name="user_id" value={m.user_id} /><button className="btn sm danger">Remove back-office access</button></form>
                </div>
              )}
            </details>
          );
        })}
      </div>

      {(invites ?? []).length > 0 && (
        <div className="card"><h2>Waiting to sign up</h2>
          {invites!.map((i) => (
            <div key={i.email} className="row" style={{ justifyContent: "space-between" }}>
              <span className="mono">{i.email}</span><span className="pill info">{PRESETS[i.staff_role]?.label ?? "Custom"}</span>
              <form action={cancelInvite}><input type="hidden" name="email" value={i.email} /><button className="btn sm ghost">Cancel</button></form>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Access framework</h2>
        <p className="muted">✓ = can change · <span className="ro">R</span> = can only view · — = can&apos;t see. Enforced by the database, not just by hiding buttons.</p>
        <div className="tw"><table className="matrix">
          <thead><tr><th>Area</th>{Object.entries(PRESETS).filter(([k]) => k !== "custom").map(([k, p]) => <th key={k}>{p.label}</th>)}<th>Print partner</th><th>Customer</th><th>Guest</th></tr></thead>
          <tbody>
            {MODULE_KEYS.map((m) => (
              <tr key={m}>
                <td><b>{MODULES[m].label}</b><div className="muted" style={{ fontSize: ".75rem" }}>{MODULES[m].desc}</div></td>
                {Object.entries(PRESETS).filter(([k]) => k !== "custom").map(([k, p]) => {
                  const yes = can(p.perms as string[], m);
                  return <td key={k}>{yes ? <span className="yes">✓</span> : READ_RESTRICTED.includes(m) ? <span className="no">—</span> : <span className="ro">R</span>}</td>;
                })}
                <td>{m === "production" ? <span className="ro">own jobs</span> : <span className="no">—</span>}</td>
                <td>{["orders", "support"].includes(m) ? <span className="ro">own</span> : <span className="no">—</span>}</td>
                <td><span className="no">—</span></td>
              </tr>
            ))}
            <tr><td><b>Shop, quote &amp; cart</b></td>{Object.keys(PRESETS).filter((k) => k !== "custom").map((k) => <td key={k}><span className="yes">✓</span></td>)}<td><span className="yes">✓</span></td><td><span className="yes">✓</span></td><td><span className="yes">✓</span></td></tr>
            <tr><td><b>Checkout</b></td>{Object.keys(PRESETS).filter((k) => k !== "custom").map((k) => <td key={k}><span className="yes">✓</span></td>)}<td><span className="yes">✓</span></td><td><span className="yes">✓</span></td><td><span className="yes">✓</span> <span className="muted">private link</span></td></tr>
          </tbody>
        </table></div>
      </div>
    </>
  );
}
