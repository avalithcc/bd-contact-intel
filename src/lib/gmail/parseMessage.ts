/**
 * Decodes a Gmail API `users.messages.get` (format=full) resource into the
 * plain-object shape classify.ts works with. Pure — no network calls — so
 * tests build fixture JSON directly (tests/unit/gmailClassify.test.ts)
 * instead of ever hitting Google (HARD RULE: never call the Gmail API
 * against real mailboxes from a test).
 */
import { htmlToPlainText } from "./htmlToText";
import { truncateBodyText } from "./truncateBodyText";

export interface GmailApiHeader {
  name: string;
  value: string;
}

export interface GmailApiMessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailApiMessagePart[];
}

export interface GmailApiMessage {
  id: string;
  threadId: string;
  // Gmail returns this as a string (ms since epoch), not a number.
  internalDate: string;
  payload?: GmailApiMessagePart & { headers?: GmailApiHeader[] };
}

export interface ParsedGmailMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string | null;
  // text/plain preferred; an HTML-only message is converted to plain text
  // (htmlToText.ts) — we never store HTML at all (fresh-review fix: an
  // allow-list HTML sanitizer is bypassable). Capped at
  // truncateBodyText.MAX_BODY_TEXT_BYTES; see `bodyTruncated`.
  bodyText: string | null;
  bodyTruncated: boolean;
  sentAt: Date;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function findHeader(headers: GmailApiHeader[] | undefined, name: string): string {
  const header = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

/** Walks a (possibly multipart) message body, keeping the FIRST text/plain
 * and FIRST text/html part found — Gmail lists the preferred alternative
 * first in `multipart/alternative`. */
function collectBodies(part: GmailApiMessagePart | undefined, out: { text?: string; html?: string }): void {
  if (!part) return;
  if (part.mimeType === "text/plain" && part.body?.data && out.text === undefined) {
    out.text = decodeBase64Url(part.body.data);
  } else if (part.mimeType === "text/html" && part.body?.data && out.html === undefined) {
    out.html = decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) collectBodies(child, out);
}

export function parseGmailMessage(message: GmailApiMessage): ParsedGmailMessage {
  const headers = message.payload?.headers;
  const bodies: { text?: string; html?: string } = {};
  if (message.payload) collectBodies(message.payload, bodies);

  // text/plain as-is; an HTML-only body is converted to text (never stored
  // as HTML — see htmlToText.ts's doc comment for why).
  const rawBody = bodies.text ?? (bodies.html !== undefined ? htmlToPlainText(bodies.html) : null);
  const { text: bodyText, truncated: bodyTruncated } = rawBody !== null ? truncateBodyText(rawBody) : { text: null, truncated: false };

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    from: findHeader(headers, "From"),
    to: findHeader(headers, "To"),
    cc: findHeader(headers, "Cc"),
    subject: findHeader(headers, "Subject") || null,
    bodyText,
    bodyTruncated,
    sentAt: new Date(Number(message.internalDate)),
  };
}
