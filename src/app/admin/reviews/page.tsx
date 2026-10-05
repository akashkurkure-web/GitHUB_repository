import Gate from "@/components/Gate";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { d, label } from "@/lib/format";
import Pill from "@/components/Pill";
import { moderateReview } from "../actions";

const STAR = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
export default async function Reviews({ searchParams }: { searchParams: { status?: string } }) {
  const { supabase, perms } = await requireAdmin();
  let q = supabase.from("product_service_reviews").select("*").order("created_at", { ascending: false }).limit(200);
  if (searchParams.status) q = q.eq("status", searchParams.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (
    <Gate perms={perms} m="marketing">
      <div className="head"><div><h1>Reviews</h1><p className="muted">Reviews with 2 stars or less for overall or accuracy are flagged automatically. Resolve the issue, then publish or keep hidden.</p></div></div>
      <div className="filters">
        {[["", "All"], ["flagged_for_resolution", "Flagged"], ["pending_moderation", "Pending"], ["published", "Published"]].map(([v, t]) =>
          <Link key={t} href={v ? `/admin/reviews?status=${v}` : "/admin/reviews"} className={(searchParams.status ?? "") === v ? "on" : ""}>{t}</Link>)}
      </div>
      {(data ?? []).map((r) => (
        <div key={r.id} className="card">
          <div className="head">
            <div><h2>{r.review_title}</h2><p className="muted">{r.reviewer_display_name} · {r.reviewer_company_or_city} · {d(r.created_at)} {r.is_verified_order && <span className="pill ok">Verified order</span>}</p></div>
            <Pill s={r.status} />
          </div>
          <p style={{ color: "var(--accent)", letterSpacing: 2 }}>{STAR(r.overall_rating)} <span className="muted" style={{ letterSpacing: 0, fontSize: ".8rem" }}>surface {r.print_surface_quality_rating} · accuracy {r.dimensional_accuracy_rating} · delivery {r.packaging_and_delivery_rating}{r.material_used && ` · ${label(r.material_used)}`}</span></p>
          <p>{r.review_comment}</p>
          {r.generated_reward_coupon_code && <p className="muted">Reward coupon issued: <span className="mono">{r.generated_reward_coupon_code}</span></p>}
          <form action={moderateReview} className="form" style={{ gridTemplateColumns: "1fr auto auto" }}>
            <input type="hidden" name="id" value={r.id} />
            <label className="f">Public reply<textarea name="reply" defaultValue={r.admin_public_reply ?? ""} /></label>
            <label className="f">Status<select name="status" defaultValue={r.status}><option value="published">published</option><option value="pending_moderation">pending moderation</option><option value="flagged_for_resolution">flagged</option></select></label>
            <button className="btn">Save</button>
          </form>
        </div>
      ))}
      {!data?.length && <div className="card empty">No reviews here.</div>}
    </Gate>
  );
}
