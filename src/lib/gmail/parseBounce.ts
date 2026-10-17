/**
 * Reads a delivery status notification (RFC 3464) out of the full Gmail payload. Pure: no IO, the input is never mutated.
 *
 * It only DESCRIBES what the notification claims. Whether the claim is true is not decided here: anyone can email
 * a mailbox a fake "bounce", so bouncePlan.ts acts on it only when it links to a message this BD really sent to that
 * address.
 *
 * Sources, in order of trust: the message/delivery-status part (Final-Recipient, Action, Status, Diagnostic-Code), then
 * the X-Failed-Recipients header with the status code found in the text. A message with neither (an out-of-office,
 * a person writing from a mailer-daemon-looking address) is not a bounce and returns null.
 */
import { extractEmailAddresses } from "./classify";
import type { GmailApiHeader, GmailApiMessage, GmailApiMessagePart } from "./parseMessage";

export type BounceSeverity = "hard" | "soft";
export type BounceReasonKey = "mailbox_not_found" | "domain_not_found" | "mailbox_full" | "blocked" | "too_large" | "other";

export interface BounceRecipient {
  /** The address the notification reports as failed, lower-cased. */
  address: string;
  /** Original-Recipient when it differs (the notification names the post-forwarding address in `address`). */
  originalAddress: string | null;
  severity: BounceSeverity;
  statusCode: string | null;
  reasonKey: BounceReasonKey;
  diagnostic: string | null;
}

export interface ParsedBounce {
  dsnGmailMessageId: string;
  gmailThreadId: string;
  occurredAt: Date;
  /** The notification's own sender (From), lower-cased: bouncePlan accepts only mailer-daemon / postmaster. */
  fromAddress: string;
  /** The Return-Path header as sent, or null when absent. A genuine DSN has the null path `<>`. */
  returnPath: string | null;
  /** Message-IDs the notification points at: In-Reply-To, References and the embedded original's own Message-ID. */
  linkRfcIds: string[];
  originalSubject: string | null;
  recipients: BounceRecipient[];
}

// An enhanced status code, never a slice of an IP address or of a longer dotted number ("[10.2.45.7]" holds a 2.45.7).
const STATUS_CODE = /(?<![\d.])([2-5]\.\d{1,3}\.\d{1,3})(?![\d.]*\d)/;
const MAX_DIAGNOSTIC = 240;

type Fields = Map<string, string>;

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function fieldsOfHeaders(headers: readonly GmailApiHeader[] | undefined): Fields {
  const out: Fields = new Map();
  for (const h of headers ?? []) if (!out.has(h.name.toLowerCase())) out.set(h.name.toLowerCase(), h.value.trim());
  return out;
}

/** RFC 822 style text (blank-line separated blocks, folded continuation lines) to one field map per block. */
function blocksOfText(text: string): Fields[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => {
      const fields: Fields = new Map();
      for (const line of block.replace(/\n[ \t]+/g, " ").split("\n")) {
        const at = line.indexOf(":");
        if (at > 0 && !fields.has(line.slice(0, at).trim().toLowerCase())) fields.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
      }
      return fields;
    })
    .filter((f) => f.size > 0);
}

function walk(part: GmailApiMessagePart | undefined, visit: (p: GmailApiMessagePart) => void): void {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

const textOf = (p: GmailApiMessagePart) => (p.body?.data ? decode(p.body.data) : "");

export function bounceReasonKey(statusCode: string | null, diagnostic: string | null): BounceReasonKey {
  const code = statusCode ?? "";
  if (/^[45]\.1\.2$/.test(code)) return "domain_not_found";
  if (/^[45]\.1\.(0|1|6|10)$/.test(code)) return "mailbox_not_found";
  if (/^[45]\.2\.2$/.test(code)) return "mailbox_full";
  if (/^[45]\.2\.3$|^[45]\.3\.4$/.test(code)) return "too_large";
  if (/^[45]\.7\./.test(code)) return "blocked";
  if ((code === "" || code === "5.0.0") && /user unknown|does not exist|no such user|recipient not found/i.test(diagnostic ?? "")) return "mailbox_not_found";
  return "other";
}

// "does not exist" counts only when the sentence is about the user, mailbox, recipient, address or account: relays, hosts
// and policies use the same words. "mailbox unavailable" is deliberately absent (greylisting, quota and policy use it).
const UNKNOWN_USER =
  /user unknown|unknown user|no such user|mailbox not found|address not found|invalid recipient|recipient not found|usuario no existe|el buz[oó]n no existe|usu[aá]rio n[aã]o existe|caixa postal n[aã]o existe|\b(user|mailbox|recipient|address|account)\b[^.;\n]{0,60}\bdoes not exist/i;
// "domain does not exist" says nothing about the mailbox (and is a different failure), so it is cut out before matching.
const DOMAIN_MISSING = /\b(domain|host|server)\b[^.;\n]{0,40}\bdoes not exist/gi;
// The bad-address codes: 5.1.3 (bad syntax), 5.1.7/5.1.8 (sender address problems) and 5.1.9 are not about the recipient.
const BAD_ADDRESS_STATUS = /^5\.1\.(0|1|2|4|5|6|10)$/;

/**
 * Hard means "this address is dead": a bad-address status (5.1.x), or a bare 5.0.0 / 550 whose text says the user or
 * mailbox does not exist. Everything else (policy or spam blocks 5.7.x, a full mailbox, every 4.x, a "failed" action
 * with a transient status) is soft: it is logged, but the address is not suppressed. Wrongly killing a live contact
 * costs far more than waiting for the next notification.
 */
function severityOf(action: string | undefined, statusCode: string | null, diagnostic: string | null): BounceSeverity | null {
  if (statusCode?.[0] === "2" || (action !== undefined && action !== "failed" && action !== "delayed")) return null;
  if (action === "delayed") return "soft";
  if (statusCode && BAD_ADDRESS_STATUS.test(statusCode)) return "hard";
  const bareReject = statusCode === "5.0.0" || (statusCode === null && /\b550\b/.test(diagnostic ?? ""));
  // Trade-off, on purpose: Microsoft 365 rejects with `550 5.4.1 Recipient address rejected: Access denied` for BOTH a missing
  // mailbox and a tenant policy, so it stays soft here. A false hard bounce suppresses a live contact; a missed one only
  // delays the suppression until a clearer notification arrives.
  return bareReject && UNKNOWN_USER.test((diagnostic ?? "").replace(DOMAIN_MISSING, "")) ? "hard" : "soft";
}

/** Control characters (a NUL breaks jsonb) and lone surrogates never reach storage. */
const clean = (value: string): string => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[\uD800-\uDFFF]/g, "");

const cleanAddress = (value: string | undefined) => extractEmailAddresses((value ?? "").replace(/^\s*[a-z0-9-]+\s*;\s*/i, ""))[0] ?? null;
const cleanDiagnostic = (value: string | undefined) => (value ? clean(value.replace(/^\s*smtp\s*;\s*/i, "")).slice(0, MAX_DIAGNOSTIC) : null);

export function parseBounce(message: GmailApiMessage): ParsedBounce | null {
  const top = fieldsOfHeaders(message.payload?.headers);
  const statusBlocks: Fields[] = [];
  const originals: Fields[] = [];
  let plainText = "";

  walk(message.payload, (p) => {
    const mime = (p.mimeType ?? "").toLowerCase();
    if (mime === "message/delivery-status") {
      if (p.headers?.length) statusBlocks.push(fieldsOfHeaders(p.headers));
      statusBlocks.push(...blocksOfText(textOf(p)));
    } else if (mime === "message/rfc822") {
      if (p.headers?.length) originals.push(fieldsOfHeaders(p.headers));
    } else if (mime === "text/rfc822-headers") {
      originals.push(...blocksOfText(textOf(p)).slice(0, 1));
    } else if (mime === "text/plain") {
      plainText += `\n${textOf(p)}`;
    }
  });

  const recipients: BounceRecipient[] = [];
  const seen = new Set<string>();
  const add = (r: BounceRecipient) => {
    if (!seen.has(r.address)) {
      seen.add(r.address);
      recipients.push(r);
    }
  };

  for (const block of statusBlocks) {
    const address = cleanAddress(block.get("final-recipient")) ?? cleanAddress(block.get("original-recipient"));
    if (!address) continue;
    const diagnostic = cleanDiagnostic(block.get("diagnostic-code"));
    // No Status field: the enhanced code usually still sits in the diagnostic ("550 5.7.1 ...").
    const statusCode = STATUS_CODE.exec(block.get("status") ?? "")?.[1] ?? STATUS_CODE.exec(diagnostic ?? "")?.[1] ?? null;
    const severity = severityOf(block.get("action")?.toLowerCase(), statusCode, diagnostic);
    if (!severity) continue;
    const originalAddress = cleanAddress(block.get("original-recipient"));
    add({ address, originalAddress: originalAddress && originalAddress !== address ? originalAddress : null, severity, statusCode, reasonKey: bounceReasonKey(statusCode, diagnostic), diagnostic });
  }

  if (recipients.length === 0 && statusBlocks.length === 0) {
    // Fallback for MTAs that attach no machine-readable report: the header names the address, the text carries the code.
    const failed = extractEmailAddresses(top.get("x-failed-recipients"));
    const text = `${plainText}\n${message.payload?.body?.data ? decode(message.payload.body.data) : ""}`;
    const statusCode = STATUS_CODE.exec(text)?.[1] ?? null;
    const delayed = /\(delay\)|delayed|warning/i.test(top.get("subject") ?? "");
    const snippet = statusCode ? (new RegExp(`.{0,60}${statusCode.replace(/\./g, "\\.")}.{0,120}`).exec(text)?.[0].trim() ?? "") : text.trim().slice(0, MAX_DIAGNOSTIC);
    const diagnostic = snippet ? clean(snippet).slice(0, MAX_DIAGNOSTIC) : null;
    const severity = severityOf(delayed ? "delayed" : "failed", statusCode, diagnostic);
    if (severity) for (const address of failed) add({ address, originalAddress: null, severity, statusCode, reasonKey: bounceReasonKey(statusCode, diagnostic), diagnostic });
  }
  if (recipients.length === 0) return null;

  const linkRfcIds = [
    ...new Set([
      ...(top.get("in-reply-to")?.match(/<[^>]+>/g) ?? []),
      ...(top.get("references")?.match(/<[^>]+>/g) ?? []),
      ...originals.flatMap((o) => o.get("message-id")?.match(/<[^>]+>/g) ?? []),
    ]),
  ];
  return {
    dsnGmailMessageId: message.id,
    gmailThreadId: message.threadId,
    // A missing internalDate must not throw later at toISOString(): fall back to "now" (the sync time).
    occurredAt: Number.isFinite(Number(message.internalDate)) && message.internalDate !== "" ? new Date(Number(message.internalDate)) : new Date(),
    fromAddress: extractEmailAddresses(top.get("from"))[0] ?? "",
    returnPath: top.get("return-path") ?? null,
    linkRfcIds,
    originalSubject: clean(originals.map((o) => o.get("subject")).find((s) => !!s) ?? "") || null,
    recipients,
  };
}
