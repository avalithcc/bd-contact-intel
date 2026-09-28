/**
 * Single source of truth for "is this Avalith itself" (as opposed to a
 * prospect/client company).
 *
 * BDs import their LinkedIn connections, which naturally include their own
 * Avalith coworkers. Product decision: coworkers are not relevant to this
 * BD-contact-intelligence system and must never enter it — not as contacts,
 * not as a company/account. See src/lib/queries.ts#upsertContacts (import
 * skip) and scripts/remove-own-company-contacts.ts (cleanup of rows that
 * were imported before this existed).
 *
 * Matching is case/accent/punctuation-insensitive by reusing the same
 * normalization every other company key in this app uses (see
 * src/lib/companyCategories.ts#normalizeCompanyKey), so "Avalith", "AVALITH",
 * "Avalith LLC" and "Avalith S.A." all resolve to the same key.
 *
 * Matching is always exact-key equality against this explicit list, never a
 * substring/`includes` check — "avalith" as a substring would also catch a
 * legitimately-named prospect (e.g. "Avalith Ventures"), which is exactly
 * the false positive src/lib/ownCompany.test.ts guards against.
 */
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { splitEmail } from "@/lib/emailPatterns";

// Display-name variants of Avalith itself. Kept as one list so adding
// another own-company (e.g. after a rebrand or a second internal entity)
// is a one-line change here rather than scattered conditionals.
//
// "Avalith.net" and "avalith.es" are two production `company` rows created
// from imports before this guard existed (found while cleaning up own-
// company leakage — see scripts/remove-own-company-contacts.ts): the
// company field was free-text and picked up the coworker's personal-site-
// style spelling instead of the plain "Avalith" name, so they normalized to
// a different key ("avalith net" / "avalith es") that the guard didn't
// recognize. Listed here as their own entries rather than folded into a
// substring rule so the match stays exact-key equality.
const OWN_COMPANY_NAMES = ["Avalith", "Avalith.net", "avalith.es"] as const;

const OWN_COMPANY_KEYS = new Set(OWN_COMPANY_NAMES.map(normalizeCompanyKey));

// Email domains that identify an Avalith coworker even when the free-text
// `company` field is missing, blank, or spelled in a way normalization
// doesn't catch.
const OWN_COMPANY_DOMAINS = new Set(["avalith.net", "avalith.com"]);

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

// Which signal matched — lets callers (see scripts/remove-own-company-contacts.ts)
// report "caught by company name" vs. "caught only by email domain, blank/
// unrecognizable company" separately, since the latter is easier to get
// wrong (a same-domain client, a personal address on a shared free-mail
// domain, etc.) and worth the owner's eyes before --apply.
export type OwnCompanyMatchReason = "name" | "domain" | null;

/**
 * Which signal (if any) identifies `nameOrKey`/`domain` as Avalith itself.
 * `nameOrKey` is a raw company display name, or an already normalized
 * company key (normalization is idempotent).
 */
export function ownCompanyMatchReason(
  nameOrKey: string | null | undefined,
  domain?: string | null,
): OwnCompanyMatchReason {
  const trimmed = nameOrKey?.trim();
  if (trimmed && OWN_COMPANY_KEYS.has(normalizeCompanyKey(trimmed))) return "name";
  if (domain) {
    const d = normalizeDomain(domain);
    if (d && OWN_COMPANY_DOMAINS.has(d)) return "domain";
  }
  return null;
}

/**
 * Every normalized company key that identifies Avalith itself — the source
 * of truth for scripts/remove-own-company-contacts.ts, so the cleanup
 * script never re-derives or hardcodes its own copy of this list and stays
 * in lockstep with whatever variants OWN_COMPANY_NAMES holds above.
 */
export function ownCompanyKeys(): string[] {
  return [...OWN_COMPANY_KEYS];
}

/**
 * True when `nameOrKey` or `domain` identifies Avalith itself.
 */
export function isOwnCompany(
  nameOrKey: string | null | undefined,
  domain?: string | null,
): boolean {
  return ownCompanyMatchReason(nameOrKey, domain) !== null;
}

/**
 * Splits any batch of contact-shaped rows into the ones that should be kept
 * vs. the ones to drop because they're Avalith's own coworkers — matched
 * either by `company` name or, when that's blank/unrecognizable, by the
 * domain of `email` (reusing the same email parser as the rest of the app,
 * see src/lib/emailPatterns.ts#splitEmail). Pulled out as a pure function
 * (no DB access) so the ingestion-time guard used by
 * src/lib/queries.ts#upsertContacts is unit-testable on its own, and so any
 * future ingestion source can reuse the exact same split.
 */
export function partitionOwnCompanyRows<
  T extends { company?: string | null; email?: string | null },
>(rows: T[]): { kept: T[]; skipped: T[] } {
  const kept: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    const emailDomain = row.email ? splitEmail(row.email)?.domain ?? null : null;
    (isOwnCompany(row.company, emailDomain) ? skipped : kept).push(row);
  }
  return { kept, skipped };
}
