/**
 * Pure planner behind scripts/backfill-inferred-emails.ts (owner decision
 * 2026-09-30, `openspec/decisions/2026-09-30-decision-brief.md` "3. Email
 * enrichment — stage 1 decided"): infers a missing `person.email` from the
 * dominant email-address convention already observed among a candidate's own
 * company colleagues, for free (no Hunter/DNS call). Refuses rather than
 * guesses whenever the evidence is thin or the name is ambiguous — same
 * contact-identity spirit as nameFromEmailBackfill.ts.
 *
 * No DB access here — see emailPatternInferenceBackfillDb.ts for the thin DB
 * layer that reads candidates/colleague emails and applies the write.
 *
 * Reuses `isFreeMailDomain`/`splitEmail` from `@/lib/emailPatterns` (the
 * ONE free-mail list in the repo — "check whether the repo already has a
 * free-mail list and reuse it" from the owner decision) rather than
 * maintaining a second one. Deliberately does NOT reuse that module's
 * `PATTERN_IDS`/`detectPattern`: the owner decision specifies a DIFFERENT,
 * narrower pattern set and a different qualification rule (>=80% of >=2
 * known emails agree, vs. emailPatterns.ts's per-BD MIN_SUPPORT=2 absolute-
 * count majority) — the exact rule the "699 inferable contacts across 365
 * domains" measurement was run against, so it must be reproduced exactly,
 * not approximated by a different module built for a different job
 * (per-BD colleague suggestions, not a company-wide backfill).
 */
import { isFreeMailDomain, splitEmail } from "@/lib/emailPatterns";

// Owner decision's exact pattern list (note: deliberately different from
// emailPatterns.ts's PATTERN_IDS — includes "last" (surname only), excludes
// "first.l"/"lastfirst"). Ordered most-specific first; this ordering is also
// the tie-break order in detectDominantPattern() and the priority order
// classifyLocalPart() uses to pick ONE pattern for an example whose local
// part happens to match more than one shape (short names can coincide).
export const PATTERN_IDS = [
  "first.last",
  "firstlast",
  "first_last",
  "last.first",
  "f.last",
  "flast",
  "firstl",
  "first",
  "last",
] as const;

export type PatternId = (typeof PATTERN_IDS)[number];

/**
 * Owner decision's exact normalization rule: strip accents (NFD), lowercase,
 * keep only a-z. Deliberately does NOT split on whitespace/hyphen into
 * tokens the way emailPatterns.ts#normalizeNamePart does — stripping
 * non-letters already collapses a compound name like "Ana María" into
 * "anamaria" (spaces are simply removed), which is exactly the "firstlast"-
 * style concatenation real corporate addresses use for compound names.
 */
export function normalizeNamePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * True when `raw` (BEFORE normalization — normalization removes whitespace,
 * so this must run first) has more than one whitespace- or hyphen-separated
 * token, e.g. "de la Fuente", "Da Silva", "Pérez-Gómez". Per the owner ask:
 * never guess a pattern-inferred email for a multi-token surname unless the
 * domain's own known examples show how it's handled — this backfill takes
 * the simpler, explicitly-allowed path ("skipping is fine") and always
 * skips rather than trying to infer that handling.
 */
export function hasMultipleNameTokens(raw: string): boolean {
  return raw.trim().split(/[\s-]+/).filter(Boolean).length > 1;
}

/** Builds the local part (before @) for one pattern given already-normalized
 * first/last name parts. Returns null when a needed part is empty. */
export function buildLocalPart(patternId: PatternId, first: string, last: string): string | null {
  switch (patternId) {
    case "first.last":
      return first && last ? `${first}.${last}` : null;
    case "firstlast":
      return first && last ? `${first}${last}` : null;
    case "first_last":
      return first && last ? `${first}_${last}` : null;
    case "last.first":
      return first && last ? `${last}.${first}` : null;
    case "f.last":
      return first && last ? `${first[0]}.${last}` : null;
    case "flast":
      return first && last ? `${first[0]}${last}` : null;
    case "firstl":
      return first && last ? `${first}${last[0]}` : null;
    case "first":
      return first ? first : null;
    case "last":
      return last ? last : null;
  }
}

/**
 * Which ONE pattern (if any) `localPart` is consistent with, given
 * already-normalized first/last. Iterates PATTERN_IDS in specificity order
 * and returns the FIRST match — a short name can coincidentally satisfy
 * more than one shape (e.g. a single-letter first name makes "flast" and
 * "firstlast" identical), so this makes classification deterministic and
 * avoids double-counting one known example toward two patterns' evidence.
 */
export function classifyLocalPart(localPart: string, first: string, last: string): PatternId | null {
  for (const patternId of PATTERN_IDS) {
    if (buildLocalPart(patternId, first, last) === localPart) return patternId;
  }
  return null;
}

export interface DomainEmailExample {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface DomainPatternResult {
  patternId: PatternId;
  matched: number;
  total: number;
}

// Owner decision's exact qualification rule: >=2 known emails, >=80%
// agreement on one pattern.
export const MIN_KNOWN_EMAILS = 2;
export const DOMINANT_PATTERN_RATIO = 0.8;

/**
 * Detects the dominant local-part pattern among a SINGLE domain's known
 * emails (caller scopes `examples` to one domain — see
 * emailPatternInferenceBackfillDb.ts). "Known email" per the owner decision
 * requires both first AND last name present; an example that normalizes to
 * an empty first or last part (rare — e.g. a name with no a-z letters at
 * all) is excluded from both numerator and denominator, same as it would
 * never have produced a matchable local part anyway.
 */
export function detectDominantPattern(examples: readonly DomainEmailExample[]): DomainPatternResult | null {
  const usable = examples.filter((e) => !!e.firstName?.trim() && !!e.lastName?.trim() && splitEmail(e.email) !== null);

  const counts = new Map<PatternId, number>();
  let total = 0;
  for (const example of usable) {
    const first = normalizeNamePart(example.firstName!);
    const last = normalizeNamePart(example.lastName!);
    if (!first || !last) continue;
    const split = splitEmail(example.email)!;
    total += 1;
    const patternId = classifyLocalPart(split.localPart, first, last);
    if (!patternId) continue;
    counts.set(patternId, (counts.get(patternId) ?? 0) + 1);
  }

  if (total < MIN_KNOWN_EMAILS) return null;

  let winner: PatternId | null = null;
  let winnerCount = 0;
  for (const patternId of PATTERN_IDS) {
    const count = counts.get(patternId) ?? 0;
    if (count > winnerCount) {
      winner = patternId;
      winnerCount = count;
    }
  }
  if (!winner || winnerCount / total < DOMINANT_PATTERN_RATIO) return null;

  return { patternId: winner, matched: winnerCount, total };
}

/** Builds the inferred address for one candidate given a detected pattern. */
export function buildInferredEmail(
  patternId: PatternId,
  firstName: string,
  lastName: string,
  domain: string,
): string | null {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  const localPart = buildLocalPart(patternId, first, last);
  if (!localPart || !domain) return null;
  return `${localPart}@${domain}`;
}

/**
 * Resolves the domain to infer against for one candidate, per the owner
 * decision: `company.domain` first; otherwise the most common non-personal
 * domain among the company's OWN colleagues' emails (never the candidate's
 * own — callers must exclude it, since a candidate by definition has no
 * email yet). Ties broken alphabetically for a deterministic result across
 * runs (same convention as emailPatterns.ts#detectDomain).
 */
export function resolveCandidateDomain(
  companyDomain: string | null,
  colleagueEmails: readonly { email: string }[],
): string | null {
  if (companyDomain?.trim()) return companyDomain.trim().toLowerCase();

  const counts = new Map<string, number>();
  for (const { email } of colleagueEmails) {
    const split = splitEmail(email);
    if (!split || isFreeMailDomain(split.domain)) continue;
    counts.set(split.domain, (counts.get(split.domain) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestDomain = "";
  let bestCount = -1;
  for (const [domain, count] of counts) {
    if (count > bestCount || (count === bestCount && domain < bestDomain)) {
      bestDomain = domain;
      bestCount = count;
    }
  }
  return bestDomain;
}

export type InferenceSkipReason =
  | "missing_name"
  | "multi_token_surname"
  | "normalized_name_empty"
  | "no_domain"
  | "personal_domain"
  | "no_dominant_pattern"
  | "in_run_collision"
  | "db_collision";

export interface InferenceCandidate {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string;
  companyDomain: string | null;
  // Every OTHER non-merged person at the same companyKey who already has an
  // email — feeds both domain resolution (resolveCandidateDomain) and
  // pattern evidence (detectDominantPattern, scoped down to the resolved
  // domain by buildEmailPatternInferencePlan below).
  colleagueEmails: readonly DomainEmailExample[];
}

export interface InferenceFillPlanItem {
  personId: string;
  firstName: string;
  lastName: string;
  companyKey: string;
  domain: string;
  patternId: PatternId;
  matched: number;
  total: number;
  email: string;
  emailNormalized: string;
}

export interface InferenceSkipPlanItem {
  personId: string;
  reason: InferenceSkipReason;
}

export interface InferencePlan {
  fills: InferenceFillPlanItem[];
  skips: InferenceSkipPlanItem[];
}

/**
 * Pure planner: never mutates `candidates` (write-rule R1) — safe to call
 * twice with the same input for the same result (see
 * tests/unit/emailPatternInferenceBackfill.test.ts's "planner is pure"
 * test).
 */
export function buildEmailPatternInferencePlan(candidates: readonly InferenceCandidate[]): InferencePlan {
  const fills: InferenceFillPlanItem[] = [];
  const skips: InferenceSkipPlanItem[] = [];

  for (const candidate of candidates) {
    const firstNameRaw = candidate.firstName?.trim() ?? "";
    const lastNameRaw = candidate.lastName?.trim() ?? "";
    if (!firstNameRaw || !lastNameRaw) {
      skips.push({ personId: candidate.personId, reason: "missing_name" });
      continue;
    }
    if (hasMultipleNameTokens(lastNameRaw)) {
      skips.push({ personId: candidate.personId, reason: "multi_token_surname" });
      continue;
    }

    const domain = resolveCandidateDomain(candidate.companyDomain, candidate.colleagueEmails);
    if (!domain) {
      skips.push({ personId: candidate.personId, reason: "no_domain" });
      continue;
    }
    if (isFreeMailDomain(domain)) {
      skips.push({ personId: candidate.personId, reason: "personal_domain" });
      continue;
    }

    const domainExamples = candidate.colleagueEmails.filter((e) => splitEmail(e.email)?.domain === domain);
    const dominant = detectDominantPattern(domainExamples);
    if (!dominant) {
      skips.push({ personId: candidate.personId, reason: "no_dominant_pattern" });
      continue;
    }

    const email = buildInferredEmail(dominant.patternId, firstNameRaw, lastNameRaw, domain);
    if (!email) {
      skips.push({ personId: candidate.personId, reason: "normalized_name_empty" });
      continue;
    }

    fills.push({
      personId: candidate.personId,
      firstName: firstNameRaw,
      lastName: lastNameRaw,
      companyKey: candidate.companyKey,
      domain,
      patternId: dominant.patternId,
      matched: dominant.matched,
      total: dominant.total,
      email,
      emailNormalized: email.toLowerCase(),
    });
  }

  return dedupeInRunCollisions(fills, skips);
}

/**
 * Two different candidates whose inferred email collides with EACH OTHER
 * (identical normalized address, same pattern + same name at the same
 * domain) is exactly the same "may be a duplicate person" signal as
 * colliding with an already-existing person — see filterExistingCollisions
 * below for the DB-side half. Both are skipped and counted, never applied,
 * and never arbitrarily pick a "winner" between two equally-plausible
 * candidates.
 */
function dedupeInRunCollisions(
  fills: readonly InferenceFillPlanItem[],
  existingSkips: readonly InferenceSkipPlanItem[],
): InferencePlan {
  const byEmail = new Map<string, InferenceFillPlanItem[]>();
  for (const fill of fills) {
    const list = byEmail.get(fill.emailNormalized) ?? [];
    list.push(fill);
    byEmail.set(fill.emailNormalized, list);
  }

  const keptFills: InferenceFillPlanItem[] = [];
  const skips = [...existingSkips];
  for (const list of byEmail.values()) {
    if (list.length > 1) {
      for (const fill of list) skips.push({ personId: fill.personId, reason: "in_run_collision" });
    } else {
      keptFills.push(list[0]);
    }
  }
  return { fills: keptFills, skips };
}

/**
 * Second collision pass (DB-side): drops any fill whose inferred normalized
 * email already belongs to an EXISTING non-merged person — never applied,
 * always counted ("may be a duplicate person" — an owner ask to surface,
 * not silently overwrite or merge). `existingNormalizedEmails` is the
 * caller's DB read (emailPatternInferenceBackfillDb.ts#readExistingEmailNormalized),
 * scoped to exactly this run's candidate emails, never the whole table.
 * Pure — never mutates `plan`.
 */
export function filterExistingCollisions(
  plan: InferencePlan,
  existingNormalizedEmails: ReadonlySet<string>,
): InferencePlan {
  const fills: InferenceFillPlanItem[] = [];
  const skips = [...plan.skips];
  for (const fill of plan.fills) {
    if (existingNormalizedEmails.has(fill.emailNormalized)) {
      skips.push({ personId: fill.personId, reason: "db_collision" });
    } else {
      fills.push(fill);
    }
  }
  return { fills, skips };
}
