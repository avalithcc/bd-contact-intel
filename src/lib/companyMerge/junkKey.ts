/**
 * Decides whether a `company_key` is not a company at all ("-", "(sin dato)", "na", a single letter), as opposed to a
 * real employer written in any alphabet. Pure; scripts/repair-orphan-company-keys.ts is the driver, and a "junk" verdict
 * there DETACHES the contact (company text and key both cleared), so a false positive destroys data.
 *
 * HISTORY: this classifier was inline in the script and wrong twice. First it was `squash(key).length < 2`; then
 * `JUNK.has(squash(key)) || meaningfulChars(key) < 2` with `""` in the junk set, which short-circuited before the
 * script-agnostic count ever ran. Both flagged every non-Latin name as junk, because squash keeps [a-z0-9] only.
 * Here the squash is `string | null` (see keys.ts) and the junk words are matched only when there IS a squash, so the
 * "nothing left" case cannot reach the set. Whether a key is a placeholder WORD is decided on Latin text; whether it
 * has any content at all is decided by Unicode letters and digits, in any script.
 */
import { squashCompanyKey } from "./keys";

/** Placeholder words, in squashed form ("(sin dato)" -> "sindato", "N/A" -> "na"). Never contains "": see keys.ts. */
const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set(["sindato", "na", "none", "null"]);

/** Letters and digits of ANY script. Punctuation, quotes and whitespace do not count. */
export const meaningfulChars = (s: string): number => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

export function isJunkCompanyKey(key: string): boolean {
  if (meaningfulChars(key) < 2) return true; // "", "-", ".", "d", "«»": no content to keep
  const squashed = squashCompanyKey(key);
  return squashed !== null && PLACEHOLDER_WORDS.has(squashed);
}
