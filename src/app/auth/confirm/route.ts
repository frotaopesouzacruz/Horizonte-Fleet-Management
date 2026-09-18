import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/login-identity";

/**
 * Landing point for every Supabase Auth e-mail (invite, recovery, e-mail
 * change). Exchanges the one-time token for a session and then sends the user
 * to the screen that finishes the flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const target = safeNext(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?erro=link-invalido", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL("/login?erro=link-expirado", origin));
  }

  return NextResponse.redirect(new URL(target, origin));
}
