import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { inr, dt, d } from "@/lib/format";
import Pill from "@/components/Pill";
import CopyBox from "@/components/account/CopyBox";

export default async function Account() {
  const { supabase, user, profile } = await requireUser();
  const [{ data: orders }, { data: rewards }, { data: refs }] = await Promise.all([
    supabase.from("orders").select("id, order_number, status, total_amount, created_at, invoice_number").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("user_review_reward_claims").select("*").eq("user_id", user.id),
    supabase.from("referral_rewards_ledger").select("status, referrer_reward_inr").eq("referrer_user_id", user.id),
  ]);
  const host = headers().get("host");
  const base = process.env.NEXT_PUBLIC_SITE_URL || `https://${host}`;
  const link = `${base}/?ref=${profile.referral_code}`;
  return (
    <>
      <div className="kpis">
        <div className="kpi" style={{ ["--c" as string]: "var(--ok)" }}><span>Wallet</span><b>{inr(profile.wallet_balance_inr)}</b></div>
        <div className="kpi" style={{ ["--c" as string]: "var(--accent)" }}><span>Referral earnings</span><b>{inr(profile.total_referral_earnings_inr)}</b></div>
        <div className="kpi"><span>Friends referred</span><b>{refs?.length ?? 0}</b></div>
      </div>
      <div className="grid2">
        <div className="card"><h2>Invite a colleague</h2><p className="muted">They get ₹200 off their first order. You get ₹200 in your wallet when it&apos;s delivered.</p><CopyBox text={link} /></div>
        <div className="card"><h2>Reward coupons</h2>
          {(rewards ?? []).length ? rewards!.map((r) => <p key={r.coupon_code}><span className="mono"><b>{r.coupon_code}</b></span> · {r.reward_summary} · {r.is_redeemed ? "used" : `valid until ${d(r.valid_until)}`}</p>)
            : <p className="muted">Review your first delivered order to unlock a thank-you coupon.</p>}
        </div>
      </div>
      <div className="card">
        <div className="head"><h2>Your orders</h2><Link className="btn sm" href="/quote">New quote</Link></div>
        <div className="tw"><table>
          <thead><tr><th>Order</th><th>Status</th><th className="r">Total</th><th>Invoice</th><th>Placed</th></tr></thead>
          <tbody>{(orders ?? []).map((o) => (
            <tr key={o.id}><td><Link className="mono" href={`/account/orders/${o.id}`}>{o.order_number}</Link></td><td><Pill s={o.status} /></td><td className="r num">{inr(o.total_amount)}</td>
              <td>{o.invoice_number ? <Link href={`/documents/${o.id}?type=invoice`} className="mono">{o.invoice_number}</Link> : "—"}</td><td>{dt(o.created_at)}</td></tr>))}
            {!orders?.length && <tr><td colSpan={5} className="empty">No orders yet. <Link href="/quote">Get your first quote.</Link></td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
