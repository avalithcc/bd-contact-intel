import { randomBytes } from "node:crypto";
import { GmailSendError } from "@/lib/gmail/errors";
import { htmlToOutboundText } from "@/lib/gmail/outboundText";

/**
 * Builds the RFC 5322 message handed to the Gmail API `raw` field.
 * Pure (no db/env) so the bytes can be unit-tested.
 *
 * Text only  -> single-part text/plain (as before; base64 now wrapped at 76).
 * HTML given -> multipart/alternative, text/plain FIRST and text/html LAST
 *               (clients render the last alternative they understand).
 */
export type MessageContent =
  | { body: string; bodyHtml?: undefined }
  | { bodyHtml: string; body?: undefined };

const CRLF = "\r\n";

function toCrlf(s: string): string {
  return s.replace(/\r\n|\r|\n/g, CRLF);
}

/** RFC 2045: encoded lines must not exceed 76 characters. */
export function wrapBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join(CRLF) ?? "";
}

function partHeaders(contentType: string): string[] {
  return [`Content-Type: ${contentType}; charset="UTF-8"`, "Content-Transfer-Encoding: base64"];
}

function encodeContent(content: string): string {
  return wrapBase64(Buffer.from(toCrlf(content), "utf8").toString("base64"));
}

/** `_` never occurs in base64; the boundary is still verified against both parts. */
export function generateBoundary(
  parts: string[],
  random: () => string = () => randomBytes(12).toString("hex"),
): string {
  for (let i = 0; i < 10; i++) {
    const boundary = `=_bd_${random()}`;
    if (!parts.some((p) => p.includes(boundary))) return boundary;
  }
  throw new Error("Could not generate a MIME boundary that does not collide with the content");
}

/**
 * Throws for a header value containing CR, LF or NUL. Reject, don't strip:
 * silently dropping part of a recipient is worse than refusing to send.
 * Every value interpolated into a header WITHOUT encoding must pass this
 * (To, From). Subject is exempt: RFC 2047 base64 neutralises it.
 */
export function assertSafeHeaderValue(name: string, value: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new GmailSendError("invalid_header", `The ${name} header contains a control character (CR, LF or NUL)`, name);
  }
}

/**
 * Threading headers of a reply. Both values come from mail someone else sent
 * (a Message-ID is chosen by the sender), so they are attacker-influenced and
 * pass the same guard as To/From.
 */
export interface ThreadingHeaders {
  inReplyTo: string;
  references: string;
}

/** What `sendGmailMessage` needs to continue an existing Gmail thread. */
export interface ReplyTarget extends ThreadingHeaders {
  threadId: string;
}

const FOLD_AT = 76;

/** RFC 5322 folding: break a long id list only at the spaces that already separate ids. */
function foldIdList(name: string, value: string): string {
  const lines: string[] = [];
  let line = `${name}:`;
  for (const id of value.split(/\s+/).filter(Boolean)) {
    if (line.length + 1 + id.length > FOLD_AT && line.trim() !== `${name}:`) {
      lines.push(line);
      line = ` ${id}`;
    } else {
      line += ` ${id}`;
    }
  }
  lines.push(line);
  return lines.join(CRLF);
}

export function buildRawMessage(
  from: string,
  to: string,
  subject: string,
  content: MessageContent,
  boundaryRandom?: () => string,
  reply?: ThreadingHeaders,
): string {
  assertSafeHeaderValue("From", from);
  assertSafeHeaderValue("To", to);
  if (reply) {
    assertSafeHeaderValue("In-Reply-To", reply.inReplyTo);
    assertSafeHeaderValue("References", reply.references);
  }
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const threading = reply
    ? [foldIdList("In-Reply-To", reply.inReplyTo), foldIdList("References", reply.references)]
    : [];
  const envelope = [`From: ${from}`, `To: ${to}`, `Subject: ${encodedSubject}`, ...threading, "MIME-Version: 1.0"];

  let message: string;
  if (content.bodyHtml === undefined) {
    message = [...envelope, ...partHeaders("text/plain"), "", encodeContent(content.body)].join(CRLF);
  } else {
    const text = htmlToOutboundText(content.bodyHtml);
    const boundary = generateBoundary([text, content.bodyHtml], boundaryRandom);
    message = [
      ...envelope,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      ...partHeaders("text/plain"),
      "",
      encodeContent(text),
      `--${boundary}`,
      ...partHeaders("text/html"),
      "",
      encodeContent(content.bodyHtml),
      `--${boundary}--`,
      "",
    ].join(CRLF);
  }
  return Buffer.from(message, "utf8").toString("base64url");
}

/**
 * The JSON body of Gmail's `messages.send`. `threadId` is added ONLY for a
 * reply: without it Gmail files the message in a new thread even when the
 * headers match; with it, Gmail still requires the subject and References to
 * line up, which the reply planner guarantees. A new email serialises to
 * `{"raw":"..."}` exactly as before.
 */
export function buildSendPayload(
  from: string,
  to: string,
  subject: string,
  content: MessageContent,
  reply?: ReplyTarget,
): string {
  const raw = buildRawMessage(from, to, subject, content, undefined, reply);
  return JSON.stringify(reply ? { raw, threadId: reply.threadId } : { raw });
}
