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
 *      would be no last name left), so it falls through to rule 1 — and rule
 *      1 itself refuses a bare-initial 2nd token too (review fix, see
 *      `bare_initial_last_name` below): a single letter is never a real
 *      surname.
 *   3. Anything after a comma is a credential or title and is DROPPED
 *      ("Kimberly West-Philips, SHRM-CP" -> "Kimberly" / "West-Philips").
 *   4. Trim whitespace; a value that becomes a single token after trimming
 *      (or that collapses to zero tokens once the comma-dropped part is
 *      removed) is NOT split.
 *
 * SAFETY GATE (review fix, CRITICAL): this rule is intentionally blunter than
 * stuffedNameSplitBackfill.ts#deriveStuffedNameSplit (no surname-particle
 * handling, no email tie-breaker, no company detection of its own), so it
 * must NEVER run directly against a raw candidate — `classifyForFirstTokenSplit`
 * re-classifies every candidate with the EXISTING, more conservative
 * classifier FIRST, and only a candidate the original rule itself calls
 * "ambiguous_3" / "ambiguous_many" (a Latin-alphabet, no-digit/no-@,
 * non-particle, non-company set of 3 or 5+ tokens it deliberately refused to
 * guess at) is eligible to be split here. Everything else — company names
 * (`looks_like_company`), junk (`junk_digit`/`junk_at`/`junk_punctuation`/
 * `junk_scrape_artifact`), particle-first data, owner exclusions, AND rows
 * the original rule could already resolve with confidence
 * (`resolvable_by_original_rule`) — is routed to needs review, UNSPLIT. See
 * `buildFirstTokenSplitPlan` and tests/unit/stuffedNameFirstTokenSplit.test.ts.
 *
 * KNOWN TRADEOFF: because the existing classifier tokenizes on whitespace
 * only (it does not know about credential commas), ANY comma anywhere in the
 * raw value makes some token contain a literal "," character, which always
 * fails its charset check (`junk_punctuation`) — so rule 3 above (comma-drop)
 * can never fire through this gate today; it stays fully tested as a
 * standalone rule (`deriveFirstTokenSplit`) for completeness and for the day
 * the gate is revisited, but a live comma-suffixed row will show up in needs
 * review as `junk_punctuation`, not get auto-split. Flagged here on purpose —
 * this is a deliberate conservative regression versus the original ask, not
 * an oversight.
 *
 * No `duplicate_candidate` queueing here either, for the same reason as
 * stuffedNameSplitBackfill.ts: `buildNameCompanyKey` (src/lib/identity/
 * matcher.ts) keys on the whitespace-collapsed concatenation of
 * firstName+lastName, so re-partitioning the same token sequence into
 * first/last can never change that key (dropping a comma-suffix credential
 * DOES change the underlying tokens, but only by removing junk that was never
 * part of the name — it can only ever match an EXISTING key more closely,
 * never introduce a new collision).
 *
 * COMPOUND GIVEN NAMES (owner ask, 2026-09-30): when the SECOND token is a
 * common Spanish/Portuguese given name (see commonGivenNames.ts), it belongs
 * to the first name too ("Maria Sol Gonzalez" -> "Maria Sol" / "Gonzalez"),
 * same "only when a token remains for the last name" guard as the
 * middle-initial rule.
 *
 * LINKEDIN SCRAPE-ARTIFACT CLEANUP (owner ask, 2026-09-30): a raw value
 * shaped exactly "<Name>Ver el perfil de <Name>" (prefix identical to the
 * repeated suffix name) is a CONFIRMED LinkedIn scrape artifact, never a
 * company — `stripLinkedInScrapeArtifact` extracts the clean name, and
 * `buildFirstTokenSplitPlan` splits it directly, BYPASSING the safety gate
 * entirely (see there for why: the gate's particle rule can actually produce
 * a WORSE split than this module's own plain rule for these rows).
 *
 * MANUAL OVERRIDES (owner ask, 2026-09-30): a short, explicit, person-id-
 * keyed list of hand-verified corrections — see
 * stuffedNameFirstTokenSplitOverrides.ts — takes priority over both the
 * LinkedIn cleanup and the gate.
 */
import { isCommonGivenName } from "./commonGivenNames";
import { deriveStuffedNameSplit, type StuffedNameSplitCandidate } from "./stuffedNameSplitBackfill";
import {
  findFirstTokenSplitManualOverride,
  resolveManualOverrideFill,
} from "./stuffedNameFirstTokenSplitOverrides";

export type FirstTokenSplitRule = "plain" | "middle_initial" | "compound_given_name" | "manual_override";

/** `resolvable_by_original_rule` is not one of the original module's own skip
 * reasons — it is THIS module's label for "the original, more conservative
 * classifier already resolves this with a FILL, so the blunter first-token
 * rule must never touch it (it would already have been backfilled by
 * scripts/backfill-split-stuffed-names.ts if it were still a live
 * candidate)." */
export type FirstTokenSplitSkipReason =
  | "single_token"
  | "bare_initial_last_name"
  | "resolvable_by_original_rule"
  | "owner_excluded"
  | "junk_digit"
  | "junk_at"
  | "junk_scrape_artifact"
  | "particle_first"
  | "junk_punctuation"
  | "looks_like_company";

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

const NO_SKIP_DETAIL: FirstTokenSplitSkipDetail = { isDigitsOnly: false, isCommonNonPersonWord: false };

const MIDDLE_INITIAL_RE = /^\p{L}\.?$/u;

function collapseWhitespaceNfc(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Shared by both the gate's own "single_token" reason (raw firstName, no
 * comma-drop — that's how the original classifier reaches this reason) and
 * this module's own post-comma-drop "single_token" reason: same detail
 * shape either way, computed from whatever single token remains. */
function singleTokenDetail(collapsedSingleToken: string): FirstTokenSplitSkipDetail {
  return {
    isDigitsOnly: /^\d+$/.test(collapsedSingleToken),
    isCommonNonPersonWord: NON_PERSON_SINGLE_TOKENS.has(collapsedSingleToken.toLowerCase()),
  };
}

/**
 * Derives a first/last split from ONE stuffed `first_name` value using the
 * "first token is the given name" rule. Pure. Does NOT gate on the original
 * classifier — see `classifyForFirstTokenSplit` for that; callers reading
 * live candidates must gate first (`buildFirstTokenSplitPlan` already does).
 */
export function deriveFirstTokenSplit(input: { firstName: string }): FirstTokenSplitResult {
  const commaIndex = input.firstName.indexOf(",");
  const namePart = commaIndex >= 0 ? input.firstName.slice(0, commaIndex) : input.firstName;
  const collapsed = collapseWhitespaceNfc(namePart);
  const tokens = collapsed.split(" ").filter(Boolean);

  if (tokens.length <= 1) {
    return { kind: "skip", reason: "single_token", detail: singleTokenDetail(tokens[0] ?? "") };
  }

  // Review fix: a 2-token value whose 2nd token is only a bare initial is
  // never a real surname — e.g. "Ana J", "Juan D." — route to needs review
  // instead of fabricating a one-letter last name.
  if (tokens.length === 2 && MIDDLE_INITIAL_RE.test(tokens[1]!)) {
    return { kind: "skip", reason: "bare_initial_last_name", detail: NO_SKIP_DETAIL };
  }

  let boundary = 1;
  let rule: FirstTokenSplitRule = "plain";
  if (tokens.length >= 3 && MIDDLE_INITIAL_RE.test(tokens[1]!)) {
    boundary = 2;
    rule = "middle_initial";
  } else if (tokens.length >= 3 && isCommonGivenName(tokens[1]!)) {
    boundary = 2;
    rule = "compound_given_name";
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

const LINKEDIN_ARTIFACT_PHRASE_RE = /ver el perfil de/i;

/**
 * Detects the "<Name>Ver el perfil de <Name>" LinkedIn scrape artifact
 * (owner ask, 2026-09-30): the phrase glued directly onto the real name with
 * NO separating space, then the SAME name repeated after it (production
 * evidence — see stuffedNameSplitBackfill.ts's SCRAPE_ARTIFACT_PHRASES doc
 * comment for the general phrase-detection precedent). Returns the cleaned
 * name (the prefix) ONLY when the prefix, once whitespace-collapsed, equals
 * the collapsed suffix EXACTLY — refuses (returns null) rather than guess
 * when they don't match, or when the phrase isn't present at all.
 */
export function stripLinkedInScrapeArtifact(raw: string): string | null {
  const match = LINKEDIN_ARTIFACT_PHRASE_RE.exec(raw);
  if (!match) return null;
  const prefix = collapseWhitespaceNfc(raw.slice(0, match.index));
  const suffix = collapseWhitespaceNfc(raw.slice(match.index + match[0].length));
  if (!prefix || prefix !== suffix) return null;
  return prefix;
}

export type FirstTokenSplitGateResult =
  | { kind: "eligible" }
  | { kind: "ineligible"; reason: FirstTokenSplitSkipReason };

/**
 * SAFETY GATE (review fix): re-classifies `candidate` with the EXISTING,
 * more conservative classifier (deriveStuffedNameSplit — its skip-reason
 * detection, COMPANY_SUFFIX_WORDS/companyKey match, digit/@/punctuation
 * checks, and particle-first check) BEFORE this module's blunter first-token
 * rule is allowed to touch it. Only "ambiguous_3" / "ambiguous_many" (the
 * original rule's OWN "structurally a name, but genuinely ambiguous" verdict)
 * are eligible. Everything else — every other skip reason, AND any candidate
 * the original rule can already resolve as a FILL — is ineligible. Pure.
 */
export function classifyForFirstTokenSplit(candidate: StuffedNameSplitCandidate): FirstTokenSplitGateResult {
  const original = deriveStuffedNameSplit(candidate);
  if (original.kind === "fill") {
    return { kind: "ineligible", reason: "resolvable_by_original_rule" };
  }
  if (original.reason === "ambiguous_3" || original.reason === "ambiguous_many") {
    return { kind: "eligible" };
  }
  return { kind: "ineligible", reason: original.reason };
}

export interface FirstTokenSplitFillPlanItem {
  personId: string;
  originalFirstName: string;
  originalLastName: string | null;
  /** Nullable — a manual override can explicitly NULL a field (e.g. the
   * "Contacto de 2º grado2º V" -> first_name NULL / last_name "Ciotta"
   * override); every non-override rule always produces non-null strings. */
  firstName: string | null;
  lastName: string | null;
  rule: FirstTokenSplitRule;
  /** Only set by the "create a company and link it" manual override (owner
   * ask, 2026-09-30, person add5bf2d-...): a brand-new `company` row to
   * create (if it doesn't already exist by key) and link via
   * company/companyKey, in the SAME transaction as this name fill. */
  createCompany?: { displayName: string };
}

export interface FirstTokenSplitSkipPlanItem {
  personId: string;
  originalFirstName: string;
  reason: FirstTokenSplitSkipReason;
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
 * tests/unit/stuffedNameFirstTokenSplit.test.ts). Gates every candidate
 * through `classifyForFirstTokenSplit` before ever calling
 * `deriveFirstTokenSplit`.
 */
export function buildFirstTokenSplitPlan(candidates: readonly StuffedNameSplitCandidate[]): FirstTokenSplitPlan {
  const fills: FirstTokenSplitFillPlanItem[] = [];
  const skips: FirstTokenSplitSkipPlanItem[] = [];

  for (const candidate of candidates) {
    // Manual overrides (owner ask, 2026-09-30) take priority over everything
    // else — a hand-verified, person-id-keyed correction is never
    // second-guessed by either the LinkedIn cleanup or the safety gate.
    const override = findFirstTokenSplitManualOverride(candidate.personId);
    if (override) {
      fills.push(resolveManualOverrideFill(candidate, override));
      continue;
    }

    // LinkedIn scrape-artifact cleanup (owner ask, 2026-09-30) bypasses the
    // gate entirely — detecting the repeated-name shape is itself enough
    // confidence this is a real person, and the gate's particle rule can
    // actually produce a WORSE split than this module's own rule here (see
    // module doc comment).
    const linkedInCleaned = stripLinkedInScrapeArtifact(candidate.firstName);
    if (linkedInCleaned !== null) {
      const result = deriveFirstTokenSplit({ firstName: linkedInCleaned });
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
          reason: result.reason,
          isDigitsOnly: result.detail.isDigitsOnly,
          isCommonNonPersonWord: result.detail.isCommonNonPersonWord,
        });
      }
      continue;
    }

    const gate = classifyForFirstTokenSplit(candidate);
    if (gate.kind === "ineligible") {
      // The gate's OWN "single_token" reason comes from the ORIGINAL
      // classifier tokenizing the raw firstName (no comma-drop) — compute
      // the same isDigitsOnly/isCommonNonPersonWord flags from that same
      // raw value so needs-review reporting is consistent either way.
      const detail =
        gate.reason === "single_token"
          ? singleTokenDetail(collapseWhitespaceNfc(candidate.firstName))
          : NO_SKIP_DETAIL;
      skips.push({
        personId: candidate.personId,
        originalFirstName: candidate.firstName,
        reason: gate.reason,
        isDigitsOnly: detail.isDigitsOnly,
        isCommonNonPersonWord: detail.isCommonNonPersonWord,
      });
      continue;
    }

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
        reason: result.reason,
        isDigitsOnly: result.detail.isDigitsOnly,
        isCommonNonPersonWord: result.detail.isCommonNonPersonWord,
      });
    }
  }

  return { fills, skips };
}
