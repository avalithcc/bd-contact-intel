import { getCurrentBd } from "@/lib/queries";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { encryptToken } from "@/lib/gmail/crypto";
import { NextRequest, NextResponse } from "next/server";

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/account/email", req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) return back(req, { error });
    if (!code || !state) return back(req, { error: "missing_params" });

    const me = await getCurrentBd();
    if (state !== me.id) return back(req, { error: "invalid_state" });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
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
      })
      .onConflictDoUpdate({
        target: emailAccount.bdId,
        set: {
          emailAddress: profile.emailAddress,
          refreshTokenEncrypted: encryptedToken,
          status: "connected",
        },
      });

    return back(req, { success: "true" });
  } catch (err) {
    console.error("OAuth callback error:", err);
    return back(req, { error: "server_error" });
  }
}
