/**
 * Pure identity matcher (design D3) and property-merge helper (contact-
 * identity R7) for the unified Contact model. Shared by the collapse/
 * fold-leads migration (in-memory IdentityIndex, Phase 3-4), CSV import and
 * any future ingestion source (DB-backed IdentityIndex) — see design.md
 * "Identity matcher (R2, R8)".
 *
 * No DB access here: callers supply an IdentityIndex implementation, so the
 * matcher itself stays unit-testable (tests/unit/identityMatcher.test.ts)
 * without a database.
 */
import { normalizeProfileKey } from "@/lib/csv";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { normalizeNameKey } from "@/lib/leads/csv";
import { ownCompanyMatchReason } from "@/lib/ownCompany";
import { splitEmail } from "@/lib/emailPatterns";

export type PersonId = string;

// Same vocabulary as contact.email_status / lead.email_status.
export type EmailStatus = "verified" | "probable" | "none";

/**
 * Looks up existing Contacts by each matcher key. Implementations are
 * responsible for the "both sides verified" half of the verified-email rule
 * (contact-identity spec): byVerifiedEmail MUST only return a hit whose
 * OWN stored email is also `verified` — the matcher only guarantees the
 * *incoming* row is verified before calling it.
 */
export interface IdentityIndex {
  byProfileKey(key: string): PersonId | null;
  byVerifiedEmail(email: string): PersonId | null;
  byNameCompany(key: string): PersonId[];
}

export type MatchResult =
  | { kind: "skip_own_company"; reason: "name" | "domain" }
  | { kind: "auto"; personId: PersonId; key: "profile_key" | "verified_email" }
  | { kind: "review"; personIds: PersonId[]; key: "name_company" }
  // Strong-key conflict: the profile key and the verified email each match
  // a DIFFERENT existing Contact. Never auto-merge here — a shared LinkedIn
  // profile key with a mismatched verified email is more likely a data
  // error (or two different people) than the same person, so it goes to
  // the admin duplicate-review queue like a name+company match, but keeps
  // its own reason/shape so the review UI can explain *why* it's flagged.
  | { kind: "review"; reason: "conflicting_strong_keys"; candidates: PersonId[] }
  | { kind: "new" };

export interface MatchableRow {
  profileKey?: string | null;
  email?: string | null;
  emailStatus?: EmailStatus | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
}

/**
 * Normalized `name::company` key used for the (never auto-merging)
 * name+company fallback. Null when there's no usable name or company to key
 * on — see "Lead without email or LinkedIn falls back to name+company".
 * Folds accents/diacritics via normalizeNameKey (@/lib/leads/csv) so, e.g.,
 * "José García" and "Jose Garcia" at the same company key identically —
 * the same accent-insensitivity normalizeCompanyKey already applies to the
 * company half of this key.
 */
export function buildNameCompanyKey(
  row: Pick<MatchableRow, "firstName" | "lastName" | "company">,
): string | null {
  const name = normalizeNameKey(`${row.firstName ?? ""} ${row.lastName ?? ""}`);
  const companyKey = row.company ? normalizeCompanyKey(row.company) : "";
  if (!name || !companyKey) return null;
  return `${name}::${companyKey}`;
}

/**
 * Resolves identity for one incoming row, in precedence order (contact-
 * identity spec "Matcher precedence"): own-company skip, then profile key
 * and verified email together (auto only when they agree; a disagreement
 * between the two strong keys is a review case, never an auto-merge — see
 * "Conflicting strong-key matches"), then name+company (review only), then
 * new.
 */
export function matchIdentity(row: MatchableRow, index: IdentityIndex): MatchResult {
  const domain = row.email ? (splitEmail(row.email)?.domain ?? null) : null;
  const ownCompany = ownCompanyMatchReason(row.company, domain);
  if (ownCompany) return { kind: "skip_own_company", reason: ownCompany };

  let profilePersonId: PersonId | null = null;
  if (row.profileKey) {
    const key = normalizeProfileKey(row.profileKey);
    if (key) profilePersonId = index.byProfileKey(key);
  }

  let emailPersonId: PersonId | null = null;
  if (row.email && row.emailStatus === "verified") {
    const emailKey = row.email.trim().toLowerCase();
    emailPersonId = index.byVerifiedEmail(emailKey);
  }

  if (profilePersonId && emailPersonId) {
    if (profilePersonId === emailPersonId) {
      return { kind: "auto", personId: profilePersonId, key: "profile_key" };
    }
    return {
      kind: "review",
      reason: "conflicting_strong_keys",
      candidates: [profilePersonId, emailPersonId],
    };
  }

  if (profilePersonId) return { kind: "auto", personId: profilePersonId, key: "profile_key" };
  if (emailPersonId) return { kind: "auto", personId: emailPersonId, key: "verified_email" };

  const nameCompanyKey = buildNameCompanyKey(row);
  if (nameCompanyKey) {
    const candidates = index.byNameCompany(nameCompanyKey);
    if (candidates.length > 0) {
      return { kind: "review", personIds: candidates, key: "name_company" };
    }
  }

  return { kind: "new" };
}

// --- Property merge (contact-identity R7) ----------------------------------

const EMAIL_STATUS_RANK: Record<EmailStatus, number> = {
  verified: 2,
  probable: 1,
  none: 0,
};

/** Specificity helper for email-like fields — verified beats probable. */
export function emailStatusRank(status: EmailStatus | null | undefined): number {
  return status ? EMAIL_STATUS_RANK[status] : -1;
}

export interface PropertyCandidate {
  value: string | null | undefined;
  updatedAt?: Date | null;
  // Overrides the default "non-null over null, then longer string wins"
  // specificity rule — see emailStatusRank for the email-status case.
  specificity?: number;
}

export interface PropertyMergeResult {
  value: string | null | undefined;
  loser: { value: string | null | undefined } | null;
}

function hasValue(c: PropertyCandidate): boolean {
  return c.value != null && c.value !== "";
}

function defaultSpecificity(c: PropertyCandidate): number {
  return c.value ? c.value.trim().length : 0;
}

/**
 * Merges one property from two rows (contact-identity R7): the more
 * specific value wins (non-null over null, verified over probable, a
 * longer title over a generic one — see `specificity`), and ties go to the
 * most recent value. The losing value is returned so callers can record it
 * on `merge_event.snapshot`.
 */
export function mergeProperty(
  a: PropertyCandidate,
  b: PropertyCandidate,
): PropertyMergeResult {
  const aHas = hasValue(a);
  const bHas = hasValue(b);
  if (aHas && !bHas) return { value: a.value, loser: null };
  if (bHas && !aHas) return { value: b.value, loser: null };
  if (!aHas && !bHas) return { value: a.value, loser: null };

  if (a.value === b.value) return { value: a.value, loser: null };

  const aSpecificity = a.specificity ?? defaultSpecificity(a);
  const bSpecificity = b.specificity ?? defaultSpecificity(b);
  if (aSpecificity !== bSpecificity) {
    return aSpecificity > bSpecificity
      ? { value: a.value, loser: { value: b.value } }
      : { value: b.value, loser: { value: a.value } };
  }

  const aTime = a.updatedAt?.getTime() ?? 0;
  const bTime = b.updatedAt?.getTime() ?? 0;
  return bTime > aTime
    ? { value: b.value, loser: { value: a.value } }
    : { value: a.value, loser: { value: b.value } };
}

export interface PropertyLoss {
  property: string;
  value: string | null | undefined;
}

/**
 * Merges every named property across two rows via mergeProperty, returning
 * the merged values plus the list of losing values (for
 * `merge_event.snapshot`) — omitting properties that didn't genuinely
 * conflict (missing on one side, or identical on both).
 */
export function mergeProperties(
  a: Record<string, PropertyCandidate>,
  b: Record<string, PropertyCandidate>,
): {
  merged: Record<string, string | null | undefined>;
  losers: PropertyLoss[];
} {
  const merged: Record<string, string | null | undefined> = {};
  const losers: PropertyLoss[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const result = mergeProperty(a[key] ?? { value: null }, b[key] ?? { value: null });
    merged[key] = result.value;
    if (result.loser && result.loser.value != null) {
      losers.push({ property: key, value: result.loser.value });
    }
  }
  return { merged, losers };
}
