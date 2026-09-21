/**
 * Last-resort corporate domain guess, derived from a company's NAME rather
 * than from any colleague's email address.
 *
 * WHY this exists: measured on the real base, of 17024 contacts only 556
 * have an email on file at all, and 89% of those are free-mail
 * (gmail/hotmail/outlook.com.ar/...). That means for the overwhelming
 * majority of companies, src/lib/emailPatterns.ts's detectPattern() and
 * detectDomain() have literally nothing to work with — not even one
 * colleague sample. Without this module, most contacts would get no
 * suggestion at all.
 *
 * WHY DNS-only, no scraping or paid API: this app has no budget for a paid
 * email-verification or company-enrichment service, and scraping a
 * company's website is unreliable, slow, and legally murkier than a plain
 * DNS query. MX resolution is free, fast, and (per src/lib/emailDomain.ts)
 * already the mechanism this app uses everywhere else to judge whether a
 * domain can receive mail at all.
 *
 * WHY MX presence is the acceptance filter: a domain that is merely
 * registered but not actively used for a business (a parked domain, a
 * placeholder, a name squatted by someone unrelated) typically has NO MX
 * record — nothing is configured to receive mail for it. That, plus the
 * parking-host blocklist below, is the whole acceptance bar. Be clear-eyed
 * about its strength: ANY domain with a working mail setup passes, because
 * detectProvider() labels every unrecognized-but-present MX as "other".
 * It rejects typos and unregistered names, NOT a live domain belonging to
 * an unrelated company with the same name — which is why the UI must always
 * present this as an unconfirmed guess.
 *
 * WHY confidence is always "low" and source is "guessed-domain": this is an
 * identity guess about which real-world company the contact's employer
 * name refers to, not evidence gathered from the BD's own contacts. Company
 * names collide — a US "Flexibility Inc" is a different company from a
 * same-named business elsewhere — so a DNS hit for a plausible domain never
 * confirms it's actually THIS company's domain. The caller
 * (src/lib/emailSuggestion.ts) and the UI must never present this as a
 * detected or even assumed convention; it must always read as "we guessed,
 * please eyeball it."
 */
import { isFreeMailDomain } from "@/lib/emailPatterns";
import { COMPANY_SUFFIX_RE } from "@/lib/companyCategories";
import { isDeadDomain, getDomainCheck, type MailProvider } from "@/lib/domainCheckCache";

// TLDs to try, ordered by likelihood across this LATAM-wide base (this BD
// covers more than Argentina — e.g. "Banco Pichincha" is Ecuadorian and only
// resolves on .com.ec, not .com). Generic/global first, then the LATAM
// country TLDs actually seen in this base (Argentina, Ecuador, Colombia,
// Peru, Uruguay, Mexico, Brazil, Chile), then Spain (a common HQ for LATAM
// subsidiaries), then a handful of tech-company TLDs last, since they're
// common for startups but rarer for the traditional companies in this base.
const CANDIDATE_TLDS = [
  ".com",
  ".com.ar",
  ".com.ec",
  ".com.co",
  ".com.pe",
  ".com.uy",
  ".com.mx",
  ".com.br",
  ".cl",
  ".es",
  ".io",
  ".net",
  ".app",
  ".dev",
];

// Hard cap on how many (variant, tld) candidates we'll even construct: up to
// 3 name variants (see buildNameVariants) times CANDIDATE_TLDS.length. Keeps
// the candidate list bounded regardless of either list growing later.
const MAX_CANDIDATES = 3 * CANDIDATE_TLDS.length;

// Hard cap on how many LIVE DNS lookups (i.e. NOT answered from
// domainCheckCache's 30-day cache — see the `fromCache` check in the loop
// below) a single guessCompanyDomain() call may issue. Resolution is
// sequential with an early exit on the first accepted candidate, so this is
// also the worst-case number of live round trips added to one contact-detail
// page render. Set to cover a full pass over CANDIDATE_TLDS for the most
// specific name variant plus a few candidates into the next variant (the
// case that matters: "Opinno Ecuador" needs to fail all TLDs for the full
// name before "opinno.com" — variant b's first candidate — gets tried). This
// is affordable because NXDOMAIN/no-MX answers come back in tens of ms; only
// a timeout is slow (see LOOKUP_BUDGET_MS below), and a warm company (every
// candidate already cached) doesn't spend any of this allowance at all.
const MAX_LOOKUPS = 16;

// Wall-clock budget for the whole guess, counted against LIVE lookups only —
// a cache hit is a local DB read, not a DNS round trip, so it doesn't eat
// into this budget (see the `fromCache` check below). Checked BEFORE each
// live lookup, so a lookup that starts just inside the budget can still run
// to the 3s DNS timeout — worst case is therefore ~LOOKUP_BUDGET_MS +
// LOOKUP_TIMEOUT_MS for one call, not a hard ceiling at LOOKUP_BUDGET_MS.
// MAX_LOOKUPS alone bounds the number of live queries, not the time they
// take: several candidates that each hit the 3s DNS timeout would stall a
// contact-detail render badly. In the common case (NXDOMAIN/no-MX answers in
// tens of ms) this budget comfortably covers all MAX_LOOKUPS live attempts
// in well under a second; the ~3-4s worst case only happens when a candidate
// actually times out, and even then it's ONE bounded pass — the loop gives
// up for good once the budget is spent, it never restarts or retries a
// second time within the same call. A missing guess is cheap, a page that
// hangs is not.
const LOOKUP_BUDGET_MS = 2500;

// Only these MX-detected providers (see src/lib/emailDomain.ts) count as
// Providers we accept a guess on. "unknown" (no MX at all) is excluded, but
// note that "other" — any working mail setup we don't recognize — IS
// accepted: most company domains run something other than the five named
// providers, and rejecting them would throw away most real hits.
const ACCEPTED_PROVIDERS: ReadonlySet<MailProvider> = new Set([
  "google",
  "microsoft",
  "zoho",
  "proofpoint",
  "mimecast",
  "other",
]);

// MX hosts that mean "this domain is parked / for sale / only forwarding",
// not "a company reads mail here". These are the one class of live-MX domain
// worth rejecting outright, since they are precisely the squatted names a
// generated candidate is most likely to hit.
const PARKING_MX_HOSTS = [
  "parkingcrew.net",
  "sedoparking.com",
  "bodis.com",
  "above.com",
  "dan.com",
  "afternic.com",
  "hugedomains.com",
  "domaincontrol.email",
];

function isParkedMx(mxHosts: string[]): boolean {
  return mxHosts.some((host) => {
    const h = host.trim().toLowerCase().replace(/\.$/, "");
    return PARKING_MX_HOSTS.some((root) => h === root || h.endsWith(`.${root}`));
  });
}

// Company names that carry no real corporate identity to guess a domain
// for — LinkedIn "company" free text is full of these for self-employed /
// unemployed contacts. Normalized the same way as a real candidate name so
// "Freelance", "freelance", "FREELANCE " etc. all match.
const STOP_LIST = new Set(
  [
    "independiente",
    "profesional independiente",
    "freelance",
    "autonomo",
    "self employed",
    "none",
  ].map(normalizeForDomain),
);

/**
 * Break a company display name into ascii-lowercase word tokens: normalize
 * accents away, drop punctuation, remove common legal-entity suffixes
 * (matched as whole words, sharing COMPANY_SUFFIX_RE with
 * src/lib/companyCategories.ts#normalizeCompanyKey), then split on
 * whatever's left. Kept as TOKENS (not immediately collapsed to one string)
 * because buildNameVariants needs to inspect and drop individual leading/
 * trailing words — "Banco Macro S.A." -> ["banco", "macro"].
 */
function tokenizeCompanyName(name: string): string[] {
  const ascii = name
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex -- intentionally ASCII-only, mirrors normalizeCompanyKey
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
  const noPunct = ascii.replace(/[.,]/g, " ");
  const noSuffix = noPunct.replace(COMPANY_SUFFIX_RE, " ");
  return noSuffix.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Collapse tokens into the bare string a domain candidate is built from. */
function normalizeForDomain(name: string): string {
  return tokenizeCompanyName(name).join("");
}

// Country/region words that show up as a trailing or leading qualifier on a
// LinkedIn "company" field but are NOT part of the actual registered
// domain — e.g. "Opinno Ecuador" is the Ecuador office of Opinno, and the
// real domain is opinno.com, not opinnoecuador.com (which is NXDOMAIN).
// Single-word entries only; multi-word regions are handled separately below.
const COUNTRY_WORDS = [
  "argentina",
  "chile",
  "colombia",
  "peru",
  "mexico",
  "brasil",
  "brazil",
  "uruguay",
  "paraguay",
  "bolivia",
  "venezuela",
  "panama",
  "guatemala",
  "ecuador",
  "espana",
  "spain",
  "usa",
  "latam",
  "latinoamerica",
];

// Multi-word region qualifiers, checked as a whole token sequence (leading
// or trailing) before the single-word list above.
const MULTI_WORD_REGIONS: string[][] = [
  ["costa", "rica"],
  ["republica", "dominicana"],
  ["america", "latina"],
  ["cono", "sur"],
];

// Generic business words that, when LEADING a company name, describe its
// legal form/vertical rather than its brand — e.g. "Banco Pichincha" is
// commonly reachable at pichincha.com (the brand alone), not just
// bancopichincha.*. Deliberately short and LEADING-only: stripping a
// trailing generic word, or a word from the middle, risks turning a
// distinctive name into an unrelated generic stub (see the length guard in
// buildNameVariants, which refuses to strip down to nothing).
const GENERIC_LEADING_WORDS = [
  "banco",
  "grupo",
  "group",
  "holding",
  "compania",
  "empresa",
  "consultora",
  "consulting",
  "corporacion",
  "fundacion",
  "estudio",
  "agencia",
];

function tokensEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tok, i) => tok === b[i]);
}

/**
 * Drop a leading or trailing country/region qualifier from `tokens`, if
 * present. Multi-word regions are checked first (so "america latina" isn't
 * partially matched as just "latina"), trailing before leading since a
 * trailing qualifier ("Opinno Ecuador") is the more common LinkedIn pattern.
 * Returns null when no country/region word is found, so the caller can tell
 * "nothing to strip" apart from "stripped down to nothing".
 */
function stripCountryWord(tokens: string[]): string[] | null {
  if (tokens.length < 2) return null;

  for (const phrase of MULTI_WORD_REGIONS) {
    if (tokens.length > phrase.length && tokensEqual(tokens.slice(-phrase.length), phrase)) {
      return tokens.slice(0, -phrase.length);
    }
    if (tokens.length > phrase.length && tokensEqual(tokens.slice(0, phrase.length), phrase)) {
      return tokens.slice(phrase.length);
    }
  }

  const last = tokens[tokens.length - 1];
  if (COUNTRY_WORDS.includes(last)) return tokens.slice(0, -1);

  const first = tokens[0];
  if (COUNTRY_WORDS.includes(first)) return tokens.slice(1);

  return null;
}

/**
 * Drop a single LEADING generic business word from `tokens`, if present and
 * at least one distinctive word remains. Returns null when there's no
 * generic leading word, or when removing it would leave nothing (guards
 * against a name that IS just "Grupo" or "Estudio" with nothing else).
 */
function stripGenericLeadingWord(tokens: string[]): string[] | null {
  if (tokens.length < 2) return null;
  if (!GENERIC_LEADING_WORDS.includes(tokens[0])) return null;
  return tokens.slice(1);
}

function isUsableBase(base: string): boolean {
  // Same guard the single-variant version always applied: too short to be a
  // plausible business name, or a known generic/non-company placeholder.
  return base.length >= 3 && !STOP_LIST.has(base);
}

/**
 * Build the ordered list of domain-name bases to try for `companyName`,
 * most specific first, deduplicated:
 *   a) the full normalized name (current/previous behavior) — always tried
 *      first, since a more specific base that resolves is less likely to be
 *      an unrelated homonym than a shorter, more generic one.
 *   b) the name minus a leading/trailing country or region word — fixes
 *      "Opinno Ecuador", where the country word is part of the LinkedIn
 *      free-text company field, not the registered domain (opinno.com).
 *   c) the name minus a leading generic business word, when a distinctive
 *      word remains — fixes "Banco Pichincha", reachable at pichincha.com
 *      as well as under its full name.
 * Each candidate base must independently pass the length/STOP_LIST guard
 * (isUsableBase) to be included.
 */
function buildNameVariants(companyName: string): string[] {
  const tokens = tokenizeCompanyName(companyName);
  const bases: string[] = [];

  const full = tokens.join("");
  if (isUsableBase(full)) bases.push(full);

  const minusCountry = stripCountryWord(tokens);
  if (minusCountry) {
    const base = minusCountry.join("");
    if (isUsableBase(base)) bases.push(base);
  }

  const minusGeneric = stripGenericLeadingWord(tokens);
  if (minusGeneric) {
    const base = minusGeneric.join("");
    if (isUsableBase(base)) bases.push(base);
  }

  return [...new Set(bases)];
}

export interface GuessedDomain {
  domain: string;
  provider: MailProvider;
}

/**
 * Try to discover a company's mail domain purely from its display name,
 * validated by DNS. Returns null when the name is too short/generic to
 * bother with, or when none of the candidate domains resolve to a real,
 * currently-configured mail provider within the lookup budget.
 *
 * Resolution is SEQUENTIAL with an early exit on the first accepted
 * candidate — this both minimizes DNS round trips for the common case (a
 * hit on the first try) and enforces MAX_LOOKUPS as a hard cap on how many
 * LIVE lookups one call can ever issue (cache hits are free — see the
 * `fromCache` check below), so a contact-detail page render can never fan
 * out unboundedly. LOOKUP_BUDGET_MS bounds the time those live lookups may
 * take, which MAX_LOOKUPS on its own does not.
 *
 * Candidates are variant-major, TLD-minor: every CANDIDATE_TLDS entry for
 * the most specific name variant (buildNameVariants' `a`) is tried before
 * moving on to the next variant. This is what makes "most specific wins"
 * actually true rather than just an ordering intent — e.g. for "Banco
 * Pichincha", bancopichincha.com.ec (variant a, a LATAM TLD) is tried before
 * pichincha.com (variant c) ever comes up, even though pichincha.com sits
 * earlier in CANDIDATE_TLDS than .com.ec does relative to variant a's own
 * list — because it belongs to a later, less specific variant.
 */
export async function guessCompanyDomain(companyName: string | null): Promise<GuessedDomain | null> {
  if (!companyName) return null;

  const variants = buildNameVariants(companyName);
  if (variants.length === 0) return null;

  const candidates: string[] = [];
  for (const variant of variants) {
    for (const tld of CANDIDATE_TLDS) {
      candidates.push(`${variant}${tld}`);
    }
  }
  const capped = candidates.slice(0, MAX_CANDIDATES);

  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  let lookupsUsed = 0;
  for (const candidate of capped) {
    if (lookupsUsed >= MAX_LOOKUPS || Date.now() >= deadline) break;

    // Goes through the same cached lookup path as the rest of the app (see
    // src/lib/domainCheckCache.ts) so repeated guesses for the same
    // candidate domain don't re-issue DNS queries within the 30-day cache
    // window. Only a LIVE DNS round trip counts against MAX_LOOKUPS/the
    // budget — a cache hit is a local DB read, so a warm company still gets
    // to try every candidate regardless of how many that is.
    const check = await getDomainCheck(candidate);
    if (!check.fromCache) lookupsUsed += 1;

    if (isDeadDomain(check.status)) continue; // confirmed parked/nonexistent
    if (check.status !== "ok" || !check.hasMx) continue; // unconfirmed (error) — not good enough to guess on
    if (isFreeMailDomain(candidate)) continue; // can't happen for a generated domain in practice, but stay consistent with every other domain check in the app
    if (!ACCEPTED_PROVIDERS.has(check.provider)) continue; // rejects "unknown" — see module doc comment
    if (isParkedMx(check.mxHosts)) continue; // domain is parked or for sale, nobody reads mail there

    return { domain: candidate, provider: check.provider };
  }

  return null;
}
