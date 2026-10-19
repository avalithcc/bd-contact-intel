import { randomBytes } from "node:crypto";
import { GmailSendError } from "@/lib/gmail/errors";
import { htmlToOutboundText } from "@/lib/gmail/outboundText";
import { assertRecipients, checkRecipientShape } from "@/lib/gmail/recipient";
import { attachmentHeaders, type MimeAttachment } from "@/lib/gmail/mimeAttachments";
import { foldSubjectHeader } from "@/lib/gmail/subjectEncoding";

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

/**
 * The text/plain part of a message exactly as Gmail will hold it (CRLF line
 * endings, HTML converted by htmlToOutboundText). The ONE derivation of that
 * text: the MIME builder encodes it and the send path stores it as
 * `email_message.body_text`, so the stored body equals what the Gmail sync
 * would later read back from the same message.
 */
export function plainTextPart(content: MessageContent): string {
  return toCrlf(content.bodyHtml === undefined ? content.body : htmlToOutboundText(content.bodyHtml));
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

// Headers the builder owns. An extra line may never repeat one: a forged Bcc/To/From or a second Content-Type
// would reach the recipient as a duplicate of a real header.
const RESERVED_HEADER_NAMES = new Set([
  "from", "to", "cc", "bcc", "subject", "mime-version", "content-type", "content-transfer-encoding",
  "in-reply-to", "references", "reply-to", "sender", "date", "message-id",
]);

/**
 * Guard for a caller-supplied complete header line. Beyond CR/LF/NUL (assertSafeHeaderValue) the line must be
 * structurally a single new header: `Name: value`. An empty string would end the header block, a leading space or
 * tab would fold into the previous header, and a reserved name would duplicate one the builder writes itself.
 */
export function assertSafeExtraHeader(line: string): void {
  assertSafeHeaderValue("Extra header", line);
  if (!/^[A-Za-z0-9-]+: \S/.test(line)) {
    throw new GmailSendError("invalid_header", "An extra header must have the shape 'Name: value'", "Extra header");
  }
  const name = line.slice(0, line.indexOf(":")).toLowerCase();
  if (RESERVED_HEADER_NAMES.has(name)) {
    throw new GmailSendError("invalid_header", `The ${name} header is set by the sender and cannot be added as an extra header`, "Extra header");
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

export interface BuildMimeInput {
  from: string;
  /** One address, or (when `allowRecipientList`) a comma/semicolon list. Untrimmed: edge CR/LF is rejected, not dropped. */
  to: string;
  subject: string;
  content: MessageContent;
  boundaryRandom?: () => string;
  reply?: ThreadingHeaders;
  /** Complete `Name: value` lines (e.g. the Sequence List-Unsubscribe pair), appended after the threading headers. */
  extraHeaders?: string[];
  /** A list in `To` is allowed for a thread reply and for a multi-recipient send; every address still passes the single-address check. */
  allowRecipientList?: boolean;
  /** Visible copy recipients. The caller has already applied the product rule (internal domain only); each is still shape-checked. */
  cc?: readonly string[];
  /** When present the message becomes multipart/mixed: the body part(s) first, then one part per file. */
  attachments?: readonly MimeAttachment[];
}

/** The text/plain part, or the multipart/alternative of text + html: the headers and body lines of ONE entity. */
function bodyEntity(content: MessageContent, boundaryRandom?: () => string, taken: string[] = []): { headers: string[]; lines: string[] } {
  if (content.bodyHtml === undefined) {
    return { headers: partHeaders("text/plain"), lines: ["", encodeContent(plainTextPart(content))] };
  }
  const text = plainTextPart(content);
  const boundary = generateBoundary([text, content.bodyHtml, ...taken], boundaryRandom);
  return {
    headers: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
    lines: [
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
    ],
  };
}

function checkCc(cc: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of cc) {
    assertSafeHeaderValue("Cc", raw);
    const address = raw.trim();
    if (!checkRecipientShape(address).ok) {
      throw new GmailSendError("invalid_recipient", "The Cc address is not a valid recipient (malformed)", "malformed");
    }
    out.push(address);
  }
  return out;
}

/**
 * The RFC 5322 message as text (CRLF line endings, 7-bit: every body, header word and file is base64 or encoded).
 * `buildRawMessage` is this, base64url-encoded for Gmail's JSON `raw` field; an attachment send uploads it as-is.
 */
export function buildMimeMessage(input: BuildMimeInput): string {
  const { from, to: rawTo, subject, content, boundaryRandom, reply, extraHeaders = [], allowRecipientList = false, attachments = [] } = input;
  assertSafeHeaderValue("From", from);
  assertSafeHeaderValue("To", rawTo); // on the untrimmed value: edge CR/LF is rejected, not silently dropped
  const to = rawTo.trim();
  assertRecipients(to, { allowList: allowRecipientList });
  const cc = checkCc(input.cc ?? []);
  if (reply) {
    assertSafeHeaderValue("In-Reply-To", reply.inReplyTo);
    assertSafeHeaderValue("References", reply.references);
  }
  for (const line of extraHeaders) assertSafeExtraHeader(line);
  const threading = reply
    ? [foldIdList("In-Reply-To", reply.inReplyTo), foldIdList("References", reply.references)]
    : [];
  const envelope = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    foldSubjectHeader(subject),
    ...threading,
    ...extraHeaders,
    "MIME-Version: 1.0",
  ];

  if (attachments.length === 0) {
    const entity = bodyEntity(content, boundaryRandom);
    return [...envelope, ...entity.headers, ...entity.lines].join(CRLF);
  }
  // "=_bd_..." cannot occur in base64, so only the text parts can collide with a boundary.
  const mixed = generateBoundary([plainTextPart(content), content.bodyHtml ?? ""], boundaryRandom);
  const entity = bodyEntity(content, boundaryRandom, [mixed]);
  const bodyLines = entity.lines[entity.lines.length - 1] === "" ? entity.lines.slice(0, -1) : entity.lines;
  return [
    ...envelope,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    ...entity.headers,
    ...bodyLines,
    ...attachments.flatMap((att) => [
      `--${mixed}`,
      ...attachmentHeaders(att),
      "",
      wrapBase64(Buffer.from(att.data).toString("base64")),
    ]),
    `--${mixed}--`,
    "",
  ].join(CRLF);
}

/**
 * `extraHeaders` are complete `Name: value` lines (e.g. the Sequence List-Unsubscribe pair), appended after the
 * threading headers. They are unencoded, so each goes through the same CR/LF/NUL guard as To/From.
 */
export function buildRawMessage(
  from: string,
  rawTo: string,
  subject: string,
  content: MessageContent,
  boundaryRandom?: () => string,
  reply?: ThreadingHeaders,
  extraHeaders: string[] = [],
  // Only a thread reply or a multi-recipient send may carry several recipients (see assertRecipients).
  allowRecipientList = false,
  cc: readonly string[] = [],
): string {
  const message = buildMimeMessage({ from, to: rawTo, subject, content, boundaryRandom, reply, extraHeaders, allowRecipientList, cc });
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
  extraHeaders?: string[],
  allowRecipientList = false,
  cc: readonly string[] = [],
): string {
  const raw = buildRawMessage(from, to, subject, content, undefined, reply, extraHeaders, allowRecipientList, cc);
  return JSON.stringify(reply ? { raw, threadId: reply.threadId } : { raw });
}

/**
 * Gmail's media-upload form of `messages.send` (`uploadType=multipart`), used when the message carries files: the JSON
 * `raw` field is limited to about 5 MB, the upload accepts the whole message (up to 35 MB) as `message/rfc822`.
 * The first part is the metadata, which is where `threadId` goes for a reply.
 */
export function buildUploadRequest(message: string, threadId?: string): { contentType: string; body: string } {
  const boundary = generateBoundary([message]);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(threadId ? { threadId } : {}),
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "",
    message,
    `--${boundary}--`,
    "",
  ].join(CRLF);
  return { contentType: `multipart/related; boundary="${boundary}"`, body };
}
