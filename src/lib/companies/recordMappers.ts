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

const COMPANY_ACTIVITY_FILTERS: readonly CompanyActivityFilter[] = ["all", "note", "stage_change", "contact_activity"];

/**
 * Validates an untrusted `?activityFilter=`/server-action argument against
 * the 4 known filter keys (fix/company-timeline-filter-no-reload) — the
 * company-timeline counterpart of `isTimelinePillKey`
 * (@/lib/activity/timelinePills). The client's filter value must never be
 * trusted as-is before it reaches a DB query.
 */
export function isCompanyActivityFilter(value: string | undefined): value is CompanyActivityFilter {
  return !!value && (COMPANY_ACTIVITY_FILTERS as readonly string[]).includes(value);
}

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

/**
 * True per-filter row counts, computed server-side over EVERY row (never
 * capped by `getCompanyTimeline`'s `TIMELINE_LIMIT` — see recordQueries.ts's
 * `getCompanyTimelineFilterCounts`). Mirrors the Contact record's
 * `countsByType` (@/lib/activity/timelinePills): the ground truth the client
 * compares its own loaded pool against before trusting a purely local
 * filter (fix/company-timeline-filter-no-reload).
 */
export type CompanyTimelineFilterCounts = Record<CompanyActivityFilter, number>;

/**
 * Decides whether an already-loaded row pool is a safe substitute for a
 * fresh server fetch scoped to `filter` — the company-timeline counterpart
 * of the Contact record's `isPillSelectionComplete`
 * (@/lib/activity/timelinePills). A busy company's server page is capped
 * well below its true activity count (recordQueries.ts's `TIMELINE_LIMIT`),
 * so a purely client-side filter over that capped page can silently
 * under-represent an older-skewing filter (most likely "contact_activity",
 * which can span many people).
 */
export function isCompanyFilterSelectionComplete<T extends FilterableTimelineRow>(
  loadedRows: readonly T[],
  counts: CompanyTimelineFilterCounts,
  filter: CompanyActivityFilter,
): boolean {
  return filterTimelineRows(loadedRows, filter).length >= counts[filter];
}

export type CompanyScopeResolution<T> = { kind: "ready"; rows: T[] } | { kind: "fetch" };

/**
 * The one decision both a filter-pill click (CompanyTimeline.tsx's
 * `selectFilter`) and a background data refresh make from a
 * freshly-available row pool: can `filter`'s view be safely derived from it
 * right now, or does it require a scoped server fetch? Mirrors the Contact
 * record's `resolveScopeEntries` (@/lib/activity/timelinePills) — pulled out
 * as its own pure function for the same reason: both call sites must never
 * answer this question differently.
 */
export function resolveCompanyScopeRows<T extends FilterableTimelineRow>(
  pool: readonly T[],
  counts: CompanyTimelineFilterCounts,
  filter: CompanyActivityFilter,
): CompanyScopeResolution<T> {
  if (isCompanyFilterSelectionComplete(pool, counts, filter)) {
    return { kind: "ready", rows: filterTimelineRows(pool, filter) };
  }
  return { kind: "fetch" };
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
