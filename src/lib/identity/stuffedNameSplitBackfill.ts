/**
 * Pure planner behind scripts/backfill-split-stuffed-names.ts: splits a full
 * name that was stuffed into `person.first_name` (with `last_name` left
 * empty) into `firstName`/`lastName`. Refuses rather than guesses — a wrong
 * split is worse than leaving the row alone.
 *
 * No DB access here — see stuffedNameSplitBackfillDb.ts for the thin DB
 * layer that reads candidates and applies the write.
 *
 * NOT built on src/lib/contacts/partnerAccountContacts.ts#splitDisplayName:
 * that function is a "last whitespace-separated token is the last name"
 * rule, correct only for the 16 hand-curated, individually-verified rows it
 * exists for (and known-wrong there for surname particles — its own file
 * requires a human `nameSplit` override for "Claudio De Vita", since the
 * generic rule would produce firstName "Claudio De" / lastName "Vita"). That
 * rule is too naive to run unattended over ~227 production rows containing
 * particles, compound Hispanic surnames, and junk. This module is a
 * separate, more conservative rule: it special-cases surname particles, uses
 * the verified email as a tie-breaker for 3/4-token ambiguity, and refuses
 * (skips) anything it can't resolve with confidence, rather than trusting a
 * single "last token wins" heuristic.
 *
 * Collision measurement: this backfill deliberately does NOT queue any
 * `duplicate_candidate` rows. `buildNameCompanyKey` (src/lib/identity/
 * matcher.ts) keys on `normalizeNameKey(`${firstName} ${lastName}`)`, which
 * collapses whitespace before comparing. Splitting "Colette Harington" /
 * "" into "Colette" / "Harington" re-concatenates to the exact same
 * normalized string ("colette harington") — the key is a re-partition of
 * the same token sequence, never a change to it. So this operation can
 * never introduce a NEW name+company collision that didn't already exist
 * before the split (see the "key invariance" test in
 * tests/unit/stuffedNameSplitBackfill.test.ts, which proves this for a real
 * example rather than asserting it in prose).
 */
import { normalizeCompanyKey } from "@/lib/companyCategories";

export type StuffedNameSplitRule = "particle" | "two_tokens" | "email_resolved" | "heuristic_4";

export type StuffedNameSplitSkipReason =
  // Collapses to 0 or 1 tokens once whitespace is normalized (rare — the
  // read candidate is pre-filtered to contain whitespace, but non-space
  // Unicode whitespace can still collapse to nothing after trim).
  | "single_token"
  // A digit anywhere — never a person's name.
  | "junk_digit"
  // An '@' anywhere — an email address ended up in the name field.
  | "junk_at"
  // A character outside letters/apostrophe/hyphen/single-letter-initial-
  // period — catches URLs, bare domains, and other free text.
  | "junk_punctuation"
  // A known scraper UI boilerplate phrase (e.g. LinkedIn's "Ver el perfil
  // de <name>") got concatenated onto the real name with no separating
  // space — never a real surname particle, even though it may contain
  // "de"/"la".
  | "junk_scrape_artifact"
  // Matches a known company-name suffix word, or matches this person's own
  // `company`/`companyKey` — a company name, not a person.
  | "looks_like_company"
  // Exactly 3 tokens, no surname particle, and the email (if any) didn't
  // resolve the given-name/surname boundary.
  | "ambiguous_3"
  // 5+ tokens, no surname particle, and the email (if any) didn't resolve
  // the boundary — no heuristic is defined past 4 tokens.
  | "ambiguous_many";

export interface StuffedNameSplitFill {
  firstName: string;
  lastName: string;
  rule: StuffedNameSplitRule;
}

export type StuffedNameSplitResult =
  | { kind: "fill"; fill: StuffedNameSplitFill }
  | { kind: "skip"; reason: StuffedNameSplitSkipReason };

/** Short, explicit list (task ask) — never a broad heuristic. Compared
 * against each whitespace-separated token (trailing period stripped) and
 * case-insensitively. */
export const COMPANY_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "inc",
  "llc",
  "sa",
  "srl",
  "solutions",
  "group",
  "agency",
  "studio",
  "consulting",
]);

// Two-word particles are matched before single-word ones at the same
// position (longest match first). "mc"/"mac" are deliberately absent — the
// task calls them out as NOT particles.
const TWO_WORD_PARTICLES: ReadonlySet<string> = new Set(["de la", "de los", "de las", "van der"]);
const ONE_WORD_PARTICLES: ReadonlySet<string> = new Set([
  "de",
  "del",
  "da",
  "das",
  "do",
  "dos",
  "van",
  "von",
  "di",
  "le",
  "la",
  "du",
]);

const SINGLE_LETTER_INITIAL_RE = /^\p{L}\.$/u;
const LETTER_APOSTROPHE_HYPHEN_RE = /^[\p{L}'-]+$/u;

/** Short, explicit list of scraper UI boilerplate that has leaked into
 * `first_name` (production evidence: 5 `hubspot_import` rows, all shaped
 * "<Name>Ver el perfil de <Name>" — the name duplicated with no separating
 * space before the phrase). Checked case-insensitively as a substring. */
const SCRAPE_ARTIFACT_PHRASES: readonly string[] = ["ver el perfil de", "view full profile", "view profile"];

function containsScrapeArtifactPhrase(collapsed: string): boolean {
  const lower = collapsed.toLowerCase();
  return SCRAPE_ARTIFACT_PHRASES.some((phrase) => lower.includes(phrase));
}

function collapseWhitespaceNfc(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

function isValidNameCharset(tokens: readonly string[]): boolean {
  return tokens.every((token) =>
    token.includes(".") ? SINGLE_LETTER_INITIAL_RE.test(token) : LETTER_APOSTROPHE_HYPHEN_RE.test(token),
  );
}

function looksLikeCompany(
  collapsed: string,
  tokens: readonly string[],
  company: string | null,
  companyKey: string | null,
): boolean {
  if (tokens.some((t) => COMPANY_SUFFIX_WORDS.has(t.replace(/\.$/, "").toLowerCase()))) return true;
  const asKey = normalizeCompanyKey(collapsed);
  if (companyKey && asKey === companyKey) return true;
  if (company && asKey === normalizeCompanyKey(company)) return true;
  return false;
}

/** Leftmost surname-particle boundary, or null when none applies. The
 * particle must leave at least one token before it (the given name) and at
 * least one token after it (the actual surname word) — "Pedro De" (2
 * tokens) is never split as a particle, it falls through to `two_tokens`. */
function findParticleBoundary(tokens: readonly string[]): { start: number; length: number } | null {
  for (let i = 1; i < tokens.length; i++) {
    if (i + 1 < tokens.length) {
      const twoWord = `${tokens[i]!.toLowerCase()} ${tokens[i + 1]!.toLowerCase()}`;
      if (TWO_WORD_PARTICLES.has(twoWord) && i + 2 <= tokens.length - 1) {
        return { start: i, length: 2 };
      }
    }
    if (ONE_WORD_PARTICLES.has(tokens[i]!.toLowerCase()) && i + 1 <= tokens.length - 1) {
      return { start: i, length: 1 };
    }
  }
  return null;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Local part before '@', with any '+tag' stripped. Null when malformed. */
function emailLocalTokens(email: string): string[] | null {
  const at = email.indexOf("@");
  if (at <= 0) return null;
  let local = email.slice(0, at);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  const tokens = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  return tokens.length >= 2 ? tokens : null;
}

/**
 * Uses the verified email's local-part tokens to find where the given name
 * ends and the surname starts, when — and only when — every email token
 * matches a later name token in sequence (exact match, or a single-letter
 * email token matching a name token's first letter — e.g. "a" for
 * "Antonio"). Returns the boundary index (start of the surname) or null
 * when the email doesn't resolve it. Never partial-credits a non-matching
 * email token — one miss fails the whole tie-break.
 */
function resolveViaEmail(tokens: readonly string[], email: string | null): number | null {
  if (!email) return null;
  const emailTokens = emailLocalTokens(email);
  if (!emailTokens) return null;

  const normalizedNameTokens = tokens.map((t) => stripDiacritics(t).toLowerCase());
  let searchFrom = 0;
  let lastMatched = -1;
  for (const emailToken of emailTokens) {
    let found = -1;
    for (let i = searchFrom; i < normalizedNameTokens.length; i++) {
      const nameToken = normalizedNameTokens[i]!;
      if (nameToken === emailToken || (emailToken.length === 1 && nameToken[0] === emailToken)) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    lastMatched = found;
    searchFrom = found + 1;
  }
  if (lastMatched <= 0 || lastMatched >= tokens.length) return null;
  return lastMatched;
}

function isAllLower(token: string): boolean {
  const letters = token.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters === letters.toLowerCase() && letters !== letters.toUpperCase();
}

function isAllUpper(token: string): boolean {
  const letters = token.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

function titleCaseToken(token: string): string {
  return token
    .split("-")
    .map((seg) => (seg.length === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()))
    .join("-");
}

export interface StuffedNameSplitInput {
  firstName: string;
  email: string | null;
  company: string | null;
  companyKey: string | null;
}

/**
 * Derives a first/last split from ONE stuffed `first_name` value. Pure,
 * refuses rather than guesses. See the module doc comment above for why
 * this is a separate rule from `splitDisplayName` and why no
 * `duplicate_candidate` queueing is needed.
 */
export function deriveStuffedNameSplit(input: StuffedNameSplitInput): StuffedNameSplitResult {
  const collapsed = collapseWhitespaceNfc(input.firstName);
  if (/\d/.test(collapsed)) return { kind: "skip", reason: "junk_digit" };
  if (collapsed.includes("@")) return { kind: "skip", reason: "junk_at" };
  if (containsScrapeArtifactPhrase(collapsed)) return { kind: "skip", reason: "junk_scrape_artifact" };

  const tokens = collapsed.split(" ").filter(Boolean);
  if (looksLikeCompany(collapsed, tokens, input.company, input.companyKey)) {
    return { kind: "skip", reason: "looks_like_company" };
  }
  if (!isValidNameCharset(tokens)) return { kind: "skip", reason: "junk_punctuation" };
  if (tokens.length <= 1) return { kind: "skip", reason: "single_token" };

  const particle = findParticleBoundary(tokens);
  const particleIndices = new Set<number>();
  let boundary: number;
  let rule: StuffedNameSplitRule;

  if (particle) {
    boundary = particle.start;
    rule = "particle";
    for (let k = particle.start; k < particle.start + particle.length; k++) particleIndices.add(k);
  } else if (tokens.length === 2) {
    boundary = 1;
    rule = "two_tokens";
  } else {
    const emailBoundary = resolveViaEmail(tokens, input.email);
    if (emailBoundary !== null) {
      boundary = emailBoundary;
      rule = "email_resolved";
    } else if (tokens.length === 3) {
      return { kind: "skip", reason: "ambiguous_3" };
    } else if (tokens.length === 4) {
      boundary = 2;
      rule = "heuristic_4";
    } else {
      return { kind: "skip", reason: "ambiguous_many" };
    }
  }

  const casedTokens = tokens.map((token, idx) =>
    particleIndices.has(idx) ? token : isAllLower(token) || isAllUpper(token) ? titleCaseToken(token) : token,
  );
  const firstName = casedTokens.slice(0, boundary).join(" ");
  const lastName = casedTokens.slice(boundary).join(" ");
  return { kind: "fill", fill: { firstName, lastName, rule } };
}

export interface StuffedNameSplitCandidate {
  personId: string;
  /** Raw value as read from `person.first_name` — the write-time re-check
   * compares against this exact string, and the audit/revert path needs it
   * to restore the pre-backfill value. */
  firstName: string;
  /** Raw value as read from `person.last_name` (null or blank) — needed so
   * revert restores the exact pre-backfill shape, not just NULL/NULL. */
  originalLastName: string | null;
  email: string | null;
  company: string | null;
  companyKey: string | null;
}

export interface StuffedNameSplitFillPlanItem {
  personId: string;
  originalFirstName: string;
  originalLastName: string | null;
  firstName: string;
  lastName: string;
  rule: StuffedNameSplitRule;
}

export interface StuffedNameSplitSkipPlanItem {
  personId: string;
  originalFirstName: string;
  reason: StuffedNameSplitSkipReason;
}

export interface StuffedNameSplitPlan {
  fills: StuffedNameSplitFillPlanItem[];
  skips: StuffedNameSplitSkipPlanItem[];
}

/**
 * Pure planner: never mutates `candidates` — safe to call twice with the
 * same input for the same result (see
 * tests/unit/stuffedNameSplitBackfill.test.ts).
 */
export function buildStuffedNameSplitPlan(candidates: readonly StuffedNameSplitCandidate[]): StuffedNameSplitPlan {
  const fills: StuffedNameSplitFillPlanItem[] = [];
  const skips: StuffedNameSplitSkipPlanItem[] = [];

  for (const candidate of candidates) {
    const result = deriveStuffedNameSplit(candidate);
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
      skips.push({ personId: candidate.personId, originalFirstName: candidate.firstName, reason: result.reason });
    }
  }

  return { fills, skips };
}
