/**
 * "Is this key the same company as one already on file, under another spelling?" Pure. Used by
 * scripts/repair-orphan-company-keys.ts (exact squash) and scripts/apply-grey-zone-decisions.ts (exact squash, then
 * prefix containment). The answer is a repoint of real contacts, so the contract is conservative: ONE unambiguous
 * target or nothing. Never a pick.
 *
 * Two bugs this replaces, both from inline code:
 *  - a key that squashes to nothing ("日本") matched the first company in the list, because
 *    `x.startsWith("")` is true; the SELECT had no ORDER BY, so the target was whichever row Postgres returned first.
 *  - `.find` returned the first of several hits (and `canonical` was first-wins on collisions), so two companies that
 *    both fit made the target arbitrary.
 */
import { squashCompanyKey } from "./keys";

/**
 * Shortest side a prefix match may rest on. "tech" prefixes techmahindra, techint and technisys; the ambiguity guard
 * only fires when several of them EXIST, not when the one that does is unrelated. 5 keeps "bunker"/"bunkerdb" and
 * "globant"/"globantsa" while refusing 3-4 character acronyms and common words. A pair that falls below it is
 * reported and left alone, which the owner can resolve by hand; a wrong repoint cannot be seen afterwards.
 */
export const MIN_PREFIX_LEN = 5;

export interface CompanyKeyIndex {
  /** Only keys that squash to something, sorted by key so every answer is independent of the SELECT's row order. */
  readonly entries: readonly { readonly key: string; readonly squashed: string }[];
}

export type SameCompanyResult =
  | { kind: "match"; to: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

export function buildCompanyKeyIndex(keys: readonly string[]): CompanyKeyIndex {
  const entries: { key: string; squashed: string }[] = [];
  for (const key of new Set(keys)) {
    const squashed = squashCompanyKey(key);
    if (squashed !== null) entries.push({ key, squashed });
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { entries };
}

const verdict = (keys: string[]): SameCompanyResult =>
  keys.length === 0 ? { kind: "none" } : keys.length === 1 ? { kind: "match", to: keys[0]! } : { kind: "ambiguous", candidates: keys };

/**
 * Exact squash equality wins outright (one hit: match, several: ambiguous). Only with `prefix: true`, and only when
 * there is no exact hit, does prefix containment in either direction apply, and only when the SHORTER side is at
 * least MIN_PREFIX_LEN long.
 */
export function findSameCompany(key: string, index: CompanyKeyIndex, opts: { prefix?: boolean } = {}): SameCompanyResult {
  const s = squashCompanyKey(key);
  if (s === null) return { kind: "none" }; // "could not normalize" is not a value to compare
  const exact = index.entries.filter((c) => c.squashed === s).map((c) => c.key);
  if (exact.length > 0 || !opts.prefix) return verdict(exact);
  const partial = index.entries
    .filter((c) => Math.min(c.squashed.length, s.length) >= MIN_PREFIX_LEN && (c.squashed.startsWith(s) || s.startsWith(c.squashed)))
    .map((c) => c.key);
  return verdict(partial);
}
