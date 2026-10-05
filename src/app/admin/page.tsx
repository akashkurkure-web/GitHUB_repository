import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { inr, dt } from "@/lib/format";
import Pill from "@/components/Pill";

export default async function Overview({ searchParams }: { searchParams: { denied?: string } }) {
  const { supabase } = await requireAdmin();
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const monthStart = new Date(Date.UTC(ist.getFullYear(), ist.getMonth(), 1) - 5.5 * 3600_000).toISOString();
  const dayStart = new Date(Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate()) - 5.5 * 3600_000).toISOString();
  const PAID = ["paid", "in_production", "qc_passed", "packed", "shipped", "out_for_delivery", "delivered"];

  const [monthOrders, todayOrders, openJobs, breached, flagged, tickets, claims, leads, recent] = await Promise.all([
    supabase.from("orders").select("total_amount").in("status", PAID).gte("created_at", monthStart),
    supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    supabase.from("vendor_jobs").select("id", { count: "exact", head: true }).not("status", "in", "(handed_over,rejected)"),
    supabase.from("vendor_jobs").select("id", { count: "exact", head: true }).not("status", "in", "(handed_over,rejected)").lt("sla_deadline_at", now.toISOString()),
    supabase.from("product_service_reviews").select("id", { count: "exact", head: true }).eq("status", "flagged_for_resolution"),
    supabase.from("support_tickets").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    supabase.from("defect_warranty_claims").select("id", { count: "exact", head: true }).eq("status", "pending_admin_review"),
    supabase.from("crm_leads_and_prospects_view").select("user_id", { count: "exact", head: true }).eq("lead_stage", "HOT_LEAD"),
    supabase.from("orders").select("id, order_number, status, total_amount, created_at, customer_legal_name, guest_name, guest_email, profiles(full_name, email)").order("created_at", { ascending: false }).limit(8),
  ]);

  const revenue = (monthOrders.data ?? []).reduce((a, o) => a + Number(o.total_amount), 0);
  const K: [string, string | number, string, string][] = [
    ["Paid revenue this month", inr(revenue), "var(--ok)", "/admin/orders?status=paid"],
    ["Orders today", todayOrders.count ?? 0, "var(--blue)", "/admin/orders"],
    ["Open vendor jobs", openJobs.count ?? 0, "var(--accent)", "/admin/vendor-jobs"],
    ["Jobs past SLA", breached.count ?? 0, "var(--bad)", "/admin/vendor-jobs?late=1"],
    ["Hot leads", leads.count ?? 0, "var(--accent)", "/admin/leads?stage=HOT_LEAD"],
    ["Open tickets", tickets.count ?? 0, "var(--warn)", "/admin/support"],
    ["Warranty claims to review", claims.count ?? 0, "var(--bad)", "/admin/support"],
    ["Flagged reviews", flagged.count ?? 0, "var(--warn)", "/admin/reviews?status=flagged_for_resolution"],
  ];

  return (
    <>
      <div className="head">
        <div><h1>Overview</h1><p className="muted">Today's operations at a glance. Times shown in IST.</p></div>
        <Link className="btn ghost" href="/admin/orders">All orders</Link>
      </div>
      {searchParams.denied && <div className="alert">That area needs the “{searchParams.denied}” permission. Ask an owner under Team &amp; access.</div>}
      <div className="kpis">
        {K.map(([t, v, c, href]) => (
          <Link key={t} href={href} className="kpi" style={{ ["--c" as string]: c, color: "inherit" }}>
            <span>{t}</span><b>{v}</b>
          </Link>
        ))}
      </div>
      <div className="card">
        <h2>Latest orders</h2>
        <div className="tw">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="r">Total</th><th>Placed</th></tr></thead>
            <tbody>
              {(recent.data ?? []).map((o: any) => (
                <tr key={o.id}>
                  <td><Link className="mono" href={`/admin/orders/${o.id}`}>{o.order_number}</Link></td>
                  <td>{o.customer_legal_name || o.profiles?.full_name || o.profiles?.email || o.guest_name || o.guest_email || "Guest"}{!o.profiles && <span className="pill warn" style={{ marginLeft: 6 }}>Guest</span>}</td>
                  <td><Pill s={o.status} /></td>
                  <td className="r num">{inr(o.total_amount)}</td>
                  <td>{dt(o.created_at)}</td>
                </tr>
              ))}
              {!recent.data?.length && <tr><td colSpan={5} className="empty">No orders yet. They appear here as soon as customers check out.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
