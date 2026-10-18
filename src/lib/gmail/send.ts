import { db } from "@/db";
import { emailAccount, type NewActivity } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptToken } from "@/lib/gmail/crypto";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { classifyTokenRefreshError, GmailSendError } from "@/lib/gmail/errors";
import { revalidatePath } from "next/cache";
import { recordSentEmail } from "@/lib/gmail/sentEmailQueries";
import { readSentMessageMetadata } from "@/lib/gmail/sentMessageMetadata";
import { assertRecipients } from "@/lib/gmail/recipient";
import { assertSafeExtraHeader, assertSafeHeaderValue, buildSendPayload, type MessageContent, type ReplyTarget } from "@/lib/gmail/rawMessage";

// Callers give EITHER plain text (`body`, the unchanged legacy shape) OR
// `bodyHtml` (the text/plain alternative is derived from it). The union makes
// "both" and "neither" unrepresentable, so nobody writes the body twice or
// lets the two parts drift apart.
type SendGmailBody = {
  to: string;
  subject: string;
  leadId?: string;
  companyKey?: string;
  // Unified-Contact subject (design D1); record page's "Correo" action (9.2).
  personId?: string;
  // Present only when continuing an existing thread (see replyThread.ts).
  reply?: ReplyTarget;
  // True ONLY for a thread reply, whose recipients come from the stored thread and may be several.
  allowRecipientList?: boolean;
  // Complete `Name: value` header lines (Sequence List-Unsubscribe pair).
  extraHeaders?: string[];
  // Extra keys for the `email_sent` activity (Sequence id + step). Merged
  // UNDER the standard keys, so a caller can never overwrite them.
  activityMetadata?: Record<string, unknown>;
} & MessageContent;

type SendGmailInput = { bdId: string } & SendGmailBody;

type EmailAccountRow = typeof emailAccount.$inferSelect;

// Fail fast on the untrusted recipient, before any DB read or token refresh.
function assertSafeSendInput({ to, reply, extraHeaders, allowRecipientList }: SendGmailBody) {
  assertSafeHeaderValue("To", to);
  assertRecipients(to, { allowList: allowRecipientList });
  for (const line of extraHeaders ?? []) assertSafeExtraHeader(line);
  if (reply) {
    assertSafeHeaderValue("In-Reply-To", reply.inReplyTo);
    assertSafeHeaderValue("References", reply.references);
  }
}

export async function sendGmailMessage(input: SendGmailInput) {
  const { bdId, ...body } = input;
  assertSafeSendInput(body);
  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.bdId, bdId));
  return sendFromAccountRow(account, body);
}

// Entry point of the Sequence runner (design D4): same send body, account
// loaded by its own `email_account.id`, so the sender is that row's address.
export async function sendGmailMessageFromAccount(input: { accountId: string } & SendGmailBody) {
  const { accountId, ...body } = input;
  assertSafeSendInput(body);
  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.id, accountId));
  return sendFromAccountRow(account, body);
}

// The one send body (design D4): token refresh, error classification, the Gmail
// call and `recordSentEmail`. Every entry point loads an account row and lands
// here, so there is a single copy of this logic. The sender is always the
// row's own address, never a literal.
async function sendFromAccountRow(account: EmailAccountRow | undefined, input: SendGmailBody) {
  const { to, subject, leadId, companyKey, personId, reply, extraHeaders, activityMetadata, allowRecipientList } = input;
  const content: MessageContent =
    input.bodyHtml !== undefined ? { bodyHtml: input.bodyHtml } : { body: input.body };

  if (!account || account.status !== "connected" || !account.refreshTokenEncrypted) {
    throw new GmailSendError(
      "not_connected",
      "Gmail account not connected. Connect it at /account/email.",
    );
  }

  const configResult = getGmailOAuthConfig();
  if (!configResult.ok) {
    await db
      .update(emailAccount)
      .set({
        lastErrorMessage: `Gmail is not configured on the server (missing: ${configResult.missing.join(", ")}).`,
      })
      .where(eq(emailAccount.bdId, account.bdId));
    throw new GmailSendError(
      "not_configured",
      "Gmail is not configured on the server. Contact an admin.",
    );
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
      .where(eq(emailAccount.bdId, account.bdId));

    if (classification.kind === "config") {
      throw new GmailSendError(
        "not_configured",
        "Gmail is not configured correctly on the server. Contact an admin.",
      );
    }
    if (classification.kind === "revoked") {
      throw new GmailSendError(
        "reauth_required",
        "Gmail authorization expired. Reconnect at /account/email.",
      );
    }
    throw new GmailSendError("temporary", "Gmail authorization check failed. Try again shortly.");
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
      body: buildSendPayload(account.emailAddress, to, subject, content, reply, extraHeaders, allowRecipientList),
    },
  );

  if (!sendRes.ok) {
    const detail = await sendRes.text();
    await db
      .update(emailAccount)
      .set({ lastErrorMessage: `Gmail send failed: ${detail.slice(0, 300)}` })
      .where(eq(emailAccount.bdId, account.bdId));
    throw new GmailSendError("send_failed", `Gmail send failed: ${detail}`, undefined, sendRes.status);
  }

  const sent = await sendRes.json();

  await db
    .update(emailAccount)
    .set({ lastErrorMessage: null })
    .where(eq(emailAccount.bdId, account.bdId));

  // One metadata read for the Message-ID Gmail assigned (needed by "Responder").
  // Null on any failure — never fails the send; the sync fills the column later.
  const metadata = await readSentMessageMetadata({
    grantedScopes: account.grantedScopes,
    accessToken: access_token,
    gmailMessageId: sent.id,
  });

  await recordSentEmail({
    bdId: account.bdId,
    message: {
      bdEmail: account.emailAddress,
      to,
      subject,
      content,
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId,
      metadata,
    },
    activity: {
      type: "email_sent",
      leadId,
      companyKey,
      personId,
      actorBdId: account.bdId,
      metadata: { ...activityMetadata, to, subject, gmailMessageId: sent.id, gmailThreadId: sent.threadId },
    } as NewActivity,
  });

  if (leadId) revalidatePath(`/leads/${leadId}`);
  if (companyKey) revalidatePath(`/companies/${companyKey}`);
  if (personId) revalidatePath(`/contacts/${personId}`);

  return { messageId: sent.id, threadId: sent.threadId };
}
