import { tokenize } from "./countryFilter";

/**
 * The "market" dimension for hiring signals: a coarse geography bucket
 * derived from a job posting's free-text `location`, independent of any
 * per-company `target_company.country_filter` (see sync.ts — that filter is
 * deprecated and no longer used to drop postings at import time). Keys are
 * stable and stored as-is in `job_posting.market` — see src/db/schema.ts.
 *
 * Display labels are localized — see src/lib/i18n/dictionaries/{en,es}.ts
 * (`markets` record), keyed by the same MarketKey, same pattern as
 * RoleGroupKey in src/lib/roleGroups.ts.
 */
export const MARKETS = ["latam", "us", "other"] as const;
export type MarketKey = (typeof MARKETS)[number];

interface MarketRules {
  // Substring match against the normalized (lowercased, diacritics-
  // stripped) location text — safe for multi-word names ("buenos aires",
  // "new york") where a whole-token match would require splitting on
  // spaces, which loses the phrase.
  phrases: string[];
  // Whole-token match (via the shared tokenizer from countryFilter.ts) —
  // required for bare 2/3-letter codes ("ar", "us", "fl"), since a
  // substring match on a short code would false-positive inside unrelated
  // words (a "ar" substring match would hit "Paraguay" or "Barcelona").
  tokens: string[];
}

/** Strips diacritics and lowercases, so "São Paulo"/"Bogotá"/"México" match
 * their unaccented spellings too without listing both forms everywhere. */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesRules(normalized: string, rules: MarketRules): boolean {
  if (rules.phrases.some((phrase) => normalized.includes(phrase))) return true;
  const tokens = new Set(tokenize(normalized));
  return rules.tokens.some((token) => tokens.has(token));
}

// LATAM: the 15 countries this business currently tracks contacts/companies
// in, their main cities, and bare ISO-ish country codes as ATS providers
// commonly emit them (e.g. Lever's "Palermo, CABA, AR").
//
// Known, accepted ambiguity: "ar" (Argentina), "co" (Colombia) and "pa"
// (Panama) are also US state postal abbreviations (Arkansas, Colorado,
// Pennsylvania). This module resolves that collision in LATAM's favor
// (LATAM_RULES is checked before US_RULES in classifyMarket) and does NOT
// include ar/co/pa in US_RULES' tokens — see the comment there. This app's
// tracked company boards are overwhelmingly LATAM-first, so a stray US
// state 2-letter code colliding with a LATAM country code is a much rarer
// real-world case than an actual LATAM posting; revisit if a US-heavy
// target company's postings start getting misclassified this way.
const LATAM_RULES: MarketRules = {
  phrases: [
    "argentina",
    "uruguay",
    "chile",
    "paraguay",
    "bolivia",
    "peru",
    "ecuador",
    "colombia",
    "venezuela",
    "brazil",
    "brasil",
    "mexico",
    "costa rica",
    "panama",
    "guatemala",
    "dominican republic",
    "republica dominicana",
    // Main cities (also reachable via the country phrase above when both
    // appear, but a posting sometimes lists only the city).
    "buenos aires",
    "montevideo",
    "santiago",
    "bogota",
    "ciudad de mexico",
    "sao paulo",
    "lima",
    "san jose", // Costa Rica's capital — also San Jose, California (see US_RULES); unresolved without a stronger signal, see module-level ambiguity note.
    "asuncion",
    "quito",
    "caracas",
    "santo domingo",
    "guadalajara",
    "medellin",
    "guatemala city",
  ],
  tokens: [
    "ar",
    "arg",
    "caba",
    "bsas",
    "uy",
    "ury",
    "cl",
    "chl",
    "py",
    "pry",
    "bo",
    "bol",
    "pe",
    "per",
    "ec",
    "ecu",
    "co",
    "col",
    "ve",
    "ven",
    "br",
    "bra",
    "mx",
    "mex",
    "cdmx",
    "cr",
    "cri",
    "pa",
    "pan",
    "gt",
    "gtm",
    "do",
    "dom",
  ],
};

// US: full state names (unambiguous, so all 50 + DC are listed), major
// cities with Miami/Florida called out per the business ask, and bare
// "us"/"usa" tokens.
//
// Deliberately NOT included as tokens: "ar" (Arkansas), "co" (Colorado),
// "pa" (Pennsylvania) — they collide with LATAM country codes above. Their
// full state names ("arkansas", "colorado", "pennsylvania") are still
// recognized via the phrase list, which has no such collision.
const US_RULES: MarketRules = {
  phrases: [
    "united states",
    "usa",
    "alabama",
    "alaska",
    "arizona",
    "arkansas",
    "california",
    "colorado",
    "connecticut",
    "delaware",
    "florida",
    "georgia",
    "hawaii",
    "idaho",
    "illinois",
    "indiana",
    "iowa",
    "kansas",
    "kentucky",
    "louisiana",
    "maine",
    "maryland",
    "massachusetts",
    "michigan",
    "minnesota",
    "mississippi",
    "missouri",
    "montana",
    "nebraska",
    "nevada",
    "new hampshire",
    "new jersey",
    "new mexico",
    "new york",
    "north carolina",
    "north dakota",
    "ohio",
    "oklahoma",
    "oregon",
    "pennsylvania",
    "rhode island",
    "south carolina",
    "south dakota",
    "tennessee",
    "texas",
    "utah",
    "vermont",
    "virginia",
    "washington",
    "west virginia",
    "wisconsin",
    "wyoming",
    "district of columbia",
    // Major cities.
    "miami",
    "fort lauderdale",
    "coral gables",
    "doral",
    "hialeah",
    "new york city",
    "los angeles",
    "san francisco",
    "chicago",
    "austin",
    "seattle",
    "boston",
    "atlanta",
    "dallas",
    "houston",
    "denver",
    "arlington",
    "washington dc",
    "philadelphia",
    "san diego",
    "phoenix",
    "orlando",
    "tampa",
  ],
  tokens: [
    "us",
    "usa",
    "al",
    "ak",
    "az",
    "ca",
    "ct",
    "de",
    "fl",
    "ga",
    "hi",
    "id",
    "il",
    "in",
    "ia",
    "ks",
    "ky",
    "la",
    "me",
    "md",
    "ma",
    "mi",
    "mn",
    "ms",
    "mo",
    "mt",
    "ne",
    "nv",
    "nh",
    "nj",
    "nm",
    "ny",
    "nc",
    "nd",
    "oh",
    "ok",
    "or",
    "ri",
    "sc",
    "sd",
    "tn",
    "tx",
    "ut",
    "vt",
    "va",
    "wa",
    "wv",
    "wi",
    "wy",
    "dc",
  ],
};

// Phrases that indicate the Miami metro area specifically — a finer hint on
// top of the "us" market bucket for the team's stated Miami focus. Does NOT
// change classifyMarket's output (Miami postings are still just "us"); use
// this only where a Miami-specific callout is cheap to add.
const MIAMI_PHRASES = ["miami", "fort lauderdale", "coral gables", "doral", "hialeah"];

/**
 * Classifies a job posting's free-text location into a market bucket.
 * Order matters: LATAM is checked before US (see the ambiguity note on
 * LATAM_RULES above). A null/blank/unrecognized location — including bare
 * "Remote" with no country — classifies as "other": there's no way to know
 * which market a companyless "Remote" posting is really open to, so it's
 * deliberately not guessed as either LATAM or US.
 */
export function classifyMarket(location: string | null | undefined): MarketKey {
  if (!location) return "other";
  const normalized = normalizeText(location);
  if (matchesRules(normalized, LATAM_RULES)) return "latam";
  if (matchesRules(normalized, US_RULES)) return "us";
  return "other";
}

/** Whether a location falls in the Miami metro area (see MIAMI_PHRASES). */
export function isMiamiArea(location: string | null | undefined): boolean {
  if (!location) return false;
  const normalized = normalizeText(location);
  return MIAMI_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function isMarketKey(value: string | null | undefined): value is MarketKey {
  return !!value && (MARKETS as readonly string[]).includes(value);
}
