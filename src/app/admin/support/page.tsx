import Gate from "@/components/Gate";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dt, label } from "@/lib/format";
import Pill from "@/components/Pill";
import { updateTicket, updateClaim } from "../actions";

export default async function Support() {
  const { supabase, perms } = await requireAdmin();
  const [{ data: tickets, error: e1 }, { data: claims, error: e2 }] = await Promise.all([
    supabase.from("support_tickets").select("*, orders(id, order_number), profiles(email)").order("created_at", { ascending: false }).limit(150),
    supabase.from("defect_warranty_claims").select("*, orders(id, order_number), profiles(email)").order("created_at", { ascending: false }).limit(150),
  ]);
  if (e1 || e2) throw new Error((e1 || e2)!.message);
  return (
    <Gate perms={perms} m="support">
      <div className="head"><div><h1>Support &amp; warranty claims</h1><p className="muted">Claims must come within 48 hours of delivery with unboxing or caliper photos.</p></div></div>
      <div className="card">
        <h2>Warranty claims</h2>
        <div className="tw"><table>
          <thead><tr><th>Claim</th><th>Order</th><th>Type</th><th>Description</th><th>Photos</th><th>Raised</th><th>Decision</th></tr></thead>
          <tbody>{(claims ?? []).map((c: any) => (
            <tr key={c.id}>
              <td className="mono">{c.claim_number}<div><Pill s={c.status} /></div></td>
              <td><Link className="mono" href={`/admin/orders/${c.orders?.id}`}>{c.orders?.order_number}</Link><div className="muted">{c.profiles?.email}</div></td>
              <td>{label(c.claim_type)}</td>
              <td style={{ maxWidth: 280 }}>{c.customer_description}</td>
              <td>{(c.unboxing_or_caliper_photo_urls ?? []).map((u: string, i: number) => <div key={u}><a href={u} target="_blank" rel="noreferrer">Photo {i + 1}</a></div>)}</td>
              <td>{dt(c.created_at)}</td>
              <td><form action={updateClaim} className="inline"><input type="hidden" name="id" value={c.id} />
                <select name="status" defaultValue={c.status}><option value="pending_admin_review">pending review</option><option value="reprint_dispatched">reprint dispatched</option><option value="rejected_outside_tolerance">rejected</option></select>
                <select name="fault" defaultValue={c.fault_attributed_to ?? ""}><option value="">fault…</option><option value="vendor_fault">vendor</option><option value="courier_damage">courier</option><option value="platform_goodwill">goodwill</option></select>
                <button className="btn sm">Save</button></form></td>
            </tr>))}
            {!claims?.length && <tr><td colSpan={7} className="empty">No claims.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Support tickets</h2>
        <div className="tw"><table>
          <thead><tr><th>Ticket</th><th>Category</th><th>Priority</th><th>Summary</th><th>Order</th><th>Opened</th><th>Status</th></tr></thead>
          <tbody>{(tickets ?? []).map((t: any) => (
            <tr key={t.id}>
              <td className="mono">{t.ticket_number}<div className="muted">{t.profiles?.email}</div></td>
              <td>{label(t.category)}</td>
              <td><Pill s={t.priority} /></td>
              <td style={{ maxWidth: 300 }}>{t.issue_summary}{t.evidence_photo_url && <div><a href={t.evidence_photo_url} target="_blank" rel="noreferrer">Evidence</a></div>}</td>
              <td>{t.orders && <Link className="mono" href={`/admin/orders/${t.orders.id}`}>{t.orders.order_number}</Link>}</td>
              <td>{dt(t.created_at)}</td>
              <td><form action={updateTicket} className="inline"><input type="hidden" name="id" value={t.id} />
                <select name="status" defaultValue={t.status}><option value="open">open</option><option value="in_review">in review</option><option value="resolved">resolved</option></select>
                <button className="btn sm">Save</button></form></td>
            </tr>))}
            {!tickets?.length && <tr><td colSpan={7} className="empty">No tickets.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </Gate>
  );
}
