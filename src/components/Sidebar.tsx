"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** [label, href, group heading?, module needed to SEE it (none = all staff)] */
export type NavItem = [string, string, string?, string?];
export const ADMIN_NAV: NavItem[] = [
  ["Overview", "/admin", "Operations"], ["Orders", "/admin/orders"], ["Vendor jobs", "/admin/vendor-jobs"], ["Support & claims", "/admin/support"],
  ["Leads", "/admin/leads", "Customers"], ["Customers", "/admin/customers"], ["Reviews", "/admin/reviews"], ["B2B credit", "/admin/credit", undefined, "finance"],
  ["Products", "/admin/catalog", "Shop & website", "catalog"], ["Materials & pricing", "/admin/pricing", undefined, "catalog"],
  ["Website content", "/admin/content", undefined, "content"], ["Coupons", "/admin/coupons", undefined, "marketing"],
  ["Print partners", "/admin/vendors", "Partners"], ["Payouts", "/admin/payouts", undefined, "finance"],
  ["Business settings", "/admin/settings", "Administration", "settings"], ["Team & access", "/admin/team", undefined, "team"], ["Audit log", "/admin/audit", undefined, "audit"],
];
export const VENDOR_NAV: NavItem[] = [["Job queue", "/vendor", "Work"], ["Payouts", "/vendor/payouts"]];

export default function Sidebar({ email, nav, badge, root, perms, roleLabel }: { email: string; nav: NavItem[]; badge: string; root: string; perms?: string[]; roleLabel?: string }) {
  const allowed = (m?: string) => !m || !perms || perms.includes("*") || perms.includes(m);
  let lastGroup = "";
  const path = usePathname();
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <aside className="side">
      <Link className="brand" href="/">Layer27 <small>{badge}</small></Link>
      {nav.map(([name, href, group, mod]) => {
        if (group) lastGroup = group;
        if (!allowed(mod)) return null;
        const on = href === root ? path === root : path.startsWith(href);
        const heading = lastGroup && lastGroup !== "__shown" ? lastGroup : "";
        if (heading) lastGroup = "__shown";
        return (
          <span key={href} style={{ display: "contents" }}>
            {heading && <div className="grp">{heading}</div>}
            <Link href={href} className={on ? "on" : ""}>{name}</Link>
          </span>
        );
      })}
      <div className="foot">
        {roleLabel && <span className="pill info" style={{ justifySelf: "start" }}>{roleLabel}</span>}
        <span style={{ overflowWrap: "anywhere" }}>{email}</span>
        <Link href="/" style={{ padding: 0 }}>View website</Link>
        <button type="button" onClick={signOut}>Sign out</button>
      </div>
    </aside>
  );
}
