/**
 * Who a Contact is, for COMPLIANCE: which postal address the footer carries and which language the draft is written in.
 * Pure, no I/O. Replaces `MarketKey` as the input to those two decisions (it keeps its hiring meaning on job_posting.market).
 *
 * Owner rules, decided 2026-10-20:
 *   - address:  Argentina -> Mar del Plata ("mdp"). Every other LOCATED country -> Miami.
 *   - language: a Spanish-speaking country -> "es". Everything else -> "en". Brazil is "en" ON PURPOSE (owner chose English
 *               over Portuguese), so this module never emits "pt".
 *   - hold:     no location signal at all -> `null`, as today.
 *
 * THE INVARIANT THAT INVERTED. This module replaced `recipientMarket`, whose result `other` meant "no footer: hold, never
 * send". Under that rule a LOCATED contact in Spain, Ireland or Italy was held. Under this one it is MAILABLE with the Miami
 * address (Spanish for Spain). What holds now is only a contact that cannot be LOCATED (no signal, or text that is not
 * exactly a country) or sits in an embargoed jurisdiction (Cuba, Iran, North Korea, Syria). Anything that still reads
 * "unmapped market = no postal address for the region" is describing the old rule, and is wrong. The old resolver and its
 * market-keyed helpers were deleted rather than kept alongside: a second, unused resolver is how the footer-writing path and
 * the admission path drift apart.
 *
 * The input chain, in order: person country, the ROSTER's consensus (what the company's other contacts say), company country,
 * the open postings' markets, the phone's dial code. A link "has data" when non-empty, and a present but unrecognized country
 * DECIDES (hold); it does not fall through to a weaker link. Two links are conditional, both added 2026-10-27:
 *   - roster consensus: a strict majority (> 50%) of the OTHER live contacts at the company that have a recognized country,
 *     with at least 2 of them. `company.country` describes one filing, not where a multinational's people sit (Globant was
 *     filed "United States" with an all-Argentine roster); measured leave-one-out, the company country predicts the draft
 *     language 85.2% of the time and the roster majority 97.8%. A sanctioned majority HOLDS like any sanctioned country.
 *   - company country: with no majority (a split roster, or fewer than 2 recognized colleagues) it is still used when filed,
 *     even if some colleague contradicts it (owner decision 2026-10-27: a thin or split roster must not revoke a usable
 *     country and hold the contact); `colleaguesDisagree` tells the screen the colleagues do not back it. Only with no
 *     company country at all does a split roster fall through to postings, phone and HOLD. An EMBARGOED company country is
 *     the exception: no majority overrides it, it holds exactly as it did before the roster existed (fail closed).
 *
 * Free text -> country. `person.country` / `company.country` are free text and `classifyMarket` is a lossy substring matcher
 * (it files "New Mexico" under latam). It must not be reused here. `resolveCountry` matches the WHOLE normalized string
 * against the names of EVERY ISO region (Intl.DisplayNames, English and Spanish, plus a short alias list), the same discipline
 * as `isKnownCountryName`: "Greater Buenos Aires" and "Miami, FL" are not countries. Text that is not exactly a country
 * holds (fail closed). Recognition is complete on purpose: the owner's rule is "every other LOCATED country", so there is
 * no list of the world to maintain. Only the policy sets below (sanctioned, Spanish-speaking) are written by hand.
 */
import { isMarketKey, type MarketKey } from "@/lib/hiring/markets";
import type { MessageLanguage } from "@/lib/outreach/messageLanguage";
import { phoneCountryIso } from "./phoneMarket";

/**
 * The inputs of the audience, shared by every caller (picker, add guard, draft, release, unsubscribe page). The two phone
 * fields are REQUIRED (null when the person has none): an optional field would let one caller skip the phone and disagree
 * with the others about who is mailable. Required, the compiler lists every caller.
 */
export interface ComplianceAudienceInputs {
  readonly mobilePhone: string | null;
  readonly phone: string | null;
  readonly personCountry?: string | null;
  readonly companyCountry?: string | null;
  /** job_posting.market of the company's open IT postings; null where the backfill has not run. */
  readonly postingMarkets?: readonly (string | null)[] | null;
  /**
   * The countries filed on the OTHER live contacts of the person's company, grouped by filed text (`rosterCountriesSql`).
   * REQUIRED, like the phones: an optional field would let one caller skip the roster and disagree with the others about who is
   * mailable and at which address. Pass `[]` only when there is genuinely no company to ask (a person-country-only question).
   * The contact itself is never in it where it matters: the roster is read only when the person has no country of their own.
   */
  readonly rosterCountries: readonly ColleagueCountry[];
}

/** Colleagues of the same company that have a country of their own, grouped by the text filed (as the read returns them). */
export interface ColleagueCountry { readonly country: string; readonly n: number }

/** The posting bucket, only when the open postings agree on exactly one of `us` / `latam`; `other` otherwise (no signal). */
export function fromPostings(markets: readonly (string | null)[] | null | undefined): MarketKey {
  const known = new Set<MarketKey>();
  for (const m of markets ?? []) {
    if (isMarketKey(m) && m !== "other") known.add(m);
  }
  return known.size === 1 ? [...known][0] : "other";
}

export type ComplianceAddress = "mdp" | "miami";
/** The languages a compliance audience can resolve to. A subset of MessageLanguage: "pt" is never emitted here. */
export type AudienceLanguage = Extract<MessageLanguage, "es" | "en">;
export interface ComplianceAudience {
  readonly address: ComplianceAddress;
  readonly language: AudienceLanguage;
}

/**
 * Comprehensively US-embargoed jurisdictions. These HOLD instead of receiving the Miami address.
 * Why: the footer is a US corporate entity's postal address, the owner has not decided how to treat sanctioned
 * jurisdictions (a US-entity footer on mail to Cuba raises an OFAC question nobody has answered), and holding is the
 * reversible choice: a held contact can be released later, a sent email cannot be recalled. Deliberately small and
 * named. To change the posture, edit this set; the tests iterate it. Do not grow it into a sanctions regime.
 */
export const SANCTIONED_COUNTRIES: ReadonlySet<string> = new Set(["CU", "IR", "KP", "SY"]);

/** Countries where Spanish is an official language (ISO 3166-1 alpha-2). Brazil is NOT in it: owner decision, English. */
export const SPANISH_SPEAKING_COUNTRIES: ReadonlySet<string> = new Set([
  "AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GQ", "GT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "ES", "UY", "VE",
]);

// The country table and `resolveCountry` live in countryNames.ts so a client component can reach them without
// pulling in the phone parser this module also uses. Re-exported here: every existing importer keeps working.
export { RECOGNIZED_COUNTRIES, AMBIGUOUS_NAMES, resolveCountry, type CountryEntry } from "./countryNames";
import { resolveCountry } from "./countryNames";


function audienceOfCountry(iso: string): ComplianceAudience | null {
  if (SANCTIONED_COUNTRIES.has(iso)) return null;
  if (iso === "AR") return { address: "mdp", language: "es" };
  return { address: "miami", language: SPANISH_SPEAKING_COUNTRIES.has(iso) ? "es" : "en" };
}

/**
 * The one place where address AND language come from a region bucket instead of a country. `job_posting.market` is only
 * latam|us|other, so a bucket cannot tell Argentina from Mexico or Brazil:
 *   - latam -> Miami, because Argentina is unprovable from a bucket; Spanish, because that is what these contacts receive
 *     today, and this change must not alter their language.
 *   - us    -> Miami, English (today's behaviour exactly).
 * The bucket itself is read by `fromPostings` above, the one reader of job_posting.market for compliance, so the footer
 * path and the admission path cannot read the postings under two rules.
 */
function fromPostingBucket(markets: readonly (string | null)[] | null | undefined): ComplianceAudience | null {
  const bucket = fromPostings(markets);
  if (bucket === "latam") return { address: "miami", language: "es" };
  if (bucket === "us") return { address: "miami", language: "en" };
  return null;
}

/**
 * `null` is HOLD: no location signal, text that is not a country, a sanctioned jurisdiction, or a jurisdiction that cannot
 * be established. Every link fails CLOSED. The phone link takes the ISO straight from libphonenumber and never round-trips
 * through a display name, so a missing or stripped ICU cannot change what a phone means. When no ISO can be established
 * the contact is NOT mailed: a compliance check that cannot tell where a recipient is must refuse, not pick the US address
 * and hope. Holding is reversible; a sent email to an embargoed or wrong-language recipient is not.
 *
 * The country table (ICU names) is only read for free text. If ICU is stripped, free text holds and phones still resolve;
 * no load-time throw: a throw would take down every page importing this module on an ICU quirk, while holding is safe
 * and the stripped-ICU test pins that it holds.
 */
export function resolveComplianceAudience(input: ComplianceAudienceInputs): ComplianceAudience | null {
  return explainComplianceAudience(input).audience;
}

/** Which link of the chain decided. */
export type AudienceReason = "person_country" | "roster_consensus" | "company_country" | "posting_markets" | "phone";

export interface ComplianceAudienceExplained {
  readonly audience: ComplianceAudience | null;
  /** Which link DECIDED. Non-null even when `audience` is null: a link can decide to HOLD (unrecognised text, sanctioned). */
  readonly reason: AudienceReason | null;
  /** The raw value that link read, for the UI to quote back ("United States", "+54 223..."). Null when nothing decided. */
  readonly evidence: string | null;
  /** Only with `roster_consensus`: how many recognized colleagues hold the winning country (`evidence` is its ISO), out of how many are recognized. */
  readonly colleagues?: { readonly agree: number; readonly of: number };
  /**
   * Only when true, and only without a strict majority: some recognized colleague has a different country than the company
   * (the company country still decided), or the recognized colleagues split among themselves with no company country (postings,
   * phone or nobody decided).
   */
  readonly colleaguesDisagree?: true;
}

interface RosterTally {
  /** Colleagues per resolved ISO; texts that are not a country are dropped, they are neither for nor against. */
  readonly byIso: ReadonlyMap<string, number>;
  readonly total: number;
}

function tallyRoster(roster: readonly ColleagueCountry[]): RosterTally {
  const byIso = new Map<string, number>();
  let total = 0;
  for (const { country, n } of roster) {
    const iso = resolveCountry(country);
    if (!iso || !Number.isFinite(n) || n <= 0) continue;
    byIso.set(iso, (byIso.get(iso) ?? 0) + n);
    total += n;
  }
  return { byIso, total };
}

/** The recognized colleagues grouped by country, biggest first (ties by ISO): what the card quotes when the roster is split. */
export function rosterBreakdown(roster: readonly ColleagueCountry[]): { iso: string; n: number }[] {
  return [...tallyRoster(roster).byIso].map(([iso, n]) => ({ iso, n })).sort((x, y) => y.n - x.n || x.iso.localeCompare(y.iso));
}

/** Fewest recognized colleagues that can make a consensus. One colleague is an anecdote, and a company filed by one person is not a roster. */
export const ROSTER_MIN_COLLEAGUES = 2;
/** The country held by MORE than half of at least `ROSTER_MIN_COLLEAGUES` recognized colleagues, or null. */
function rosterMajority({ byIso, total }: RosterTally): { iso: string; agree: number } | null {
  if (total < ROSTER_MIN_COLLEAGUES) return null;
  for (const [iso, agree] of byIso) if (agree * 2 > total) return { iso, agree };
  return null;
}

/**
 * THE chain, the only copy: `resolveComplianceAudience` delegates here, so the answer the screen explains and the answer
 * the draft uses cannot diverge (tests/unit/sequencesAudienceExplain.test.ts compares the two over a table). A link that
 * has data decides, even to hold. When no link had any data, audience and reason are both null.
 */
export function explainComplianceAudience(input: ComplianceAudienceInputs): ComplianceAudienceExplained {
  const person = input.personCountry?.trim();
  if (person) return { audience: audienceOfIso(resolveCountry(person)), reason: "person_country", evidence: person };
  const tally = tallyRoster(input.rosterCountries);
  const company = input.companyCountry?.trim();
  const companyIso = company ? resolveCountry(company) : null;
  const dissent = companyIso !== null && [...tally.byIso.keys()].some((iso) => iso !== companyIso);
  const companyDecision = (): ComplianceAudienceExplained =>
    ({ audience: audienceOfIso(companyIso), reason: "company_country", evidence: company!, ...(dissent ? { colleaguesDisagree: true as const } : {}) });
  // An embargoed company country is never overridden: fail closed, exactly as before the roster existed. (A sanctioned
  // MAJORITY below still holds, and an unrecognized company text may yield to a majority.)
  if (companyIso !== null && SANCTIONED_COUNTRIES.has(companyIso)) return companyDecision();
  const majority = rosterMajority(tally);
  if (majority) {
    return { audience: audienceOfCountry(majority.iso), reason: "roster_consensus", evidence: majority.iso, colleagues: { agree: majority.agree, of: tally.total } };
  }
  // No majority. A filed company country decides, as it always did, whoever dissents; the dissent is only reported. Unrecognized
  // text cannot be compared with anyone, so it keeps deciding (and holding).
  if (company) return companyDecision();
  // No company country: a roster that splits (two or more recognized colleagues, no majority) is worth telling the screen about.
  const flag = tally.total >= ROSTER_MIN_COLLEAGUES ? { colleaguesDisagree: true as const } : {};
  const posted = fromPostingBucket(input.postingMarkets);
  if (posted) return { audience: posted, reason: "posting_markets", evidence: fromPostings(input.postingMarkets), ...flag };
  const iso = phoneCountryIso(input.mobilePhone, input.phone);
  if (!iso) return { audience: null, reason: null, evidence: null, ...flag };
  // The raw number that placed the country: the first of mobile, phone that places one on its own (same order as phoneCountryIso).
  const raw = [input.mobilePhone, input.phone].find((n) => phoneCountryIso(n, null) !== null)?.trim() ?? null;
  return { audience: audienceOfCountry(iso), reason: "phone", evidence: raw, ...flag };
}

function audienceOfIso(iso: string | null): ComplianceAudience | null {
  return iso ? audienceOfCountry(iso) : null;
}
