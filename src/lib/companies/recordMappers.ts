/**
 * Pure mappers for the `/companies/[key]` record rebuild
 * (mockups/company-record.html). No DB import.
 */

export interface MarketBreakdown {
  latam: number;
  us: number;
  other: number;
  total: number;
}

/**
 * Vacantes card footer ("N vacantes de IT abiertas · X LATAM · Y US",
 * company-record.html:91) — tallies the company's own open-IT postings
 * (from getCompanyPostingsForKey) by market bucket. Real per-market counts,
 * not an approximation from the offshore/LATAM-only fields HiringMatch
 * carries for the ranking crossover.
 */
export function marketBreakdown(postings: readonly { market: string }[]): MarketBreakdown {
  let latam = 0;
  let us = 0;
  let other = 0;
  for (const p of postings) {
    if (p.market === "latam") latam++;
    else if (p.market === "us") us++;
    else other++;
  }
  return { latam, us, other, total: postings.length };
}

export type CompanyActivityFilter = "all" | "note" | "stage_change" | "contact_activity";

export interface FilterableTimelineRow {
  type: string;
  scope: "company" | "contact";
}

/**
 * Activity tab's 4 filter pills (company-record.html:78 — "Todas" / "Notas"
 * / "Cambios de etapa" / "Actividad de contactos"). "Notas"/"Cambios de
 * etapa" only ever apply to company-scoped rows (a note or stage change
 * logged directly against this company); "Actividad de contactos" is any
 * row that crossed over from a person at this company, regardless of type.
 */
export function filterTimelineRows<T extends FilterableTimelineRow>(
  rows: readonly T[],
  filter: CompanyActivityFilter,
): T[] {
  switch (filter) {
    case "all":
      return [...rows];
    case "note":
      return rows.filter((r) => r.type === "note" && r.scope === "company");
    case "stage_change":
      return rows.filter((r) => r.type === "status_change" && r.scope === "company");
    case "contact_activity":
      return rows.filter((r) => r.scope === "contact");
  }
}

export interface StartupSignal {
  isStartup: boolean | null;
  startupReason: string | null;
}

const EMPTY_VALUE = "—";

/**
 * "Startup" property (company-record.html:73). Owner-corrected in c03
 * (was misdiagnosed as needing a new data source in c01): reuses
 * `getHiringMatchIndex()`'s `HiringMatch.isStartup`/`startupReason`
 * (company-level, sourced from `target_company.is_startup` — see
 * src/lib/hiring/queries.ts), straight through, no aggregation from
 * contacts. `null` (no hiring-index entry, or unclassified) renders "—",
 * distinct from a confirmed "No".
 */
export function startupLabel(signal: StartupSignal | null, yesLabel: string, noLabel: string): string {
  if (!signal || signal.isStartup === null) return EMPTY_VALUE;
  const base = signal.isStartup ? yesLabel : noLabel;
  return signal.startupReason ? `${base} · ${signal.startupReason}` : base;
}

export interface CompanyPropertyHistoryRow {
  property: string;
  bdName: string | null;
  at: Date;
}

export interface LastEdit {
  bdName: string | null;
  at: Date;
}

/**
 * Reduces `company_property_history` rows into a last-edit-per-property
 * map (mockup-port c05, wiring D1) — same reduction contacts/queries.ts
 * does inline for `personPropertyHistory` ("first row per property wins").
 * The caller MUST pass rows already ordered newest-first (recordQueries.ts
 * does this in SQL via `ORDER BY at DESC`); this function does no sorting
 * of its own, so it stays a plain, cheap reduction.
 */
export function latestEditByProperty(rows: readonly CompanyPropertyHistoryRow[]): Map<string, LastEdit> {
  const map = new Map<string, LastEdit>();
  for (const row of rows) {
    if (!map.has(row.property)) {
      map.set(row.property, { bdName: row.bdName, at: row.at });
    }
  }
  return map;
}
