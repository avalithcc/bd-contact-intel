/**
 * Decodes a Gmail API `users.messages.get` (format=full) resource into the
 * plain-object shape classify.ts works with. Pure — no network calls — so
 * tests build fixture JSON directly (tests/unit/gmailClassify.test.ts)
 * instead of ever hitting Google (HARD RULE: never call the Gmail API
 * against real mailboxes from a test).
 */

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
  bodyText: string | null;
  bodyHtml: string | null;
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

/**
 * Minimal sanitizer applied to the HTML body before it is ever persisted
 * (owner decision: store the full body, text/plain preferred, sanitized
 * HTML if kept). Strips `<script>`/`<style>` blocks and inline `on*` event
 * handlers. This branch never renders the stored HTML (no timeline UI
 * ships here) — sanitizing at write time means whatever renders it later
 * inherits the same floor rather than relying on every future render path
 * to re-sanitize.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}

export function parseGmailMessage(message: GmailApiMessage): ParsedGmailMessage {
  const headers = message.payload?.headers;
  const bodies: { text?: string; html?: string } = {};
  if (message.payload) collectBodies(message.payload, bodies);

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    from: findHeader(headers, "From"),
    to: findHeader(headers, "To"),
    cc: findHeader(headers, "Cc"),
    subject: findHeader(headers, "Subject") || null,
    bodyText: bodies.text ?? null,
    bodyHtml: bodies.html !== undefined ? sanitizeHtml(bodies.html) : null,
    sentAt: new Date(Number(message.internalDate)),
  };
}
