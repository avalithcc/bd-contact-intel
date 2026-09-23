import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptToken } from "@/lib/gmail/crypto";
import { createActivityAction } from "@/app/activity/actions";

interface SendGmailInput {
  bdId: string;
  to: string;
  subject: string;
  body: string;
  leadId?: string;
  companyKey?: string;
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
}: SendGmailInput) {
  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.bdId, bdId));

  if (!account || account.status !== "connected" || !account.refreshTokenEncrypted) {
    throw new Error("Gmail account not connected. Connect it at /account/email.");
  }

  const refreshToken = decryptToken(account.refreshTokenEncrypted);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!tokenRes.ok) {
    // Refresh tokens expire every 7 days under External+Testing mode.
    await db
      .update(emailAccount)
      .set({ status: "error" })
      .where(eq(emailAccount.bdId, bdId));
    throw new Error("Gmail authorization expired. Reconnect at /account/email.");
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
    throw new Error(`Gmail send failed: ${detail}`);
  }

  const sent = await sendRes.json();

  await createActivityAction({
    type: "email_sent",
    leadId,
    companyKey,
    metadata: {
      to,
      subject,
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId,
    },
  });

  return { messageId: sent.id, threadId: sent.threadId };
}
