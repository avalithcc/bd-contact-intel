import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptToken } from "@/lib/gmail/crypto";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { classifyTokenRefreshError } from "@/lib/gmail/errors";
import { createActivityAction } from "@/app/activity/actions";

interface SendGmailInput {
  bdId: string;
  to: string;
  subject: string;
  body: string;
  leadId?: string;
  companyKey?: string;
  // Unified-Contact subject (design D1); record page's "Correo" action (9.2).
  personId?: string;
}

function buildRawMessage(from: string, to: string, subject: string, body: string) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].join("\r\n");

  const encodedBody = Buffer.from(body, "utf8").toString("base64");
  return Buffer.from(`${headers}\r\n\r\n${encodedBody}`, "utf8").toString("base64url");
}

export async function sendGmailMessage({
  bdId,
  to,
  subject,
  body,
  leadId,
  companyKey,
  personId,
}: SendGmailInput) {
  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.bdId, bdId));

  if (!account || account.status !== "connected" || !account.refreshTokenEncrypted) {
    throw new Error("Gmail account not connected. Connect it at /account/email.");
  }

  const configResult = getGmailOAuthConfig();
  if (!configResult.ok) {
    await db
      .update(emailAccount)
      .set({
        lastErrorMessage: `Gmail is not configured on the server (missing: ${configResult.missing.join(", ")}).`,
      })
      .where(eq(emailAccount.bdId, bdId));
    throw new Error("Gmail is not configured on the server. Contact an admin.");
  }

  const refreshToken = decryptToken(account.refreshTokenEncrypted);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configResult.config.clientId,
      client_secret: configResult.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!tokenRes.ok) {
    // Refresh tokens expire every 7 days under External+Testing mode — that
    // shows up here as invalid_grant. A bad client id/secret also lands
    // here (invalid_client/unauthorized_client) but is a server
    // misconfiguration, not something the user can fix by reconnecting.
    const bodyText = await tokenRes.text();
    const classification = classifyTokenRefreshError(bodyText);

    await db
      .update(emailAccount)
      .set({
        ...(classification.kind === "revoked" ? { status: "error" as const } : {}),
        lastErrorMessage: classification.message,
      })
      .where(eq(emailAccount.bdId, bdId));

    if (classification.kind === "config") {
      throw new Error("Gmail is not configured correctly on the server. Contact an admin.");
    }
    if (classification.kind === "revoked") {
      throw new Error("Gmail authorization expired. Reconnect at /account/email.");
    }
    throw new Error("Gmail authorization check failed. Try again shortly.");
  }

  const { access_token } = await tokenRes.json();

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: buildRawMessage(account.emailAddress, to, subject, body),
      }),
    },
  );

  if (!sendRes.ok) {
    const detail = await sendRes.text();
    await db
      .update(emailAccount)
      .set({ lastErrorMessage: `Gmail send failed: ${detail.slice(0, 300)}` })
      .where(eq(emailAccount.bdId, bdId));
    throw new Error(`Gmail send failed: ${detail}`);
  }

  const sent = await sendRes.json();

  await db
    .update(emailAccount)
    .set({ lastErrorMessage: null })
    .where(eq(emailAccount.bdId, bdId));

  await createActivityAction({
    type: "email_sent",
    leadId,
    companyKey,
    personId,
    metadata: {
      to,
      subject,
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId,
    },
  });

  return { messageId: sent.id, threadId: sent.threadId };
}
