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

// Florida, as a finer cut on top of the "us" market bucket: the team sells
// into the state from Miami, and Miami-metro alone matched too few postings
// to work with. Does NOT change classifyMarket's output (Florida postings
// are still just "us"). "fl" is matched as a whole token, never a substring,
// for the same reason as the country codes above.
const FLORIDA_PHRASES = [
  "florida",
  "miami",
  "fort lauderdale",
  "coral gables",
  "doral",
  "hialeah",
  "orlando",
  "tampa",
  "jacksonville",
  "st petersburg",
  "saint petersburg",
  "boca raton",
  "west palm beach",
  "tallahassee",
  "sarasota",
  "naples",
  "gainesville",
  "clearwater",
  "cape coral",
  "fort myers",
];
const FLORIDA_TOKENS = ["fl"];

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

/**
 * Whether a location falls in Florida (see FLORIDA_PHRASES). Kept under the
 * historical name so callers and the persisted `job_posting.is_miami` column
 * stay stable; the label shown to users says Florida, which is what this
 * actually matches.
 */
export function isMiamiArea(location: string | null | undefined): boolean {
  if (!location) return false;
  const normalized = normalizeText(location);
  if (FLORIDA_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  const tokens = new Set(tokenize(location));
  return FLORIDA_TOKENS.some((token) => tokens.has(token));
}

export function isMarketKey(value: string | null | undefined): value is MarketKey {
  return !!value && (MARKETS as readonly string[]).includes(value);
}

// Offshore delivery hubs that compete with LATAM nearshore for the same
// kind of engineering work: a company already staffing here has partly
// solved the same need elsewhere, so it's a WEAKER — but not worthless —
// prospect for LATAM nearshore (some such companies still carry many open
// LATAM roles). See `job_posting.is_offshore_hub` in src/db/schema.ts for
// how this is persisted and used downstream.
//
// Deliberately does NOT include Eastern Europe (Poland, Romania, Ukraine,
// etc.) — whether that region competes with LATAM nearshore the same way
// is a separate business decision nobody has made yet. Do not extend this
// list to cover it without that decision being made explicitly.
//
// Every entry here is a country/city NAME — no bare ISO country codes,
// unlike LATAM_RULES/US_RULES above. India's own code ("in") would collide,
// as a bare token, with the US state abbreviation for Indiana
// ("Indianapolis, IN" must NOT classify as an offshore hub), and nothing
// downstream needs offshore matching on a bare code.
//
// "india" itself is a TOKEN, not a phrase: matched as a substring it would
// false-positive inside "Indiana"/"Indianapolis" — exactly the trap
// documented on the shared tokenizer in countryFilter.ts. Every other
// single-word country/city name below is a token for the same reason; only
// genuinely multi-word names ("sri lanka", "ho chi minh") are phrases,
// since the tokenizer splits on word boundaries and can never match a
// phrase spanning more than one token.
const OFFSHORE_HUB_RULES: MarketRules = {
  phrases: ["sri lanka", "ho chi minh"],
  tokens: [
    "india",
    "philippines",
    "vietnam",
    "bangladesh",
    "pakistan",
    // India's main tech cities.
    "bangalore",
    "bengaluru",
    "hyderabad",
    "pune",
    "chennai",
    "gurgaon",
    "gurugram",
    "noida",
    "mumbai",
    "delhi",
    "kolkata",
    "ahmedabad",
    // Philippines.
    "manila",
    "cebu",
    // Vietnam.
    "hanoi",
  ],
};

/**
 * Whether a location falls in one of the offshore delivery hubs that
 * compete with LATAM nearshore (see OFFSHORE_HUB_RULES above). Independent
 * of `classifyMarket`/`isMiamiArea` — a posting can be "other" market and
 * still be an offshore-hub posting (e.g. plain "Bangalore, India").
 */
export function isOffshoreHub(location: string | null | undefined): boolean {
  if (!location) return false;
  return matchesRules(normalizeText(location), OFFSHORE_HUB_RULES);
}

/**
 * Whether a company's engineering hiring is "offshore-heavy": strictly more
 * open IT postings in an offshore delivery hub (see isOffshoreHub above)
 * than in LATAM. This is the proportional refinement of the old
 * presence-based rule (any offshore posting at all) — a company with a
 * handful of offshore roles alongside a much larger LATAM footprint is
 * still a live LATAM prospect, not a lost one.
 *
 * A tie (equal counts, including 0-0) resolves to `false`, deliberately in
 * the prospect's favor: a company investing in LATAM at least as much as
 * offshore has not shown a preference for offshore delivery.
 *
 * This is the single place this comparison is made — see resolveHiringCompanies
 * in src/lib/hiring/queries.ts, which calls this once per company and
 * threads the resulting boolean (plus the two counts, for the UI badge)
 * everywhere else; other modules must not re-derive it.
 */
export function isOffshoreHeavy(offshoreItCount: number, latamItCount: number): boolean {
  return offshoreItCount > latamItCount;
}
