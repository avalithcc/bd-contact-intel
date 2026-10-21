import { db } from "@/db";
import { emailAccount, type NewActivity } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptToken } from "@/lib/gmail/crypto";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { classifyTokenRefreshError, GmailSendError } from "@/lib/gmail/errors";
import { revalidatePath } from "next/cache";
import { revalidateContactSurfaces } from "@/lib/contacts/revalidateContactSurfaces";
import { recordSentEmail } from "@/lib/gmail/sentEmailQueries";
import { readSentMessageMetadata } from "@/lib/gmail/sentMessageMetadata";
import { assertRecipients } from "@/lib/gmail/recipient";
import { assertSafeExtraHeader, assertSafeHeaderValue, buildMimeMessage, buildSendPayload, buildUploadRequest, type MessageContent, type ReplyTarget } from "@/lib/gmail/rawMessage";
import type { MimeAttachment } from "@/lib/gmail/mimeAttachments";

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
  // True for a thread reply (recipients come from the stored thread) and for a composed email with several "Para" contacts.
  allowRecipientList?: boolean;
  // email-attachments-recipients (the composed email and its scheduled form only; Sequences never set these):
  // validated internal Cc addresses (@avalith.net) ...
  cc?: string[];
  // ... files whose bytes were already loaded from Storage and checked (src/lib/email/attachments/load.ts) ...
  attachments?: (MimeAttachment & { size: number })[];
  // ... and ALL the "Para" contacts (the primary `personId` included) when there are several: the email is ONE message
  // and one email_sent activity is written on each of their records.
  recipients?: { personId: string; name: string; email: string }[];
  // Complete `Name: value` header lines (Sequence List-Unsubscribe pair).
  extraHeaders?: string[];
  // Extra keys for the `email_sent` activity (Sequence id + step). Merged
  // UNDER the standard keys, so a caller can never overwrite them.
  activityMetadata?: Record<string, unknown>;
} & MessageContent;

type SendGmailInput = { bdId: string } & SendGmailBody;

type EmailAccountRow = typeof emailAccount.$inferSelect;

const GMAIL_UPLOAD_SEND_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart";

// Gmail's media-upload form of messages.send: the whole RFC 822 message as `message/rfc822`, `threadId` in the metadata part.
function uploadSendInit(accessToken: string, message: string, threadId?: string): RequestInit {
  const { contentType, body } = buildUploadRequest(message, threadId);
  return { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType }, body };
}

/**
 * The recipient/attachment keys of the `email_sent` activity. A plain single-recipient send keeps writing `to` as the one
 * address string, exactly as before; several Para contacts write the address array plus who they are, and files are
 * recorded by name and size only (the CRM does not keep them).
 */
function composedMetadata(to: string, input: SendGmailBody): Record<string, unknown> {
  const recipients = input.recipients ?? [];
  const multi = recipients.length > 1;
  return {
    to: multi ? recipients.map((r) => r.email) : to,
    ...(multi ? { recipients: recipients.map((r) => ({ personId: r.personId, name: r.name, email: r.email })) } : {}),
    ...(input.cc?.length ? { cc: input.cc } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments.map((a) => ({ filename: a.filename, size: a.size })) } : {}),
  };
}

// Fail fast on the untrusted recipient, before any DB read or token refresh.
function assertSafeSendInput({ to, reply, extraHeaders, allowRecipientList, cc }: SendGmailBody) {
  assertSafeHeaderValue("To", to);
  assertRecipients(to, { allowList: allowRecipientList });
  for (const address of cc ?? []) {
    assertSafeHeaderValue("Cc", address);
    assertRecipients(address); // each Cc is exactly one bare address
  }
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
  const { subject, leadId, companyKey, personId, reply, extraHeaders, activityMetadata, allowRecipientList } = input;
  const cc = input.cc ?? [];
  const attachments = input.attachments ?? [];
  const to = input.to.trim(); // the guard ran on the raw value (assertSafeSendInput); the stored and sent address is the trimmed one
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
    attachments.length ? GMAIL_UPLOAD_SEND_URL : "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    attachments.length
      ? uploadSendInit(
          access_token,
          buildMimeMessage({ from: account.emailAddress, to, subject, content, reply, extraHeaders, allowRecipientList, cc, attachments }),
          reply?.threadId,
        )
      : {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: buildSendPayload(account.emailAddress, to, subject, content, reply, extraHeaders, allowRecipientList, cc),
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
      cc,
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
      metadata: {
        ...activityMetadata,
        ...composedMetadata(to, input),
        subject,
        gmailMessageId: sent.id,
        gmailThreadId: sent.threadId,
      },
    } as NewActivity,
    // One activity per OTHER "Para" contact, sharing the one email_message (the sync does the same for a message it reads).
    alsoRecordFor: (input.recipients ?? []).filter((r) => r.personId !== personId).map((r) => r.personId),
  });

  if (leadId) revalidatePath(`/leads/${leadId}`);
  // The raw key is kept alongside the helper's canonical one: it may be an alias (a no-op path) or the only company a
  // company-level send (no person) has, and revalidating a path that does not exist costs nothing.
  if (companyKey) revalidatePath(`/companies/${companyKey}`);
  if (personId) await revalidateContactSurfaces(personId);

  return { messageId: sent.id, threadId: sent.threadId };
}
