/**
 * Pure side of phone search: decides whether the search box text is a phone number and reduces it to the digits the
 * SQL compares. No drizzle here so unit tests and client code can import it.
 *
 * A query is a phone search only when, after dropping spaces, dashes, dots, parentheses and ONE leading `+`, every
 * character is a digit and there are 6..15 of them. Anything else ("juan 5555 5555", "abc123456") stays a plain
 * name/company/email search, so a BD looking for a person never gets phone noise.
 *
 * Stored phones are E.164 (`+5491155555555`) but a BD types local forms (`11 5555 5555`, `011 15 5555 5555`,
 * `15 5555 5555`). The trunk `0`, the mobile `15` and the country code `54 9` all sit BEFORE the significant digits, so
 * the last PHONE_SUFFIX_LENGTH digits are the part every form shares. Queries of 8+ digits match on that suffix
 * (equality, backed by the `right(regexp_replace(...), 8)` indexes of migration 0051); 6-7 digit queries are too short
 * to carry a suffix and match as a substring of the stored digits.
 */

/** Keep in sync with migration 0051 and `phoneSearchCondition`. */
export const PHONE_SUFFIX_LENGTH = 8;
const MIN_DIGITS = 6;
const MAX_DIGITS = 15;
const SEPARATORS_RE = /[\s().-]/g;

export type PhoneSearch =
  | { mode: "suffix"; suffix: string; digits: string }
  | { mode: "contains"; digits: string };

export function parsePhoneSearch(q: string): PhoneSearch | null {
  const body = q.trim().replace(/^\+/, "").replace(SEPARATORS_RE, "");
  if (!/^\d+$/.test(body)) return null;
  if (body.length < MIN_DIGITS || body.length > MAX_DIGITS) return null;
  if (body.length < PHONE_SUFFIX_LENGTH) return { mode: "contains", digits: body };
  return { mode: "suffix", suffix: body.slice(-PHONE_SUFFIX_LENGTH), digits: body };
}
