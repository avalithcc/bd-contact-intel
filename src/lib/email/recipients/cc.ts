import { checkRecipientShape } from "@/lib/gmail/recipient";

/**
 * "CC" of a composed email. Owner decision: CC is ONLY for internal colleagues, i.e. addresses on the exact domain
 * avalith.net. No Bcc. A CC'd colleague is not a CRM contact, so nothing is logged for them. Pure.
 *
 * "Exact" means the whole text after the last `@`, case-insensitive: a subdomain (mail.avalith.net), a suffix
 * (avalith.net.evil.com), a prefix (evilavalith.net) and a look-alike (Cyrillic letters) are all different domains.
 */
export const INTERNAL_CC_DOMAIN = "avalith.net";
export const MAX_CC = 10;

export type CcRefusal = "cc_invalid" | "cc_not_internal" | "cc_too_many";

export type CcCheck = { ok: true; cc: string[] } | { ok: false; reason: CcRefusal };

/** Normalised (trimmed, lowercase) address, or the reason it cannot be a CC. */
export function checkCcAddress(raw: string): { ok: true; address: string } | { ok: false; reason: "cc_invalid" | "cc_not_internal" } {
  const value = typeof raw === "string" ? raw.trim() : "";
  const at = value.lastIndexOf("@");
  if (at < 0 || /[\s\u0000-\u001f]/.test(value)) {
    return at >= 0 && value.slice(at + 1).toLowerCase() !== INTERNAL_CC_DOMAIN ? { ok: false, reason: "cc_not_internal" } : { ok: false, reason: "cc_invalid" };
  }
  if (value.slice(at + 1).toLowerCase() !== INTERNAL_CC_DOMAIN) return { ok: false, reason: "cc_not_internal" };
  if (!checkRecipientShape(value).ok) return { ok: false, reason: "cc_invalid" };
  return { ok: true, address: value.toLowerCase() };
}

/**
 * The whole CC list: each address valid and internal, no duplicates, nothing already in Para (an address cannot be
 * both), at most MAX_CC. `paraAddresses` are the normalised addresses of the Para recipients.
 */
export function checkCcList(raw: readonly string[], paraAddresses: readonly string[]): CcCheck {
  const taken = new Set(paraAddresses.map((a) => a.trim().toLowerCase()));
  const cc: string[] = [];
  for (const entry of raw) {
    const checked = checkCcAddress(entry);
    if (!checked.ok) return checked;
    if (taken.has(checked.address)) continue;
    taken.add(checked.address);
    cc.push(checked.address);
  }
  return cc.length > MAX_CC ? { ok: false, reason: "cc_too_many" } : { ok: true, cc };
}
