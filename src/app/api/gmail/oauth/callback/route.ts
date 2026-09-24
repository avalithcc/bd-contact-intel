import { getCurrentBd } from "@/lib/queries";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { encryptToken } from "@/lib/gmail/crypto";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE_PATH,
  statesMatch,
} from "@/lib/gmail/oauthState";
import { NextRequest, NextResponse } from "next/server";

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/account/email", req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  // The state cookie is single-use — clear it on every exit from this route,
  // success or failure.
  response.cookies.delete({ name: GMAIL_OAUTH_STATE_COOKIE, path: GMAIL_OAUTH_STATE_COOKIE_PATH });
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const cookieState = req.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value;

    if (error) return back(req, { error });
    if (!code || !state) return back(req, { error: "missing_params" });
    if (!statesMatch(cookieState, state)) return back(req, { error: "invalid_state" });

    // The state nonce only proves this redirect matches the one we issued —
    // it says nothing about who is making the request, so the session must
    // still be verified independently.
    const me = await getCurrentBd();

    const configResult = getGmailOAuthConfig();
    if (!configResult.ok) return back(req, { error: "not_configured" });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: configResult.config.clientId,
        client_secret: configResult.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: configResult.config.redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) return back(req, { error: "token_exchange_failed" });

    const tokens = await tokenRes.json();
    if (!tokens.refresh_token || !tokens.access_token) {
      return back(req, { error: "no_refresh_token" });
    }

    const profileRes = await fetch(
      "https://www.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );

    if (!profileRes.ok) return back(req, { error: "profile_fetch_failed" });

    const profile = await profileRes.json();
    const encryptedToken = encryptToken(tokens.refresh_token);

    await db
      .insert(emailAccount)
      .values({
        bdId: me.id,
        emailAddress: profile.emailAddress,
        refreshTokenEncrypted: encryptedToken,
        status: "connected",
        lastErrorMessage: null,
      })
      .onConflictDoUpdate({
        target: emailAccount.bdId,
        set: {
          emailAddress: profile.emailAddress,
          refreshTokenEncrypted: encryptedToken,
          status: "connected",
          lastErrorMessage: null,
        },
      });

    return back(req, { success: "true" });
  } catch (err) {
    console.error("OAuth callback error:", err);
    return back(req, { error: "server_error" });
  }
}
