import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { inr, d } from "@/lib/format";

export default async function Customers({ searchParams }: { searchParams: { q?: string } }) {
  const { supabase } = await requireAdmin();
  let q = supabase.from("profiles").select("*").eq("role", "customer").order("created_at", { ascending: false }).limit(300);
  const term = (searchParams.q ?? "").replace(/[,()%*\\]/g, "").trim();
  if (term) q = q.or(`email.ilike.%${term}%,full_name.ilike.%${term}%,company_name.ilike.%${term}%,phone_number.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (
    <>
      <div className="head"><div><h1>Customers</h1><p className="muted">Customer accounts only. Staff are managed under Team &amp; access, partners under Print partners.</p></div>
        <form className="inline"><input name="q" placeholder="Email, name, company, phone" defaultValue={searchParams.q ?? ""} /><button className="btn sm">Search</button></form></div>
      <div className="tw"><table>
        <thead><tr><th>Name</th><th>Contact</th><th>Company / GSTIN</th><th>B2B</th><th className="r">Wallet</th><th>Joined</th></tr></thead>
        <tbody>{(data ?? []).map((p) => (
          <tr key={p.id}>
            <td><Link href={`/admin/customers/${p.id}`}><b>{p.full_name || "—"}</b></Link></td>
            <td>{p.email}<div className="muted">{p.phone_number}</div></td>
            <td>{p.company_name || "—"}<div className="muted mono">{p.gstin}</div></td>
            <td><span className={`pill ${p.is_verified_b2b ? "ok" : "info"}`}>{p.is_verified_b2b ? "Verified" : "No"}</span></td>
            <td className="r num">{inr(p.wallet_balance_inr)}</td>
            <td>{d(p.created_at)}</td>
          </tr>))}
          {!data?.length && <tr><td colSpan={6} className="empty">No customers found.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
