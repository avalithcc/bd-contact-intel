/**
 * FROZEN copy of src/lib/hiring/markets.ts as of 76ddd9ba (main, before the country-signal rewrite of 2026-10-27).
 * Exists only so scripts/measure/market-country-signal.ts can run the REAL old classifier next to the real new one.
 * Do not edit, do not import from src/: it is a measurement reference, not application code.
 */
import { tokenize } from "../../src/lib/hiring/countryFilter";

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
export function normalizeText(text: string): string {
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

/**
 * Country names this business tracks (LATAM), lowercase and diacritics-free.
 * Also the only country list the contact form trusts when it splits a LinkedIn
 * location into city and country (src/lib/contacts/locationSplit.ts).
 */
export const LATAM_COUNTRY_NAMES: readonly string[] = [
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
];

// LATAM: the 15 countries this business currently tracks contacts/companies
// in, their main cities, and bare ISO-ish country codes as ATS providers
// commonly emit them (e.g. Lever's "Palermo, CABA, AR").
//
// Known ambiguity, and NOT fixed by the constants-only correction of
// 2026-10-21: "ar" (Argentina), "co" (Colombia) and "pa" (Panama) are also
// US state postal abbreviations (Arkansas, Colorado, Pennsylvania).
// LATAM_RULES is checked first in classifyMarket and returns before
// US_RULES is consulted, so a posting carrying one of those codes is filed
// latam even when the rest of the text is plainly American. The earlier
// assumption here ("a much rarer case than an actual LATAM posting") was
// measured on 2026-10-21 against 15,810 production rows and is false: 182
// rows are plainly-US text filed latam (co 118, pa 47, ar 11; 40 open IT,
// 29 fresh IT), e.g. "Colorado Springs, CO, United States", "Denver, CO,
// USA", "US-CO-Denver", "Philadelphia, PA, United States". Fixing that needs
// a precedence change in classifyMarket (for example, an explicit US signal
// such as "united states"/"usa"/"us" outranking a bare 2-letter LATAM code),
// not a constants edit.
//
// Also unfixed, same measurement: bare "ca" is both Canada and California
// (67 rows, 30 Canada vs 37 California; it is a US token, so Canada files
// us), and "mexico" matches as a substring inside "New Mexico"
// ("Albuquerque, New Mexico" files latam, 2 rows). "peru" would fix 1
// non-live row ("Perugia, IT") as a token, but it lives in
// LATAM_COUNTRY_NAMES, which also feeds isKnownCountryName (the contact
// form), and tokenizing "brasil" the same way would lose "Brasilia".
// tests/unit/hiringMarkets.test.ts pins these at their current values.
const LATAM_RULES: MarketRules = {
  phrases: [
    ...LATAM_COUNTRY_NAMES,
    // Main cities (also reachable via the country phrase above when both
    // appear, but a posting sometimes lists only the city).
    "buenos aires",
    "montevideo",
    "santiago",
    "bogota",
    "ciudad de mexico",
    "sao paulo",
    // "lima" is a token below, not a phrase: as a substring it hit
    // "Limassol, Cyprus" (11 rows, measured 2026-10-21).
    //
    // "san jose" was deleted on 2026-10-21. It filed 42 rows latam solely:
    // 37 say California, 2 are "Santana Row, San Jose" (San Jose, California)
    // and 3 are bare "San Jose"; none were a live Costa Rica posting (22 open
    // IT, 8 fresh IT were misfiled). Real Costa Rica rows still match:
    // "San Jose, Costa Rica" via the "costa rica" phrase, "San Jose, CR" via
    // the "cr" token. Bare "San Jose" is now other.
    "asuncion",
    "quito",
    "caracas",
    "santo domingo",
    "guadalajara",
    "medellin",
    "guatemala city",
  ],
  tokens: [
    "lima", // Token, not phrase: see the note above ("Limassol").
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
// recognized via the phrase list, which has no such collision. (That
// exclusion is why the precedence problem described above LATAM_RULES
// exists: a bare "CO"/"PA" is never read as US.)
//
// REMOVED on 2026-10-21 (measured against 15,810 production rows), because
// they collided with far more foreign text than real US text:
// - "in" (Indiana): 239 rows wrong (70 open IT, 50 fresh IT). 43 were
//   "In-Office", ~56 the English preposition ("Anywhere in France"), ~130
//   India ("Bengaluru, IN", "IN-Bangalore-MSO", "Chennai, in"). Real Indiana:
//   3 rows ("Lafayette, IN" x2, "Evansville, IN"), 0 open IT, 0 fresh IT; that
//   is the accepted cost, pinned in tests. "Indiana" and "Indianapolis" still
//   match through the "indiana" phrase. It also made 138 rows match
//   OFFSHORE_HUB_RULES while filed us.
// - "de" (Delaware): 113 rows wrong (8 open IT, 3 fresh IT): "Berlin, DE",
//   "Cologne, de", "Pas-de-Calais", "Hauts-de-France", "Rio de Janeiro",
//   "Cuajimalpa de Morelos". Zero Delaware rows; "delaware" still matches.
// - "id" (Idaho): 14 rows wrong, all Indonesia ("Jakarta, ID"). Zero Idaho
//   rows; "idaho" still matches.
// The accepted cost of the last two is that a US feed writing the postal code
// instead of the state name ("Wilmington, DE", "Boise, ID") now files other.
// Zero such rows existed, but the loss is pinned in tests rather than left
// implied by "zero rows" — see tests/unit/hiringMarkets.test.ts.
//
// "usa", "miami" are tokens, not phrases, to avoid substring false
// positives: "usa" hit "Lausanne, Switzerland", "Busan, South Korea",
// "Jerusalem, Israel" and "Cusano Milanino, IT" — 7 matches, of which 6 move
// to other (1 open IT, 1 fresh IT); the 7th, "Azusa, CA, us", stays us
// through its own "ca"/"us" tokens. "miami" hit "Miamisburg, OH, us" (still
// us via its "oh"/"us" tokens, so classifyMarket is unchanged; the Florida
// cut is what that one was corrupting — see FLORIDA_TOKENS).
const US_RULES: MarketRules = {
  phrases: [
    "united states",
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
    // Major cities ("miami" is a token below).
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
    "usa", // Token, not phrase: see the note above ("Lausanne", "Busan").
    "miami", // Token, not phrase: see the note above ("Miamisburg").
    "al",
    "ak",
    "az",
    "ca",
    "ct",
    "fl",
    "ga",
    "hi",
    "il",
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
// for the same reason as the country codes above. "miami" is a token for the
// same reason: as a substring it matched "Miamisburg, OH, us", so 27 Ohio
// rows were stored is_miami = true (4 open IT, 3 fresh IT; measured
// 2026-10-21). "Miami-Dade" and "Miami Beach" still match, since the
// tokenizer splits on hyphens and spaces.
export const FLORIDA_PHRASES = [
  "florida",
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
export const FLORIDA_TOKENS = ["fl", "miami"];

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

/**
 * True when `text` is exactly a country name this app already recognizes
 * (LATAM list plus "united states"), ignoring case and diacritics. Exact match
 * only: "Greater Buenos Aires" or "Miami, FL" are not countries.
 */
export function isKnownCountryName(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeText(text).trim().replace(/\s+/g, " ");
  return normalized === "united states" || LATAM_COUNTRY_NAMES.includes(normalized);
}
