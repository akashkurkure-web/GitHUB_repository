import Link from "next/link";
import { getSite } from "@/lib/site";
export const metadata = { title: "Contact" };
export default async function Contact() {
  const { biz: b, content } = await getSite();
  return (
    <main className="wrap page legal">
      <h1>Contact us</h1>
      <div className="card"><dl className="kv">
        <dt>Email</dt><dd className="mono">{b?.support_email}</dd><dt>Phone / WhatsApp</dt><dd className="mono">{b?.escalation_phone}</dd>
        <dt>Hours</dt><dd>{content.contact.hours}</dd><dt>Address</dt><dd>{b?.legal_entity_name}, {b?.registered_address_line1}, {b?.city}, {b?.state} {b?.pincode}</dd>
        <dt>GSTIN</dt><dd className="mono">{b?.gstin}</dd><dt>Grievance officer</dt><dd>{b?.grievance_officer_name} ({b?.support_email})</dd>
      </dl></div>
      <p>{content.contact.note} <Link href="/account/support">Open a support ticket</Link></p>
    </main>
  );
}
