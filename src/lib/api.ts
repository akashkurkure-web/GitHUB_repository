import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { UserError } from "@/lib/orders";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function handle(e: unknown) {
  if (e instanceof UserError) return fail(e.message, 400);
  console.error(e);
  return fail("Something went wrong on our side. Please try again in a minute.", 500);
}

export async function currentUser() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

export function guestId() {
  const g = cookies().get("l27_guest")?.value;
  return g && /^[0-9a-f-]{36}$/i.test(g) ? g : null;
}
