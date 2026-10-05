export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
/** Short, memorable address for the back-office sign-in: yourdomain.in/staff */
export default function Staff() { redirect("/login?next=/admin"); }
