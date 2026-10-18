import { splitEmail } from "@/lib/emailPatterns";
import { GmailSendError } from "@/lib/gmail/errors";

/**
 * The product sends every message to exactly ONE bare address (the Contact's own; a scheduled email may only go to
 * it, see scheduledEmail/recipient.ts). So `To` must be a single `local@domain`: no display name, no list. Pure.
 *
 * CR/LF/NUL are the header guard's job (assertSafeHeaderValue) and run BEFORE this check; whitespace here is only
 * ever a separator or a malformed address.
 */
export type RecipientShape = { ok: true } | { ok: false; reason: "malformed" | "multiple" };

const LOCAL_CHARS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export function checkRecipientShape(to: string): RecipientShape {
  const value = to.trim();
  if (!value) return { ok: false, reason: "malformed" };
  const addressLike = value.split(/[\s,;]+/).filter((t) => t.includes("@"));
  if (/[,;]/.test(value) || addressLike.length > 1) return { ok: false, reason: "multiple" };
  const parts = splitEmail(value);
  if (!parts || /\s/.test(value)) return { ok: false, reason: "malformed" };
  const { localPart, domain } = parts;
  const labels = domain.split(".");
  const localOk = LOCAL_CHARS.test(localPart) && !localPart.startsWith(".") && !localPart.endsWith(".") && !localPart.includes("..");
  const domainOk = labels.length >= 2 && labels.every((l) => DOMAIN_LABEL.test(l)) && labels[labels.length - 1].length >= 2 && !/^[0-9]+$/.test(labels[labels.length - 1]); // punycode (xn--...) labels pass; a numeric TLD (an IP) does not
  return localOk && domainOk ? { ok: true } : { ok: false, reason: "malformed" };
}

/** Gmail sync stores the real To list of a message; a thread reply may go to all of them, up to this many. */
export const MAX_REPLY_RECIPIENTS = 20;

function fail(reason: "malformed" | "multiple"): never {
  throw new GmailSendError("invalid_recipient", `The To address is not a valid recipient (${reason})`, reason);
}

/**
 * Throws `invalid_recipient` (the reason rides in `header`: "malformed" | "multiple"). Nothing is sent.
 * Default: exactly one address. `allowList` is ONLY for a thread reply: a comma/semicolon list where EACH address
 * passes the single-address check, at most MAX_REPLY_RECIPIENTS.
 */
export function assertRecipients(to: string, opts: { allowList?: boolean } = {}): void {
  if (!opts.allowList) {
    const shape = checkRecipientShape(to);
    if (!shape.ok) fail(shape.reason);
    return;
  }
  const items = to.split(/[,;]/).map((s) => s.trim());
  if (items.length === 0 || items.some((a) => !a || !checkRecipientShape(a).ok)) fail("malformed");
  if (items.length > MAX_REPLY_RECIPIENTS) fail("multiple");
}

export const assertSingleRecipient = (to: string): void => assertRecipients(to);
