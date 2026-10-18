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
  const domainOk = labels.length >= 2 && labels.every((l) => DOMAIN_LABEL.test(l)) && /[a-z]{2,}$/.test(labels[labels.length - 1]);
  return localOk && domainOk ? { ok: true } : { ok: false, reason: "malformed" };
}

/** Throws `invalid_recipient` (the reason rides in `header`: "malformed" | "multiple"). Nothing is sent. */
export function assertSingleRecipient(to: string): void {
  const shape = checkRecipientShape(to);
  if (!shape.ok) throw new GmailSendError("invalid_recipient", `The To address is not a single valid email (${shape.reason})`, shape.reason);
}
