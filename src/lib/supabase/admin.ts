import { createClient as createSb } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY. Bypasses Row Level Security, so every
 * caller must check who the user is and what they own before using it.
 */
export function serviceClient() {
  if (typeof window !== "undefined") throw new Error("serviceClient() must never run in the browser.");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  return createSb(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
