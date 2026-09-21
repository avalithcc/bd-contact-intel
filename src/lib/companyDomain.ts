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
 * record — nothing is configured to receive mail for it. Requiring MX
 * (plus a real, named mail provider — see ACCEPTED_PROVIDERS below) is what
 * makes this filter meaningful: it rejects the vast majority of wrong
 * guesses (typos, unrelated registrants, generic placeholder domains)
 * before they ever reach the UI as a suggestion.
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
import { isDeadDomain, getDomainCheck, type MailProvider } from "@/lib/domainCheckCache";

// TLDs to try, ordered by likelihood for this (LATAM-heavy) user base —
// generic/global TLDs first, then the local Argentine ones, then the rest
// of the region and a few common tech-company TLDs.
const CANDIDATE_TLDS = [
  ".com",
  ".com.ar",
  ".ar",
  ".io",
  ".net",
  ".co",
  ".es",
  ".com.br",
  ".com.mx",
  ".app",
  ".dev",
];

// Hard cap on how many (name, tld) candidates we'll even construct. Keeps
// the candidate list bounded regardless of CANDIDATE_TLDS growing later.
const MAX_CANDIDATES = 12;

// Hard cap on how many LIVE DNS lookups a single guessCompanyDomain() call
// may issue. Resolution is sequential with an early exit on the first
// accepted candidate (see below), so this is also the worst-case number of
// round trips added to one contact-detail page render.
const MAX_LOOKUPS = 6;

// Wall-clock budget for the whole guess. MAX_LOOKUPS alone bounds the number
// of queries, not the time they take: six candidates that each hit the 3s DNS
// timeout would stall a contact-detail render for ~18s. Once this budget is
// spent the guess gives up and the page renders without a suggestion —
// a missing guess is cheap, a page that hangs is not. Cached candidates cost
// a local DB read, so a warm company still gets through every candidate.
const LOOKUP_BUDGET_MS = 2500;

// Only these MX-detected providers (see src/lib/emailDomain.ts) count as
// "a real mail provider is configured here". Deliberately EXCLUDES
// "unknown" (MX records present but not matching any known provider is too
// weak a signal to build a guess on) — see the module doc comment above for
// why MX + a real provider, not MX alone, is the acceptance bar.
const ACCEPTED_PROVIDERS: ReadonlySet<MailProvider> = new Set([
  "google",
  "microsoft",
  "zoho",
  "proofpoint",
  "mimecast",
  "other",
]);

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
 * Strip a company display name down to the bare ascii-lowercase
 * letters/digits used to build a domain candidate: normalize accents away,
 * drop punctuation, remove common legal-entity suffixes (matched as whole
 * words, same approach as src/lib/companyCategories.ts#normalizeCompanyKey),
 * then collapse everything else (remaining spaces/punctuation) so "Banco
 * Macro S.A." -> "bancomacro".
 */
function normalizeForDomain(name: string): string {
  const ascii = name
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex -- intentionally ASCII-only, mirrors normalizeCompanyKey
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
  const noPunct = ascii.replace(/[.,]/g, " ");
  const noSuffix = noPunct.replace(/\b(s ?a|s ?r ?l|inc|llc|ltd|corp)\b/g, " ");
  return noSuffix.replace(/[^a-z0-9]/g, "");
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
 * live lookups one call can ever issue, so a contact-detail page render can
 * never fan out unboundedly. LOOKUP_BUDGET_MS bounds the time those lookups
 * may take, which MAX_LOOKUPS on its own does not.
 */
export async function guessCompanyDomain(companyName: string | null): Promise<GuessedDomain | null> {
  if (!companyName) return null;

  const base = normalizeForDomain(companyName);
  // Too short to be a plausible business name (e.g. stray initials), or
  // normalizes to a known generic/non-company placeholder.
  if (base.length < 3 || STOP_LIST.has(base)) return null;

  const candidates = CANDIDATE_TLDS.map((tld) => `${base}${tld}`).slice(0, MAX_CANDIDATES);

  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  let lookupsUsed = 0;
  for (const candidate of candidates) {
    if (lookupsUsed >= MAX_LOOKUPS || Date.now() >= deadline) break;
    lookupsUsed += 1;

    // Goes through the same cached lookup path as the rest of the app (see
    // src/lib/domainCheckCache.ts) so repeated guesses for the same
    // candidate domain don't re-issue DNS queries within the 30-day cache
    // window.
    const check = await getDomainCheck(candidate);

    if (isDeadDomain(check.status)) continue; // confirmed parked/nonexistent
    if (check.status !== "ok" || !check.hasMx) continue; // unconfirmed (error) — not good enough to guess on
    if (isFreeMailDomain(candidate)) continue; // can't happen for a generated domain in practice, but stay consistent with every other domain check in the app
    if (!ACCEPTED_PROVIDERS.has(check.provider)) continue; // rejects "unknown" — see module doc comment

    return { domain: candidate, provider: check.provider };
  }

  return null;
}
