import { requireVendor } from "@/lib/auth";
import Sidebar, { VENDOR_NAV } from "@/components/Sidebar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partner portal", robots: { index: false } };

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const { profile, vendor } = await requireVendor();
  return (
    <div className="shell">
      <Sidebar email={`${vendor.company_name} · ${profile.email}`} nav={VENDOR_NAV} badge="PARTNER" root="/vendor" />
      <main className="main">{children}</main>
    </div>
  );
}
