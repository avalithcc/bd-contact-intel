/**
 * Recognising a free-text country name: the ISO table and `resolveCountry`, extracted out of complianceAudience.ts.
 *
 * It lives apart because that module also reads a phone's dial code, which pulls in libphonenumber-js, and the repo
 * forbids a `"use client"` file from reaching it (tests/unit guards this). The country picker on a sequence card needs
 * the SAME table the resolver matches against — offering an option the resolver would not understand is what makes a
 * dropdown dangerous rather than safe — so the table had to be reachable without the phone parser.
 *
 * Nothing here is new behaviour; it is the same code, moved. `complianceAudience.ts` re-exports it so existing
 * importers are untouched.
 */
import { normalizeText } from "@/lib/hiring/markets";

export interface CountryEntry {
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
