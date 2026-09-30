import { getCurrentBd } from "@/lib/queries";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE_PATH,
  GMAIL_OAUTH_STATE_MAX_AGE_SECONDS,
  generateOAuthState,
} from "@/lib/gmail/oauthState";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  // Ensures the caller is signed in before we ever talk to Google.
  await getCurrentBd();

  const configResult = getGmailOAuthConfig();
  if (!configResult.ok) {
    const url = new URL("/account/email", req.url);
    url.searchParams.set("error", "not_configured");
    return NextResponse.redirect(url);
  }

  const state = generateOAuthState();
  const params = new URLSearchParams({
    client_id: configResult.config.clientId,
    redirect_uri: configResult.config.redirectUri,
    response_type: "code",
    // gmail.send cannot read the mailbox profile, so the address comes from
    // the OpenID userinfo endpoint (openid + email are non-sensitive scopes).
    // gmail.readonly (owner decision, 2026-09-30 email-sync brief) lets
    // /api/gmail/sync poll this BD's inbox. Every existing connection was
    // granted gmail.send only, so it must reconnect once — the callback
    // records the scopes Google actually grants and
    // needsReconnectForSync() (src/lib/gmail/needsReconnectForSync.ts) flags
    // a stale connection instead of letting sync fail against it.
    scope:
      "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GMAIL_OAUTH_STATE_MAX_AGE_SECONDS,
    path: GMAIL_OAUTH_STATE_COOKIE_PATH,
  });
  return response;
}
