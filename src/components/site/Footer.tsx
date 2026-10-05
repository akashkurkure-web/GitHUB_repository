import Link from "next/link";
import { getSite } from "@/lib/site";

export default async function Footer() {
  const { biz: b, content } = await getSite();
  return (
    <footer className="sitefoot">
      <div className="wrap">
        <div><b>{b?.brand_name || "Layer27"}</b><br />{content.footer.tagline}<br /><br />{b?.legal_entity_name}<br />GSTIN <span className="mono">{b?.gstin}</span><br />{b?.registered_address_line1}, {b?.city}, {b?.state} {b?.pincode}</div>
        <div><b>Support</b><br /><span className="mono">{b?.support_email}</span><br /><span className="mono">{b?.escalation_phone}</span><br />{content.contact.hours}</div>
        <div><b>Shop</b><Link href="/shop">Browse products</Link><Link href="/quote">Instant quote</Link><Link href="/account">My orders</Link><Link href="/account/business">Business credit</Link><Link href="/contact">Contact</Link></div>
        <div><b>Company</b><Link href="/legal/terms">Terms of service</Link><Link href="/legal/privacy">Privacy policy</Link><Link href="/legal/refunds">Cancellation &amp; refunds</Link><Link href="/legal/shipping">Shipping policy</Link><Link href="/partners">Become a print partner</Link><Link href="/partner-login">Partner sign in</Link><Link href="/staff">Staff sign in</Link></div>
      </div>
    </footer>
  );
}
