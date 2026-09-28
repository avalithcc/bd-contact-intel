import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/auth/nextPath";

/**
 * Landing point for Supabase email links (invite / recovery). Verifies the
 * one-time token, which establishes a session, then sends the user to set
 * their own password.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // `next` rides in the email link we generate ourselves (always
  // "/account/password" today), but it still crosses a URL an attacker
  // could tamper with, so it gets the same same-origin validation as the
  // login redirect.
  const next = sanitizeNextPath(searchParams.get("next"), "/account/password");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=invalid_or_expired_link", request.url),
  );
}
