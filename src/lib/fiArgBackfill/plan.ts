/**
 * Pure planner behind scripts/backfill-fi-arg-fields.ts. The 2026 fold of the
 * lead table into person never carried company text, city, country or
 * seniority; this fills them, FILL-EMPTY ONLY. Never mutates its inputs.
 *
 * SOURCE: the `lead` rows themselves, NOT the original CSVs. import-leads.ts
 * already wrote city, country, seniority and company_raw/company_display onto
 * `lead` (measured for fi-arg-2026: city 1057/1057, country 1057/1057,
 * company_raw 1057/1057, seniority 994/1057), so every value this backfill
 * needs is already in the database. Reading the attendee CSVs instead would
 * tie the script to `../lead_gen/data`, a directory outside this repo that is
 * not guaranteed to exist on the next machine — the script would simply die,
 * and the reason would not be obvious.
 *
 * IDENTITY: the DB layer joins lead -> person_id_map('lead') -> person, so one
 * row already carries the source values and the person's current state side by
 * side. Nothing here re-matches anything; `personId` is null when that lead has
 * no person (leadRowsToIdentityRows drops leads with no owner, which is why
 * `lead` holds more rows than there are persons).
 */
export const FI_ARG_SOURCE_KEY = "fi-arg-2026";
export const FILL_FIELDS = ["company", "city", "country", "seniority"] as const;
export type FillField = (typeof FILL_FIELDS)[number];

/** What `lead` holds for this attendee. `companyDisplay` wins over `companyRaw`,
 * the precedence scripts/import-leads.ts used — kept here, not in SQL, so it is
 * unit-tested rather than buried in a coalesce. */
export interface FiArgLeadValues {
  companyDisplay: string | null;
  companyRaw: string | null;
  city: string | null;
  country: string | null;
  seniority: string | null;
}

export interface FiArgRow {
  leadId: string;
  /** Null when this lead has no person at all: counted, never guessed. */
  personId: string | null;
  /** The person is live and still carries the fi-arg source key. Anything else is left alone. */
  inScope: boolean;
  source: FiArgLeadValues;
  current: Record<FillField, string | null>;
}

export interface FiArgFill {
  personId: string;
  property: FillField;
  value: string;
}

export interface FiArgReport {
  leads: number;
  matched: number;
  unmatched: number;
  outOfScope: number;
  personsFilled: number;
  filled: Record<FillField, number>;
}

const isEmpty = (v: string | null) => !(v ?? "").trim();

/** The four fillable values a lead row offers, display name preferred. */
export function sourceValues(source: FiArgLeadValues): Record<FillField, string | null> {
  return {
    company: source.companyDisplay?.trim() ? source.companyDisplay : source.companyRaw,
    city: source.city,
    country: source.country,
    seniority: source.seniority,
  };
}

export function planFiArgBackfill(rows: readonly FiArgRow[]): { fills: FiArgFill[]; report: FiArgReport } {
  // Working copy of what each person holds, so two leads on one person cannot
  // both fill the same field — the first lead wins and the second sees it taken.
  const state = new Map<string, Record<FillField, string | null>>();
  const fills: FiArgFill[] = [];
  const filledPersons = new Set<string>();
  const report: FiArgReport = {
    leads: rows.length,
    matched: 0,
    unmatched: 0,
    outOfScope: 0,
    personsFilled: 0,
    filled: { company: 0, city: 0, country: 0, seniority: 0 },
  };

  for (const row of rows) {
    if (!row.personId) {
      report.unmatched++;
      continue;
    }
    if (!row.inScope) {
      report.outOfScope++;
      continue;
    }
    report.matched++;
    const current = state.get(row.personId) ?? { ...row.current };
    state.set(row.personId, current);
    const source = sourceValues(row.source);
    for (const field of FILL_FIELDS) {
      const value = source[field]?.trim();
      if (!value || !isEmpty(current[field])) continue;
      current[field] = value;
      fills.push({ personId: row.personId, property: field, value });
      report.filled[field]++;
      filledPersons.add(row.personId);
    }
  }
  report.personsFilled = filledPersons.size;
  return { fills, report };
}
