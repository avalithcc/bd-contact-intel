/**
 * Company → industry category classification.
 *
 * Unlike role groups (deterministic keyword rules), the company→category
 * mapping is a lookup table derived offline from a BD's private LinkedIn
 * network (see scripts/seed-company-categories.ts) and stored in the
 * `company_category` DB table, keyed by a normalized company name. This
 * file only holds the category taxonomy and the normalization function used
 * to compute lookup keys — never the mapping data itself, which must not be
 * committed to this (public) repository.
 */

export type CompanyCategoryKey =
  | "fintech_payments"
  | "banking_insurance"
  | "software_services"
  | "consulting_big4"
  | "product_saas"
  | "ecommerce_retail"
  | "telecom_media"
  | "travel_logistics"
  | "energy_industry"
  | "health"
  | "government_education"
  | "independent"
  | "other"
  | "unclassified"
  | "no_company";

export interface CompanyCategoryDef {
  key: CompanyCategoryKey;
}

// Ordered for display. `unclassified` (company present but its normalized
// key isn't in the company_category table — e.g. future imports from other
// BDs whose network hasn't been mapped yet) and `no_company` (blank/null
// company) are synthetic buckets not present in the mapping table itself.
//
// Display labels are localized — see src/lib/i18n/dictionaries/{en,es}.ts
// (`companyCategories` record), keyed by the same CompanyCategoryKey so the
// key list lives in exactly one place.
export const COMPANY_CATEGORIES: CompanyCategoryDef[] = [
  { key: "fintech_payments" },
  { key: "banking_insurance" },
  { key: "software_services" },
  { key: "consulting_big4" },
  { key: "product_saas" },
  { key: "ecommerce_retail" },
  { key: "telecom_media" },
  { key: "travel_logistics" },
  { key: "energy_industry" },
  { key: "health" },
  { key: "government_education" },
  { key: "independent" },
  { key: "other" },
  { key: "unclassified" },
  { key: "no_company" },
];

// Legal-suffix / entity-type words stripped from company names before
// normalization, matched on (ASCII) word boundaries. Ported 1:1 from the
// Python prototype's regex.
/**
 * Legal-entity suffixes stripped before a company name is used as a key.
 * Exported so every normalizer in the app (company keys, domain guessing)
 * strips the SAME set — a second, narrower copy silently produced different
 * names for the same company.
 */
export const COMPANY_SUFFIX_RE = /\b(inc|llc|ltd|s ?a|s ?r ?l|s ?a ?s|corp|corporation|gmbh)\b/g;

/**
 * Normalize a raw company name into the lookup key used by the
 * company_category mapping table.
 *
 * Ported from the Python prototype used to generate the mapping:
 *   def key(s):
 *     s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
 *     s = re.sub(r"[.,]", " ", s)
 *     s = re.sub(r"\b(inc|llc|ltd|s ?a|s ?r ?l|s ?a ?s|corp|corporation|gmbh)\b", " ", s)
 *     return re.sub(r"\s+", " ", s).strip()
 *
 * NFKD decomposes accented letters into base letter + combining marks; the
 * ASCII-only encode/decode step then drops the combining marks *and* any
 * other non-ASCII characters, matching Python's `encode("ascii", "ignore")`.
 * Because the string is ASCII-only by the time the suffix regex runs, JS's
 * `\b` (which only recognizes ASCII word characters) behaves identically to
 * Python's `\b` there.
 */
export function normalizeCompanyKey(name: string): string {
  const ascii = name
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex -- intentionally matches Python's ASCII-only encode/decode step
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
  const noPunct = ascii.replace(/[.,]/g, " ");
  const noSuffix = noPunct.replace(COMPANY_SUFFIX_RE, " ");
  return noSuffix.replace(/\s+/g, " ").trim();
}
