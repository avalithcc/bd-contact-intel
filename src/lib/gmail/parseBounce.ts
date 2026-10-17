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
  /** Message-IDs the notification points at: In-Reply-To, References and the embedded original's own Message-ID. */
  linkRfcIds: string[];
  originalSubject: string | null;
  recipients: BounceRecipient[];
}

const STATUS_CODE = /\b([2-5]\.\d{1,3}\.\d{1,3})\b/;
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
  if (code === "" && /user unknown|does not exist|no such user|recipient not found/i.test(diagnostic ?? "")) return "mailbox_not_found";
  return "other";
}

function severityOf(action: string | undefined, statusCode: string | null, fallbackHard: boolean): BounceSeverity | null {
  if (action === "failed") return "hard";
  if (action === "delayed") return "soft";
  if (action && action !== "failed") return statusCode?.[0] === "5" ? "hard" : statusCode?.[0] === "4" ? "soft" : null;
  if (statusCode?.[0] === "5") return "hard";
  if (statusCode?.[0] === "4") return "soft";
  return statusCode === null && fallbackHard ? "hard" : null;
}

const cleanAddress = (value: string | undefined) => extractEmailAddresses((value ?? "").replace(/^\s*[a-z0-9-]+\s*;\s*/i, ""))[0] ?? null;
const cleanDiagnostic = (value: string | undefined) => (value ? value.replace(/^\s*smtp\s*;\s*/i, "").slice(0, MAX_DIAGNOSTIC) : null);

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
    const statusCode = STATUS_CODE.exec(block.get("status") ?? "")?.[1] ?? null;
    const severity = severityOf(block.get("action")?.toLowerCase(), statusCode, false);
    if (!severity) continue;
    const diagnostic = cleanDiagnostic(block.get("diagnostic-code"));
    const originalAddress = cleanAddress(block.get("original-recipient"));
    add({ address, originalAddress: originalAddress && originalAddress !== address ? originalAddress : null, severity, statusCode, reasonKey: bounceReasonKey(statusCode, diagnostic), diagnostic });
  }

  if (recipients.length === 0 && statusBlocks.length === 0) {
    // Fallback for MTAs that attach no machine-readable report: the header names the address, the text carries the code.
    const failed = extractEmailAddresses(top.get("x-failed-recipients"));
    const text = `${plainText}\n${message.payload?.body?.data ? decode(message.payload.body.data) : ""}`;
    const statusCode = STATUS_CODE.exec(text)?.[1] ?? null;
    const delayed = /\(delay\)|delayed|warning/i.test(top.get("subject") ?? "");
    const severity = severityOf(delayed ? "delayed" : undefined, statusCode, true);
    const diagnostic = statusCode ? (new RegExp(`.{0,60}${statusCode.replace(/\./g, "\\.")}.{0,120}`).exec(text)?.[0].trim() ?? null) : null;
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
    occurredAt: new Date(Number(message.internalDate)),
    linkRfcIds,
    originalSubject: originals.map((o) => o.get("subject")).find((s) => !!s) ?? null,
    recipients,
  };
}
