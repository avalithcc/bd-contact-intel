// Pure helpers for a Lusha credit cap, shared by the admin table (personalCapLines, server) and the cap editor dialog (client). They live
// outside src/lib/lusha on purpose: a client component may only type-import that folder (tests/unit/lushaInert.test.ts), and a helper
// both sides call is one definition instead of two copies that a test has to keep in step.

export interface ContactsCopy {
  personalContacts: string;
  personalContactsOne: string;
  personalContactsNone: string;
  personalContactsBlocked: string;
}

/** What `credits` buys in contacts, as text. 0 is the kill switch, not a small allowance: it reads as blocked. */
export function capContactsText(credits: number, creditsPerContact: number, d: ContactsCopy): string {
  const n = Math.floor(credits / creditsPerContact);
  if (credits === 0) return d.personalContactsBlocked;
  return n === 0 ? d.personalContactsNone : n === 1 ? d.personalContactsOne : d.personalContacts.replace("{n}", String(n));
}

/**
 * The cap field has three outcomes that must never merge: empty = clear the cap (null), a whole number from 0 to `max` = that cap
 * (0 is blocked, not "none"), anything else = undefined (invalid). The RAW string is the input: a type=number field reports unparseable
 * text such as "-" or "1e" as "", which would read as "clear the cap" and silently lift a block.
 */
export function readCapField(text: string, max: number): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= max ? n : undefined;
}

/** Whether Save sends anything, and what: invalid input sends nothing at all. */
export function capSaveIntent(text: string, max: number): { send: false } | { send: true; cap: number | null } {
  const cap = readCapField(text, max);
  return cap === undefined ? { send: false } : { send: true, cap };
}
