"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ className = "btn sm ghost", label = "Sign out" }: { className?: string; label?: string }) {
  const router = useRouter();
  return (
    <button type="button" className={className} onClick={async () => { await createClient().auth.signOut(); router.replace("/"); router.refresh(); }}>{label}</button>
  );
}
