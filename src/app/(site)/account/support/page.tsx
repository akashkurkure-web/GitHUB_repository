import { requireUser } from "@/lib/auth";
import { dt, label } from "@/lib/format";
import Pill from "@/components/Pill";
import Flash from "@/components/account/Flash";
import { openTicket } from "../actions";

export default async function Support({ searchParams }: { searchParams: any }) {
  const { supabase, user } = await requireUser();
  const [{ data: tickets }, { data: orders }] = await Promise.all([
    supabase.from("support_tickets").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("orders").select("id, order_number").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <>
      <Flash sp={searchParams} />
      <form action={openTicket} className="card">
        <h2>Ask for help</h2>
        <div className="form">
          <label className="f">Topic<select name="category" required defaultValue=""><option value="" disabled>Choose…</option><option value="dfm_help">Design / printability help</option><option value="b2b_quote">Bulk or custom quote (STEP, OBJ, 3MF)</option><option value="shipping_delay">Delivery delay</option><option value="dimensional_defect">Part defect</option><option value="gst_invoice">GST invoice</option><option value="other">Something else</option></select></label>
          <label className="f">Order (optional)<select name="order_id" defaultValue=""><option value="">None</option>{(orders ?? []).map((o) => <option key={o.id} value={o.id}>{o.order_number}</option>)}</select></label>
          <label className="f">Photo (optional, under 4 MB)<input type="file" name="photo" accept="image/*" /></label>
        </div>
        <label className="f">What do you need?<textarea name="summary" required /></label>
        <div><button className="btn">Open ticket</button></div>
      </form>
      <div className="tw"><table>
        <thead><tr><th>Ticket</th><th>Topic</th><th>Summary</th><th>Opened</th><th>Status</th></tr></thead>
        <tbody>{(tickets ?? []).map((t) => <tr key={t.id}><td className="mono">{t.ticket_number}</td><td>{label(t.category)}</td><td>{t.issue_summary}</td><td>{dt(t.created_at)}</td><td><Pill s={t.status} /></td></tr>)}
          {!tickets?.length && <tr><td colSpan={5} className="empty">No tickets yet.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
