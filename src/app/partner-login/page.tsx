export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
export default function PartnerLogin() { redirect("/login?next=/vendor"); }
