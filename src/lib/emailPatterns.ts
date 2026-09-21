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

/** Which normalized candidate of a name a company's addresses actually use. */
export type NameVariant = "full" | "first";

export interface DetectedPattern {
  patternId: PatternId;
  domain: string;
  agreeCount: number;
  sampleCount: number;
  // Compound names ("Ana María", "De La Cruz") normalize to two candidates,
  // and a company consistently uses one of them. These record which one the
  // samples agreed on, so buildEmail() reproduces the same choice instead of
  // defaulting to the compound form.
  firstVariant: NameVariant;
  lastVariant: NameVariant;
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

interface PatternMatch {
  firstVariants: Set<NameVariant>;
  lastVariants: Set<NameVariant>;
}

/** Majority variant across the samples that agreed on the winning pattern. */
function majorityVariant(counts: Map<NameVariant, number>): NameVariant {
  return (counts.get("first") ?? 0) > (counts.get("full") ?? 0) ? "first" : "full";
}

/**
 * Which patterns (if any) is this sample's email consistent with, trying
 * both the compound and first-token candidates from normalizeNamePart() for
 * both the first and last name (a compound surname like "De La Cruz" is
 * just as plausible as a compound given name).
 */
function matchPatterns(sample: EmailSample): Map<PatternId, PatternMatch> {
  const split = splitEmail(sample.email);
  if (!split) return new Map();
  const { localPart } = split;

  const first = normalizeNamePart(sample.firstName);
  const last = normalizeNamePart(sample.lastName);
  const firstCandidates: [NameVariant, string][] = [
    ["full", first.full],
    ["first", first.first],
  ];
  const lastCandidates: [NameVariant, string][] = [
    ["full", last.full],
    ["first", last.first],
  ];

  const matched = new Map<PatternId, PatternMatch>();
  for (const [firstVariant, firstValue] of firstCandidates) {
    for (const [lastVariant, lastValue] of lastCandidates) {
      if (!firstValue && !lastValue) continue;
      for (const patternId of PATTERN_IDS) {
        const built = buildLocalPart(patternId, firstValue, lastValue);
        if (built === null || built !== localPart) continue;
        const entry = matched.get(patternId) ?? {
          firstVariants: new Set<NameVariant>(),
          lastVariants: new Set<NameVariant>(),
        };
        entry.firstVariants.add(firstVariant);
        entry.lastVariants.add(lastVariant);
        matched.set(patternId, entry);
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

  const votes = new Map<
    PatternId,
    {
      count: number;
      domainCounts: Map<string, number>;
      firstVariants: Map<NameVariant, number>;
      lastVariants: Map<NameVariant, number>;
    }
  >();
  for (const sample of usable) {
    const split = splitEmail(sample.email);
    if (!split) continue;
    for (const [patternId, match] of matchPatterns(sample)) {
      const entry = votes.get(patternId) ?? {
        count: 0,
        domainCounts: new Map<string, number>(),
        firstVariants: new Map<NameVariant, number>(),
        lastVariants: new Map<NameVariant, number>(),
      };
      entry.count += 1;
      entry.domainCounts.set(split.domain, (entry.domainCounts.get(split.domain) ?? 0) + 1);
      // A sample whose compound and first-token candidates both match (a
      // single-token name) votes for both, so neither variant is favoured
      // by names that can't distinguish them.
      for (const variant of match.firstVariants) {
        entry.firstVariants.set(variant, (entry.firstVariants.get(variant) ?? 0) + 1);
      }
      for (const variant of match.lastVariants) {
        entry.lastVariants.set(variant, (entry.lastVariants.get(variant) ?? 0) + 1);
      }
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

  return {
    patternId: winner,
    domain,
    agreeCount: winnerCount,
    sampleCount: usable.length,
    firstVariant: majorityVariant(entry.firstVariants),
    lastVariant: majorityVariant(entry.lastVariants),
  };
}

/**
 * Build the suggested address for one contact given a detected pattern.
 * `firstVariant`/`lastVariant` come from detectPattern() and say whether
 * this company's addresses spell a compound name out in full
 * ("ana.maria.gomez") or keep only its leading token ("ana.gomez"); both
 * default to the compound form when the caller has no detection to pass.
 * Returns null when firstName/lastName normalize to insufficient characters
 * for the pattern (e.g. empty after stripping non-letters).
 */
export function buildEmail(
  patternId: PatternId,
  domain: string,
  firstName: string,
  lastName: string,
  firstVariant: NameVariant = "full",
  lastVariant: NameVariant = "full",
): string | null {
  const first = normalizeNamePart(firstName)[firstVariant];
  const last = normalizeNamePart(lastName)[lastVariant];
  const localPart = buildLocalPart(patternId, first, last);
  if (!localPart || !domain) return null;
  return `${localPart}@${domain}`;
}
