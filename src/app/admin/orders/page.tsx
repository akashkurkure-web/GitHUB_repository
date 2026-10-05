import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { inr, dt, label, ORDER_STATUSES } from "@/lib/format";
import Pill from "@/components/Pill";

export default async function Orders({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const { supabase } = await requireAdmin();
  let q = supabase
    .from("orders")
    .select("id, order_number, status, total_amount, created_at, customer_legal_name, customer_gstin, is_mmr_same_day_express, invoice_number, guest_name, guest_email, user_id, profiles(full_name, email, phone_number)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (searchParams.status) q = q.eq("status", searchParams.status);
  const term = (searchParams.q ?? "").replace(/[,()%*\\]/g, "").trim();
  if (term) q = q.or(`order_number.ilike.%${term}%,invoice_number.ilike.%${term}%,customer_legal_name.ilike.%${term}%,guest_email.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (
    <>
      <div className="head"><div><h1>Orders</h1><p className="muted">Latest 200. Click an order to update status, assign a vendor or add tracking.</p></div>
        <form className="inline"><input name="q" placeholder="Order, invoice or company" defaultValue={searchParams.q ?? ""} />{searchParams.status && <input type="hidden" name="status" value={searchParams.status} />}<button className="btn sm">Search</button></form>
      </div>
      <div className="filters">
        <Link href="/admin/orders" className={!searchParams.status ? "on" : ""}>All</Link>
        {ORDER_STATUSES.map((st) => <Link key={st} href={`/admin/orders?status=${st}`} className={searchParams.status === st ? "on" : ""}>{label(st)}</Link>)}
      </div>
      <div className="tw">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>GSTIN</th><th>Status</th><th>Invoice</th><th className="r">Total</th><th>Placed</th></tr></thead>
          <tbody>
            {(data ?? []).map((o: any) => (
              <tr key={o.id}>
                <td><Link className="mono" href={`/admin/orders/${o.id}`}>{o.order_number}</Link>{o.is_mmr_same_day_express && <div><span className="pill warn">Express</span></div>}</td>
                <td>{o.customer_legal_name || o.profiles?.full_name || o.guest_name || "—"} {!o.user_id && <span className="pill warn">Guest</span>}<div className="muted">{o.profiles?.email || o.guest_email}</div></td>
                <td className="mono">{o.customer_gstin || "—"}</td>
                <td><Pill s={o.status} /></td>
                <td className="mono">{o.invoice_number || "—"}</td>
                <td className="r num">{inr(o.total_amount)}</td>
                <td>{dt(o.created_at)}</td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={7} className="empty">No orders match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
