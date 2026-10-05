import Link from "next/link";
import { requireUser } from "@/lib/auth";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <main className="wrap page">
      <div className="head">
        <div><span className="eyebrow">My account</span><h1>Hello{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1></div>
        <nav className="filters">
          <Link href="/account">Orders</Link><Link href="/account/profile">Profile</Link><Link href="/account/business">Business</Link><Link href="/account/support">Support</Link>
          {profile.role === "admin" && <Link href="/admin">Admin panel</Link>}{profile.role === "vendor" && <Link href="/vendor">Vendor portal</Link>}
          <SignOutButton />
        </nav>
      </div>
      {children}
    </main>
  );
}
