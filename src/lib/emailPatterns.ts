/**
 * Corporate email convention detection, inferred purely from a company's own
 * contacts (first name, last name, email). No DB access here — see
 * src/lib/emailSuggestion.ts for the query layer that gathers samples and
 * calls into this module.
 */

// Closed list of local-part patterns this module knows how to detect/build.
// Ordered by SPECIFICITY, most specific first — this ordering is also the
// tie-break order used by detectPattern() below:
//   1) first.last, firstlast, first_last, last.first
//      — use the FULL first+last name deterministically, so they carry the
//        most information and are the least likely to collide by accident.
//   2) f.last, flast, first.l, lastfirst, firstl
//      — use only an initial for one side, so two different people are more
//        likely to collide on the same local part (less specific).
//   3) first
//      — uses only the first name; the least specific (whole company could
//        share it for common first names), so it's the last resort.
export const PATTERN_IDS = [
  "first.last",
  "firstlast",
  "first_last",
  "last.first",
  "f.last",
  "flast",
  "first.l",
  "lastfirst",
  "firstl",
  "first",
] as const;

export type PatternId = (typeof PATTERN_IDS)[number];

// Free-mail providers whose domain reveals nothing about a COMPANY's email
// convention (everyone gets @gmail.com regardless of employer). If a
// company's samples are all free-mail, there is no company convention to
// detect, so these are excluded before pattern matching runs at all.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "zoho.com",
]);

// A single winning pattern needs at least this many agreeing samples. One
// match could just be a coincidence (e.g. a person whose email happens to
// look like first.last purely by luck) — it isn't yet evidence of a
// company-wide *convention* until a second, independent sample confirms it.
const MIN_SUPPORT = 2;

/**
 * Strip a raw name into normalized ASCII lowercase tokens, then return both:
 *  - `full`: every token joined together (e.g. "Ana María" -> "anamaria")
 *  - `first`: just the first token (e.g. "Ana María" -> "ana")
 *
 * WHY both candidates: a compound given name like "Ana María" or "José
 * Pérez" may show up in a real corporate email address either as the whole
 * compound name (ana.maria.lastname@...) or as just the leading given name
 * (ana.lastname@...) — companies aren't consistent about this, and we have
 * no way to know which convention a specific person's email actually used
 * without trying both. detectPattern() below tries both candidates against
 * every sample so it can find a pattern either way.
 */
export function normalizeNamePart(value: string): { full: string; first: string } {
  const asciiLower = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase();
  // Split on anything that isn't a-z (spaces, hyphens, apostrophes, digits,
  // punctuation...) to get individual name tokens, then drop empties.
  const tokens = asciiLower.split(/[^a-z]+/).filter(Boolean);
  return {
    full: tokens.join(""),
    first: tokens[0] ?? "",
  };
}

export interface EmailSample {
  firstName: string;
  lastName: string;
  email: string;
}

export interface DetectedPattern {
  patternId: PatternId;
  domain: string;
  agreeCount: number;
  sampleCount: number;
}

function splitEmail(email: string): { localPart: string; domain: string } | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  return { localPart: trimmed.slice(0, at), domain: trimmed.slice(at + 1) };
}

function isUsableSample(sample: EmailSample): boolean {
  if (!sample.firstName?.trim() || !sample.lastName?.trim()) return false;
  const split = splitEmail(sample.email);
  if (!split) return false;
  return !FREE_MAIL_DOMAINS.has(split.domain);
}

// Builds the local part (before @) for one pattern given already-normalized
// first/last candidates. Returns null when the pattern needs a part that's
// empty (insufficient characters after normalization).
function buildLocalPart(patternId: PatternId, first: string, last: string): string | null {
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
    case "first.l":
      return first && last ? `${first}.${last[0]}` : null;
    case "lastfirst":
      return first && last ? `${last}${first}` : null;
    case "firstl":
      return first && last ? `${first}${last[0]}` : null;
    case "first":
      return first ? first : null;
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Which patterns (if any) is this sample's email consistent with, trying
 * both the compound and first-token candidates from normalizeNamePart() for
 * both the first and last name (a compound surname like "De La Cruz" is
 * just as plausible as a compound given name).
 */
function matchPatterns(sample: EmailSample): Set<PatternId> {
  const split = splitEmail(sample.email);
  if (!split) return new Set();
  const { localPart } = split;

  const firstCandidates = uniqueNonEmpty([
    normalizeNamePart(sample.firstName).full,
    normalizeNamePart(sample.firstName).first,
  ]);
  const lastCandidates = uniqueNonEmpty([
    normalizeNamePart(sample.lastName).full,
    normalizeNamePart(sample.lastName).first,
  ]);

  const matched = new Set<PatternId>();
  for (const first of firstCandidates.length ? firstCandidates : [""]) {
    for (const last of lastCandidates.length ? lastCandidates : [""]) {
      for (const patternId of PATTERN_IDS) {
        const built = buildLocalPart(patternId, first, last);
        if (built !== null && built === localPart) matched.add(patternId);
      }
    }
  }
  return matched;
}

/**
 * Given samples from the SAME company (same-company scoping is the caller's
 * job — see src/lib/emailSuggestion.ts), detect the company's email
 * convention. Returns null when no pattern has enough support.
 */
export function detectPattern(samples: EmailSample[]): DetectedPattern | null {
  const usable = samples.filter(isUsableSample);
  if (usable.length < MIN_SUPPORT) return null;

  const votes = new Map<PatternId, { count: number; domainCounts: Map<string, number> }>();
  for (const sample of usable) {
    const split = splitEmail(sample.email);
    if (!split) continue;
    const matched = matchPatterns(sample);
    for (const patternId of matched) {
      const entry = votes.get(patternId) ?? { count: 0, domainCounts: new Map<string, number>() };
      entry.count += 1;
      entry.domainCounts.set(split.domain, (entry.domainCounts.get(split.domain) ?? 0) + 1);
      votes.set(patternId, entry);
    }
  }

  // Majority wins; on a tie, prefer the more specific pattern. Iterating
  // PATTERN_IDS in specificity order (see the const above) and only
  // replacing the winner on a STRICTLY greater vote count means the first
  // pattern to reach the max count — i.e. the most specific one among any
  // tied patterns — keeps the win.
  let winner: PatternId | null = null;
  let winnerCount = 0;
  for (const patternId of PATTERN_IDS) {
    const entry = votes.get(patternId);
    if (!entry) continue;
    if (entry.count > winnerCount) {
      winner = patternId;
      winnerCount = entry.count;
    }
  }

  if (!winner || winnerCount < MIN_SUPPORT) return null;

  const entry = votes.get(winner)!;
  let domain = "";
  let domainCount = -1;
  for (const [d, c] of entry.domainCounts) {
    if (c > domainCount) {
      domain = d;
      domainCount = c;
    }
  }

  return { patternId: winner, domain, agreeCount: winnerCount, sampleCount: usable.length };
}

/**
 * Build the suggested address for one contact given a detected pattern.
 * Uses the FULL (compound-joined) candidate for both names — detectPattern
 * already validated the pattern against real samples, so this is the
 * best-effort default; for patterns that only use an initial (f.last,
 * flast, first.l, lastfirst, firstl) the result is identical either way
 * since the initial is the same regardless of which candidate is used.
 * Returns null when firstName/lastName normalize to insufficient characters
 * for the pattern (e.g. empty after stripping non-letters).
 */
export function buildEmail(
  patternId: PatternId,
  domain: string,
  firstName: string,
  lastName: string,
): string | null {
  const first = normalizeNamePart(firstName).full;
  const last = normalizeNamePart(lastName).full;
  const localPart = buildLocalPart(patternId, first, last);
  if (!localPart || !domain) return null;
  return `${localPart}@${domain}`;
}
