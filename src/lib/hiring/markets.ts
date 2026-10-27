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

// How classifyMarket weighs evidence (owner-approved 2026-10-27; measured against
// 15,810 production rows). Before this, LATAM rules ran first and returned on the
// first boolean match, so a bare 2-letter code ("co", "pa", "ar") outranked an
// explicit "United States": 182 plainly-US rows were filed latam. Now there are
// three tiers, and a higher tier decides before a lower one is consulted:
//   1. COUNTRY: a country name ("united states", "costa rica"), a "us"/"usa"
//      token, an unambiguous LATAM country code, or the country code ATS feeds
//      put in a fixed position: the trailing segment of "City, Region, XX"
//      ("Chennai, TN, in", "Toronto, ON, ca", "Denver, CO, us") or the prefix of
//      "XX-Region-City" ("US-CO-Denver", "CA-Ontario-Toronto"). Inside tier 1,
//      LATAM beats US (the old order, kept for genuinely mixed postings), and a
//      country that is neither files other even if a state-like token follows.
//   2. NAMED PLACE: a city or a US state name. "Denver, CO" is Colorado because
//      Denver is a US city; "Bogota, CO" is Colombia because Bogota is a LATAM city.
//   3. BARE CODE: a US state code files us. The codes "ar", "co", "pa" (Argentina,
//      Colombia, Panama; also Arkansas, Colorado, Pennsylvania) and "ca" outside
//      "City, CA" are genuinely ambiguous and count for neither side. other is
//      the safe failure: fromPostings holds an `other` audience instead of mailing
//      the wrong language.
// A location of several places ("Denver, CO; Toronto, ON, ca") is classified part
// by part (split on ";") and the best part wins, LATAM first.
//
// Left alone on purpose: "peru"/"Perugia" and "brasil"/"Brasilia" (both live in
// LATAM_COUNTRY_NAMES, which also feeds isKnownCountryName and so the contact
// form), "lima" in "Lima, OH".
const LATAM_COUNTRY_RULES: MarketRules = {
  phrases: [...LATAM_COUNTRY_NAMES],
  tokens: [
    "arg",
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
    "col",
    "ve",
    "ven",
    "br",
    "bra",
    "mx",
    "mex",
    "cr",
    "cri",
    "pan",
    "gt",
    "gtm",
    "do",
    "dom",
  ],
};

// LATAM codes that are also US state postal codes. They count as a country only
// in a country position (see countryCode); anywhere else they are ambiguous.
const AMBIGUOUS_LATAM_CODES: readonly string[] = ["ar", "co", "pa"];

const LATAM_PLACE_RULES: MarketRules = {
  phrases: [
    // Main cities (a posting sometimes lists only the city).
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
  // Token, not phrase: "lima" would hit "Limassol" (see above).
  tokens: ["lima", "caba", "bsas", "cdmx"],
};

// US: full state names (unambiguous, so all 50 + DC are listed), major
// cities with Miami/Florida called out per the business ask, and the 2-letter
// state codes (US_STATE_CODES below).
//
// Deliberately NOT in US_STATE_CODES: "ar" (Arkansas), "co" (Colorado), "pa"
// (Pennsylvania) — they collide with LATAM country codes. Their full state
// names ("arkansas", "colorado", "pennsylvania") are still recognized via the
// phrase list, which has no such collision. A bare "CO"/"PA"/"AR" is ambiguous
// and counts for neither side (see the tiers above).
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
const US_PLACE_RULES: MarketRules = {
  phrases: [
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
    // "new mexico" is rewritten to its code before matching (see classifyMarket).
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
  tokens: ["miami"], // Token, not phrase: see the note above ("Miamisburg").
};

// "usa" is a token for the same reason ("Lausanne", "Busan"); "us" likewise.
const US_COUNTRY_RULES: MarketRules = { phrases: ["united states"], tokens: ["us", "usa"] };

// US state codes that are NOT a country's ISO code: in a country position
// ("Dallas, TX, Austin, TX") they are still a state, never a country.
const US_STATE_ONLY_CODES: readonly string[] = [
  "ak", "ct", "fl", "hi", "ia", "ks", "mi", "nh", "nj", "nm", "nv", "ny", "nd", "oh", "ok", "or", "ri", "tx", "ut", "vt", "wa", "wv", "wi", "wy", "dc",
];
// State codes that are also a country's ISO code (Albania, Canada, Israel, Laos,
// Morocco, Moldova, Tunisia...). "ca" is handled by position, see californiaAfterCity.
const US_ISO_COLLIDING_CODES: readonly string[] = [
  "al", "az", "ga", "il", "ky", "la", "me", "md", "ma", "mn", "ms", "mo", "mt", "ne", "nc", "sc", "sd", "tn", "va",
];
const US_STATE_CODES: readonly string[] = [...US_STATE_ONLY_CODES, ...US_ISO_COLLIDING_CODES];

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

const MARKET_RANK: Record<MarketKey, number> = { other: 0, us: 1, latam: 2 };
// ATS feeds write the country in a fixed position: a 2-letter prefix ("US-CO-Denver") or a
// trailing segment after city and region ("Denver, CO, us"). "co-op" style words match the
// prefix form too, but only a LATAM or US code changes the answer and none of those occur.
const COUNTRY_PREFIX = /^([a-z]{2})-[a-z]/;
// A list of places ("Arlington, VA or Clearwater, FL") ends in a state, not a country.
const PLACE_LIST_JOINER = /\s(?:and|or)\s|[&/]/;

/** The country code a feed put in the prefix or trailing position, or null (state-only codes are never a country). */
function countryCode(part: string, segments: string[]): string | null {
  const last = segments.length >= 3 && !PLACE_LIST_JOINER.test(part) ? segments[segments.length - 1] : "";
  const code = COUNTRY_PREFIX.exec(part)?.[1] ?? (/^[a-z]{2}$/.test(last) ? last : null);
  return code && !US_STATE_ONLY_CODES.includes(code) ? code : null;
}

/** "San Francisco, CA" is California; "ca" anywhere else (leading word, list item) is Canada or California: no verdict. */
const californiaAfterCity = (segments: string[]): boolean => segments.slice(1).some((s) => tokenize(s)[0] === "ca");

function classifyPart(part: string): MarketKey {
  const segments = part.split(",").map((s) => s.trim()).filter(Boolean);
  const code = countryCode(part, segments);
  const isLatamCode = !!code && (LATAM_COUNTRY_RULES.tokens.includes(code) || AMBIGUOUS_LATAM_CODES.includes(code));
  if (matchesRules(part, LATAM_COUNTRY_RULES) || isLatamCode) return "latam";
  if (matchesRules(part, US_COUNTRY_RULES)) return "us";
  if (code) return "other";
  if (matchesRules(part, LATAM_PLACE_RULES)) return "latam";
  if (matchesRules(part, US_PLACE_RULES)) return "us";
  const tokens = new Set(tokenize(part));
  return US_STATE_CODES.some((c) => tokens.has(c)) || californiaAfterCity(segments) ? "us" : "other";
}

/**
 * Classifies a job posting's free-text location into a market bucket, weighing country
 * evidence over named places over bare codes (see the tiers above LATAM_COUNTRY_RULES).
 * A null/blank/unrecognized location — including bare "Remote" with no country —
 * classifies as "other": there's no way to know which market a companyless "Remote"
 * posting is really open to, so it's deliberately not guessed as either LATAM or US.
 */
export function classifyMarket(location: string | null | undefined): MarketKey {
  if (!location) return "other";
  const normalized = normalizeText(location)
    .replace(/\bnew mexico\b/g, "nm")
    .replace(/\bu\.s\.(a\.?)?/g, (_, a) => (a ? "usa " : "us "));
  let best: MarketKey = "other";
  for (const part of normalized.split(";")) {
    const market = classifyPart(part.trim());
    if (MARKET_RANK[market] > MARKET_RANK[best]) best = market;
  }
  return best;
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
// unlike the country/place rules above. India's own code ("in") would collide,
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
