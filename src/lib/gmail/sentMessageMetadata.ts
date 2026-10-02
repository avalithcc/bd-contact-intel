/**
 * Reads back the RFC `Message-ID` / `References` Gmail assigned to a message
 * this app just sent (one `messages.get?format=metadata`), plus its
 * `internalDate`. Gmail, not us, assigns the Message-ID, and "Responder"
 * needs it on the newest message of a thread (replyThread.ts).
 *
 * Never throws: the send already succeeded and the stored row is only an
 * optimisation, so every failure (HTTP error, network error, timeout, a
 * payload without a usable date) resolves to `null` and the caller writes a
 * row with null rfc columns for the sync to fill later.
 */
import { needsReconnectForSync } from "./needsReconnectForSync";
import { parseGmailMessage, type GmailApiMessage } from "./parseMessage";

export interface SentMessageMetadata {
  rfcMessageId: string | null;
  references: string | null;
  sentAt: Date;
}

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const READBACK_TIMEOUT_MS = 4000;

export async function fetchSentMessageMetadata(
  accessToken: string,
  gmailMessageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SentMessageMetadata | null> {
  try {
    const params = new URLSearchParams({ format: "metadata" });
    params.append("metadataHeaders", "Message-ID");
    params.append("metadataHeaders", "References");
    const res = await fetchImpl(`${GMAIL_API_BASE}/messages/${encodeURIComponent(gmailMessageId)}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(READBACK_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const message = (await res.json()) as GmailApiMessage;
    const parsed = parseGmailMessage(message);
    if (Number.isNaN(parsed.sentAt.getTime())) return null;
    return { rfcMessageId: parsed.rfcMessageId, references: parsed.references, sentAt: parsed.sentAt };
  } catch {
    return null;
  }
}

/**
 * `messages.get` needs `gmail.readonly`; an account that lacks it (the legacy
 * send-only connection `needsReconnectForSync` detects) would get a 403 after
 * paying the whole timeout on every send, and the sync skips such accounts, so
 * nothing could ever fill the Message-ID. Skip the call without touching the
 * network. The caller still stores the row (body and timeline entry), with a
 * null Message-ID.
 */
export async function readSentMessageMetadata(input: {
  grantedScopes: string | null | undefined;
  accessToken: string;
  gmailMessageId: string;
  fetchImpl?: typeof fetch;
}): Promise<SentMessageMetadata | null> {
  if (needsReconnectForSync(input.grantedScopes)) return null;
  return fetchSentMessageMetadata(input.accessToken, input.gmailMessageId, input.fetchImpl);
}
