/**
 * Pure planner behind scripts/backfill-split-remaining-stuffed-names.ts:
 * splits the REMAINING stuffed `person.first_name` values (still whitespace-
 * containing, `last_name` still empty, after PR #186's
 * stuffedNameSplitBackfill.ts already handled the unambiguous majority) using
 * the owner-approved rule from 2026-09-30:
 *
 *   1. The first word is the first name; everything after it is the last
 *      name ("Julián" / "Zamudio Lemos").
 *   2. A middle initial (a single letter optionally followed by ".") right
 *      after the first word stays with the first name ("Augusto D." /
 *      "Schultheis") — but only when a token still remains afterward to
 *      serve as the last name; a bare 2-token "Ana J" is NOT widened (there
 *      would be no last name left), so it falls through to rule 1.
 *   3. Anything after a comma is a credential or title and is DROPPED
 *      ("Kimberly West-Philips, SHRM-CP" -> "Kimberly" / "West-Philips").
 *   4. Trim whitespace; a value that becomes a single token after trimming
 *      (or that collapses to zero tokens once the comma-dropped part is
 *      removed) is NOT split.
 *
 * Deliberately simpler than stuffedNameSplitBackfill.ts#deriveStuffedNameSplit
 * (no surname-particle handling, no email tie-breaker, no re-casing) — that
 * module's conservative rule already handled every case it could resolve
 * with confidence; this owner-approved rule exists specifically to clear the
 * ambiguous remainder it deliberately refused. The two rules are kept as
 * SEPARATE modules/scripts/audit actions on purpose, so each has its own
 * revertible audit trail.
 *
 * No `duplicate_candidate` queueing here either, for the same reason as
 * stuffedNameSplitBackfill.ts: `buildNameCompanyKey` (src/lib/identity/
 * matcher.ts) keys on the whitespace-collapsed concatenation of
 * firstName+lastName, so re-partitioning the same token sequence into
 * first/last can never change that key (dropping a comma-suffix credential
 * DOES change the underlying tokens, but only by removing junk that was never
 * part of the name — it can only ever match an EXISTING key more closely,
 * never introduce a new collision).
 */

export type FirstTokenSplitRule = "plain" | "middle_initial";

export type FirstTokenSplitSkipReason = "single_token";

export interface FirstTokenSplitFill {
  firstName: string;
  lastName: string;
  rule: FirstTokenSplitRule;
}

export interface FirstTokenSplitSkipDetail {
  isDigitsOnly: boolean;
  isCommonNonPersonWord: boolean;
}

export type FirstTokenSplitResult =
  | { kind: "fill"; fill: FirstTokenSplitFill }
  | { kind: "skip"; reason: FirstTokenSplitSkipReason; detail: FirstTokenSplitSkipDetail };

/**
 * Short, explicit, owner-reviewed list of single tokens that are obviously
 * NOT a person's name (owner ask, 2026-09-30 — sample given was "Pagos").
 * Matched case-insensitively against the WHOLE trimmed token. Extend only
 * after another owner review of the actual row — never by guessing at a
 * broader dictionary, same convention as
 * stuffedNameSplitBackfill.ts#COMPANY_SUFFIX_WORDS.
 */
export const NON_PERSON_SINGLE_TOKENS: ReadonlySet<string> = new Set(["pagos"]);

const MIDDLE_INITIAL_RE = /^\p{L}\.?$/u;

function collapseWhitespaceNfc(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Derives a first/last split from ONE stuffed `first_name` value using the
 * "first token is the given name" rule. Pure.
 */
export function deriveFirstTokenSplit(input: { firstName: string }): FirstTokenSplitResult {
  const commaIndex = input.firstName.indexOf(",");
  const namePart = commaIndex >= 0 ? input.firstName.slice(0, commaIndex) : input.firstName;
  const collapsed = collapseWhitespaceNfc(namePart);
  const tokens = collapsed.split(" ").filter(Boolean);

  if (tokens.length <= 1) {
    const token = tokens[0] ?? "";
    return {
      kind: "skip",
      reason: "single_token",
      detail: {
        isDigitsOnly: /^\d+$/.test(token),
        isCommonNonPersonWord: NON_PERSON_SINGLE_TOKENS.has(token.toLowerCase()),
      },
    };
  }

  let boundary = 1;
  let rule: FirstTokenSplitRule = "plain";
  if (tokens.length >= 3 && MIDDLE_INITIAL_RE.test(tokens[1]!)) {
    boundary = 2;
    rule = "middle_initial";
  }

  return {
    kind: "fill",
    fill: {
      firstName: tokens.slice(0, boundary).join(" "),
      lastName: tokens.slice(boundary).join(" "),
      rule,
    },
  };
}

export interface FirstTokenSplitCandidate {
  personId: string;
  /** Raw value as read from `person.first_name` — the write-time re-check
   * compares against this exact string, and the audit/revert path needs it
   * to restore the pre-backfill value. */
  firstName: string;
  /** Raw value as read from `person.last_name` (null or blank) — needed so
   * revert restores the exact pre-backfill shape, not just NULL/NULL. */
  originalLastName: string | null;
}

export interface FirstTokenSplitFillPlanItem {
  personId: string;
  originalFirstName: string;
  originalLastName: string | null;
  firstName: string;
  lastName: string;
  rule: FirstTokenSplitRule;
}

export interface FirstTokenSplitSkipPlanItem {
  personId: string;
  originalFirstName: string;
  isDigitsOnly: boolean;
  isCommonNonPersonWord: boolean;
}

export interface FirstTokenSplitPlan {
  fills: FirstTokenSplitFillPlanItem[];
  skips: FirstTokenSplitSkipPlanItem[];
}

/**
 * Pure planner: never mutates `candidates` — safe to call twice with the
 * same input for the same result (see
 * tests/unit/stuffedNameFirstTokenSplit.test.ts).
 */
export function buildFirstTokenSplitPlan(candidates: readonly FirstTokenSplitCandidate[]): FirstTokenSplitPlan {
  const fills: FirstTokenSplitFillPlanItem[] = [];
  const skips: FirstTokenSplitSkipPlanItem[] = [];

  for (const candidate of candidates) {
    const result = deriveFirstTokenSplit(candidate);
    if (result.kind === "fill") {
      fills.push({
        personId: candidate.personId,
        originalFirstName: candidate.firstName,
        originalLastName: candidate.originalLastName,
        firstName: result.fill.firstName,
        lastName: result.fill.lastName,
        rule: result.fill.rule,
      });
    } else {
      skips.push({
        personId: candidate.personId,
        originalFirstName: candidate.firstName,
        isDigitsOnly: result.detail.isDigitsOnly,
        isCommonNonPersonWord: result.detail.isCommonNonPersonWord,
      });
    }
  }

  return { fills, skips };
}
