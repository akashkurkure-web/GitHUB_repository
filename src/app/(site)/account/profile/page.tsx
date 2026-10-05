import { requireUser } from "@/lib/auth";
import Flash from "@/components/account/Flash";
import { saveProfile } from "../actions";

export default async function Profile({ searchParams }: { searchParams: any }) {
  const { profile } = await requireUser();
  const a = profile.default_shipping_address || {};
  return (
    <>
      <Flash sp={searchParams} />
      <form action={saveProfile} className="card">
        <h2>Profile &amp; default address</h2>
        <div className="form">
          <label className="f">Full name<input name="full_name" defaultValue={profile.full_name ?? ""} required /></label>
          <label className="f">Mobile (WhatsApp)<input name="phone_number" defaultValue={profile.phone_number ?? ""} required /></label>
          <label className="f">Email<input value={profile.email} disabled /></label>
          <label className="f">Company<input name="company_name" defaultValue={profile.company_name ?? ""} /></label>
          <label className="f">GSTIN<input name="gstin" defaultValue={profile.gstin ?? ""} maxLength={15} /></label>
          <label className="f" style={{ gridColumn: "1/-1" }}>Address line 1<input name="line1" defaultValue={a.line1 ?? ""} /></label>
          <label className="f" style={{ gridColumn: "1/-1" }}>Address line 2<input name="line2" defaultValue={a.line2 ?? ""} /></label>
          <label className="f">City<input name="city" defaultValue={a.city ?? ""} /></label>
          <label className="f">State<input name="state" defaultValue={a.state ?? "Maharashtra"} /></label>
          <label className="f">Pincode<input name="pincode" defaultValue={a.pincode ?? ""} maxLength={6} /></label>
        </div>
        <div className="row"><button className="btn">Save profile</button><a href="/account/password">Change password</a></div>
      </form>
    </>
  );
}
