import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { getSession } from "@/lib/auth";
import { getSite } from "@/lib/site";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [{ profile }, { content }] = await Promise.all([getSession(), getSite()]);
  const a = content.announcement;
  return (
    <div className="site">
      {a?.enabled && a.text && <div className="announce">{a.text} {a.link_label && a.link_href && <Link href={a.link_href}>{a.link_label} →</Link>}</div>}
      <Header role={profile?.role ?? null} name={profile?.full_name ?? null} />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer />
    </div>
  );
}
