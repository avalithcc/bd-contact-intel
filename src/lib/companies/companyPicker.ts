/**
 * Pure rules for the new-contact dialog's company autocomplete (no db, no React). The statement lives in
 * companyPickerQuery.ts; the dialog in app/(app)/contacts/CompanyCombobox.tsx.
 *
 * Why this exists: the dialog used to derive the key from whatever was typed, so "Andina Tech" next to an existing
 * "Andina" quietly became a second company. These rules decide what the BD is shown instead.
 */
import { normalizeCompanyKey } from "@/lib/companyCategories";

export const PICKER_MIN_CHARS = 2;
export const PICKER_QUERY_MAX = 80;
/** Rows the dropdown ever shows: the BD refines the text, not a long list. Also the SQL LIMIT. */
export const PICKER_MAX = 8;

export interface PickerCompany {
  key: string;
  displayName: string;
  domain: string | null;
  contacts: number;
}

export interface PickerRow {
  company_key: string;
  display_name: string;
  domain: string | null;
  contacts: number | string;
}

export const toPickerCompany = (r: PickerRow): PickerCompany => ({
  key: r.company_key,
  displayName: r.display_name,
  domain: r.domain,
  contacts: Number(r.contacts),
});

/** Trim + collapse whitespace + cap. Under two characters the text is not worth searching: "" means "top companies". */
export function normalizePickerQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const q = raw.trim().replace(/\s+/g, " ").slice(0, PICKER_QUERY_MAX).trim();
  return q.length >= PICKER_MIN_CHARS ? q : "";
}

const compact = (key: string): string => key.replace(/[^a-z0-9]/g, "");

/**
 * Existing company keys worth fetching for a typed name even when the plain text search would not return them:
 * every leading whole-token prefix ("andina tech" -> "andina", "andina tech") plus the key without spaces
 * ("nubank" for "nu bank"). The search ANDs the typed words, so "Andina Tech" alone never finds "Andina"; this is
 * what lets the near-match warning see it. Exact primary-key probes, a handful of values.
 */
export function probeKeys(typed: string): string[] {
  const key = normalizeCompanyKey(typed);
  if (!key) return [];
  const tokens = key.split(" ");
  const keys = tokens.map((_, i) => tokens.slice(0, i + 1).join(" "));
  keys.push(compact(key));
  return [...new Set(keys.filter(Boolean))];
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}

/** Shortest key a prefix relation counts for: below this ("a", "la", "gl") a shared start means nothing. */
const MIN_PREFIX_CHARS = 4;
/** Both names must be at least this long for a one-letter typo to count; on short names one letter is a different word. */
const MIN_TYPO_CHARS = 6;

/**
 * Is `existing` close enough to `typed` that creating `typed` would probably split one company in two? Three
 * relations, nothing fuzzier, because a rule that fires on everything gets ignored:
 *  1. whole-token prefix: one name is the other plus extra words ("andina" / "andina tech"; "banco" / "banco galicia").
 *     The shorter side needs 4+ characters, and "banco" does NOT match "bancor" (a token prefix, not a text prefix).
 *  2. same letters, different spacing or punctuation ("nu bank" / "nubank").
 *  3. one letter off, on names of 6+ characters ("tecpetrl" / "tecpetrol").
 * Identical keys are never near each other. Limits, on purpose: two or more letters off ("globnat") and unrelated
 * synonyms are not caught, and the candidates are only what the search returned. The warning never blocks; it only
 * makes the split a visible choice.
 */
export function isNearKey(typedKey: string, existingKey: string): boolean {
  if (!typedKey || !existingKey || typedKey === existingKey) return false;
  const [short, long] = typedKey.length <= existingKey.length ? [typedKey, existingKey] : [existingKey, typedKey];
  if (short.length >= MIN_PREFIX_CHARS && long.startsWith(`${short} `)) return true;
  const a = compact(typedKey);
  const b = compact(existingKey);
  if (a === b) return a.length > 0;
  return Math.min(a.length, b.length) >= MIN_TYPO_CHARS && levenshteinAtMostOne(a, b);
}

/**
 * The existing company the typed name probably duplicates, or null. Several hits: the most populated is the real one.
 * When the typed name is itself an existing company, only a MORE populated neighbour counts: typing "Andina Tech"
 * (1 contact) while "Andina" (23) exists is the duplicate being made again, but typing "Andina" next to the small
 * "Andina Tech" is the right company and must not be nagged.
 */
export function findNearMatch(typed: string, candidates: readonly PickerCompany[]): PickerCompany | null {
  const typedKey = normalizeCompanyKey(typed);
  if (typedKey.length < PICKER_MIN_CHARS) return null;
  const exact = candidates.find((c) => c.key === typedKey);
  const near = candidates.filter((c) => isNearKey(typedKey, c.key) && (!exact || c.contacts > exact.contacts));
  if (!near.length) return null;
  return near.reduce((best, c) => (c.contacts > best.contacts ? c : best));
}

/** Keys in a result list that look like the smaller twin of another listed company: the "posible duplicado" badge. */
export function possibleDuplicateKeys(list: readonly PickerCompany[]): Set<string> {
  return new Set(list.filter((c) => list.some((d) => d.contacts > c.contacts && isNearKey(c.key, d.key))).map((c) => c.key));
}
