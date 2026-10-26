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
 * The input chain, in order: person country, company country, the open postings' markets, the phone's dial code. A link
 * "has data" when non-empty, and a present but unrecognized country DECIDES (hold); it does not fall through to a weaker link.
 *
 * Free text -> country. `person.country` / `company.country` are free text and `classifyMarket` is a lossy substring matcher
 * (it files "New Mexico" under latam). It must not be reused here. `resolveCountry` matches the WHOLE normalized string
 * against the names of EVERY ISO region (Intl.DisplayNames, English and Spanish, plus a short alias list), the same discipline
 * as `isKnownCountryName`: "Greater Buenos Aires" and "Miami, FL" are not countries. Text that is not exactly a country
 * holds (fail closed). Recognition is complete on purpose: the owner's rule is "every other LOCATED country", so there is
 * no list of the world to maintain. Only the policy sets below (sanctioned, Spanish-speaking) are written by hand.
 */
import { isMarketKey, normalizeText, type MarketKey } from "@/lib/hiring/markets";
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
}

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

interface CountryEntry {
  readonly iso: string;
  /** Normalized names that resolve to this country (ICU English + Spanish names, plus ALIASES). */
  readonly names: readonly string[];
}

/**
 * Codes ICU can name that are not a country: deprecated or reserved codes that duplicate a live country (AN, BU, CS, DD,
 * DY, FX, HV, NH, RH, SU, TP, UK, VD, YD, YU, ZR; found by listing every name two codes share), grouping codes (EU, UN,
 * EZ, QO) and sub-territory or testing codes (AC, CP, DG, EA, IC, TA, XA, XB, ZZ). A closed, stable list. XK (Kosovo) is
 * user-assigned but a real located country, so it stays. AC and TA are dialable (libphonenumber) but not recognized by
 * name; their phones still resolve through the located-country fallback below.
 */
const NOT_A_COUNTRY: ReadonlySet<string> = new Set([
  "AC", "AN", "BU", "CP", "CS", "DD", "DG", "DY", "EA", "EU", "EZ", "FX", "HV", "IC", "NH", "QO", "RH", "SU", "TA", "TP", "UK", "UN", "VD", "XA", "XB", "YD", "YU", "ZR", "ZZ",
]);

/*
 * No exclusion for names that are also a US state ("Georgia", GE; "Jersey", JE). phoneMarket.ts withholds GE because under
 * latam|us|other "georgia" was a US phrase and a market meant an address AND a language, so the two readings differed.
 * Here both readings give the same audience ({ miami, en }: located, not Argentina, not Spanish-speaking, not sanctioned),
 * so withholding the name would only HOLD a contact whose every correct answer agrees. Do not restore it. The test
 * "a name shared with a US state is harmless" derives that safety: it fails if a colliding country ever gets a different
 * audience than the United States.
 * The limit of that guard: the "all collisions agree" reasoning is DERIVED only for US state names. A city whose name is
 * also a country resolves to the country ("Granada" is Grenada in ICU's Spanish, "Santa Lucía" is Saint Lucia), which
 * can give a Spanish or Nicaraguan contact English on bad input. That is pinned in the tests, not excluded by a city list.
 */

/**
 * Spellings ICU does not produce that this data really contains (the first group is what sendSchedule/zones.ts, a private
 * const and so mirrored, already accepts). It is a supplement: every ISO region is recognized by its ICU name without it.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  US: ["usa", "us", "u s", "u s a", "united states of america", "ee uu", "eeuu"],
  GB: ["uk", "u k", "great britain", "england", "scotland", "wales", "inglaterra"],
  NL: ["the netherlands", "holland", "holanda"],
  DO: ["rep dominicana"],
  // ISO 3166-1 long forms, added one at a time as the data produces them. Other long forms ("Korea, Republic of",
  // "Tanzania, United Republic of") hold until listed here; for a SANCTIONED one ("Iran, Islamic Republic of") holding is
  // already the correct answer, so that direction fails safe. Do NOT replace this with a rule that matches the text
  // before the comma: ICU names KR "South Korea" and KP "North Korea", so the prefix of "Korea, Republic of" is not a
  // country name at all and would resolve to nothing — and an alias added to rescue it could not say which Korea it
  // meant. It would also turn every "City, Country" string into a country guess.
  // BO added 2026-10-20, when it was the only long form in the data and the only text the old `classifyMarket` admitted
  // (by substring) that this resolver refused. Re-measured 2026-10-26: that is no longer true — company.country also
  // holds "Venezuela, Bolivarian Republic of" (5 contacts at one company). No contact LOST its audience to it, because
  // their person.country covered them, so this was a latent gap rather than a live hold. Adding VE decides no policy:
  // the plain "Venezuela" already resolves and already yields the same audience, so this only closes a spelling gap.
  BO: ["bolivia plurinational state of"],
  VE: ["venezuela bolivarian republic of"],
  MX: ["estados unidos mexicanos"],
  AE: ["uae"],
  TR: ["turkey"],
  CZ: ["czech republic"],
  MM: ["myanmar", "burma"],
  HK: ["hong kong"],
  MO: ["macau", "macao"],
  CI: ["ivory coast"],
  SZ: ["swaziland"],
  PS: ["palestine"],
  CD: ["dr congo"],
};

/**
 * "&" reads as "and" ("Bosnia & Herzegovina" is ICU's spelling, "Bosnia and Herzegovina" is what people type). Otherwise
 * mirrors markets.ts `isKnownCountryName`: normalize, then punctuation and runs of space collapse to one space.
 */
function normalizeCountryText(text: string): string {
  return normalizeText(text.replace(/&/g, " and ")).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Every ISO 3166-1 region ICU can name, as { iso, names }. Built from Intl.DisplayNames, so the names depend on the
 * runtime's ICU build. With `fallback: "none"` an unknown code gives undefined, and a name that is just the code (a
 * stripped ICU) is skipped, so a region never becomes a false match on its own code ("us", "de" are not countries here;
 * "us" resolves only through ALIASES). With no ICU data at all the table degrades to the ALIASES and the contact holds.
 */
function buildCountries(): { countries: CountryEntry[]; ambiguous: Set<string> } {
  const displayNames = ["en", "es"].map((locale) => new Intl.DisplayNames([locale], { type: "region", fallback: "none" }));
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const byIso = new Map<string, Set<string>>();
  for (const a of A) {
    for (const b of A) {
      const iso = a + b;
      if (NOT_A_COUNTRY.has(iso)) continue;
      const names = new Set<string>();
      for (const dn of displayNames) {
        const name = dn.of(iso);
        if (name && name.toUpperCase() !== iso) names.add(normalizeCountryText(name));
      }
      if (names.size > 0) byIso.set(iso, names);
    }
  }
  for (const [iso, aliases] of Object.entries(ALIASES)) {
    const names = byIso.get(iso) ?? new Set<string>();
    for (const alias of aliases) names.add(normalizeCountryText(alias));
    byIso.set(iso, names);
  }
  const owner = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [iso, names] of byIso) {
    for (const name of names) {
      if (owner.has(name) && owner.get(name) !== iso) ambiguous.add(name);
      else owner.set(name, iso);
    }
  }
  const countries = [...byIso].map(([iso, names]) => ({ iso, names: [...names].filter((n) => !ambiguous.has(n)) }));
  return { countries, ambiguous };
}

const BUILT = buildCountries();

/** Every ISO region (plus Kosovo), with the names that resolve to it. */
export const RECOGNIZED_COUNTRIES: readonly CountryEntry[] = BUILT.countries;
/** Names two different countries share. Empty by measurement; a name here resolves to nothing (hold) rather than guessing. */
export const AMBIGUOUS_NAMES: ReadonlySet<string> = BUILT.ambiguous;

const ISO_BY_NAME: ReadonlyMap<string, string> = new Map(
  RECOGNIZED_COUNTRIES.flatMap(({ iso, names }) => names.map((name) => [name, iso] as const)),
);

/** The ISO code of a free-text country, matching the WHOLE string against known names; null when it is not exactly one. */
export function resolveCountry(text: string | null | undefined): string | null {
  if (!text) return null;
  return ISO_BY_NAME.get(normalizeCountryText(text)) ?? null;
}

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
export type AudienceReason = "person_country" | "company_country" | "posting_markets" | "phone";

export interface ComplianceAudienceExplained {
  readonly audience: ComplianceAudience | null;
  /** Which link DECIDED. Non-null even when `audience` is null: a link can decide to HOLD (unrecognised text, sanctioned). */
  readonly reason: AudienceReason | null;
  /** The raw value that link read, for the UI to quote back ("United States", "+54 223..."). Null when nothing decided. */
  readonly evidence: string | null;
}

/**
 * THE chain, the only copy: `resolveComplianceAudience` delegates here, so the answer the screen explains and the answer
 * the draft uses cannot diverge (tests/unit/sequencesAudienceExplain.test.ts compares the two over a table). A link that
 * has data decides, even to hold. When no link had any data, audience and reason are both null.
 */
export function explainComplianceAudience(input: ComplianceAudienceInputs): ComplianceAudienceExplained {
  const person = input.personCountry?.trim();
  if (person) return { audience: audienceOfIso(resolveCountry(person)), reason: "person_country", evidence: person };
  const company = input.companyCountry?.trim();
  if (company) return { audience: audienceOfIso(resolveCountry(company)), reason: "company_country", evidence: company };
  const posted = fromPostingBucket(input.postingMarkets);
  if (posted) return { audience: posted, reason: "posting_markets", evidence: fromPostings(input.postingMarkets) };
  const iso = phoneCountryIso(input.mobilePhone, input.phone);
  if (!iso) return { audience: null, reason: null, evidence: null };
  // The raw number that placed the country: the first of mobile, phone that places one on its own (same order as phoneCountryIso).
  const raw = [input.mobilePhone, input.phone].find((n) => phoneCountryIso(n, null) !== null)?.trim() ?? null;
  return { audience: audienceOfCountry(iso), reason: "phone", evidence: raw };
}

function audienceOfIso(iso: string | null): ComplianceAudience | null {
  return iso ? audienceOfCountry(iso) : null;
}
