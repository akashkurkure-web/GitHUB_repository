import { createClient } from "@supabase/supabase-js";
/** Cookie-free anon client for public, cacheable reads (catalogue, business details). */
export function publicClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
}
