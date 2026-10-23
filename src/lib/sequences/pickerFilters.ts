/**
 * What the roster picker of "Nueva secuencia" asks the server for. Pure and client-safe (no ORM import): the picker
 * component builds a `PickerQuery`, the server action re-validates whatever arrives with `normalizePickerQuery`, and the
 * SQL (pickerQuery.ts) only ever sees the normalized value.
 *
 * The picker lists EVERY live contact with an email. Location and hiring are FILTERS the BD turns on, never a
 * restriction of the pool; all of them are off by default.
 */
import type { IndustryCounts } from "./industryCounts";
import type { CountryCounts, SignalCounts } from "./pickerCounts";
import { KNOWN_INDUSTRY_VALUES } from "./industryGroups";
import type { PickerContact } from "./pickerView";

export const PICKER_PAGE_SIZE = 50;
/** Deepest offset the server honors: a runaway client cannot make Postgres sort-and-skip the whole table. */
export const PICKER_MAX_OFFSET = 50_000;
export const PICKER_SEARCH_MAX_CHARS = 100;
export const PICKER_SEARCH_MAX_TOKENS = 4;
/** Entries of `industries` that are even looked at: a bound on what a client can make the server scan. */
export const PICKER_INDUSTRY_MAX = 200;
/** Entries of `countries` that are even looked at, and the longest country text kept (the data holds ~60 values of <30 chars). */
export const PICKER_COUNTRY_MAX = 200;
export const PICKER_COUNTRY_MAX_CHARS = 100;

export type PickerQuery = {
  search: string;
  /** Company has a Florida / Miami signal (see floridaSql in pickerQuery.ts). */
  florida: boolean;
  /** Company has an open, fresh IT posting in the US. */
  hiring: boolean;
  /** The contact's owner is the signed-in BD. */
  mine: boolean;
  /** Include the contacts that cannot be added (shown last, with the reason). */
  showBlocked: boolean;
  /**
   * Raw company industry values (a subset of KNOWN_INDUSTRY_VALUES, sorted, no duplicates). A group chip is only a shortcut
   * the UI expands into its values, so the query carries what it filters on. Empty means no industry filter.
   */
  industries: string[];
  /** Also (or only) contacts whose company has no industry. Not the same as an empty `industries`, which filters nothing. */
  noIndustry: boolean;
  /**
   * Effective countries to keep, as the counts return them (the person's own, else the company's; trimmed, case as stored; sorted, no
   * duplicates). No list of "known" countries: they come from the data. Empty means no country filter.
   */
  countries: string[];
  /** Also (or only) contacts with no effective country. Not the same as an empty `countries`, which filters nothing. */
  noCountry: boolean;
  offset: number;
};

/**
 * `industryCounts` are the chip counts for THIS page's query, read together with it (pageQueries.listPickerPage). `null`
 * means the query only advanced the page (offset > 0): the counts of the list already on screen still hold.
 */
export type PickerPage = { contacts: PickerContact[]; hasMore: boolean; industryCounts?: IndustryCounts | null; countryCounts?: CountryCounts | null; signalCounts?: SignalCounts | null };

export const DEFAULT_PICKER_QUERY: PickerQuery = { search: "", florida: false, hiring: false, mine: false, showBlocked: false, industries: [], noIndustry: false, countries: [], noCountry: false, offset: 0 };

/** Only known raw values, once each, in canonical order; reads at most PICKER_INDUSTRY_MAX entries. */
function normalizeIndustries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = raw.slice(0, PICKER_INDUSTRY_MAX).filter((v): v is string => typeof v === "string" && KNOWN_INDUSTRY_VALUES.has(v));
  return [...new Set(known)].sort();
}

/** Strings only, trimmed, non-empty, once each, canonical order; reads at most PICKER_COUNTRY_MAX entries. */
function normalizeCountries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const kept = raw.slice(0, PICKER_COUNTRY_MAX).flatMap((v) => (typeof v === "string" && v.trim() && v.trim().length <= PICKER_COUNTRY_MAX_CHARS ? [v.trim()] : []));
  return [...new Set(kept)].sort();
}

export function normalizePickerQuery(raw: unknown): PickerQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const offset = typeof r.offset === "number" && Number.isFinite(r.offset) ? Math.min(Math.max(Math.trunc(r.offset), 0), PICKER_MAX_OFFSET) : 0;
  return {
    search: typeof r.search === "string" ? r.search.trim().slice(0, PICKER_SEARCH_MAX_CHARS) : "",
    florida: r.florida === true,
    hiring: r.hiring === true,
    mine: r.mine === true,
    showBlocked: r.showBlocked === true,
    industries: normalizeIndustries(r.industries),
    noIndustry: r.noIndustry === true,
    countries: normalizeCountries(r.countries),
    noCountry: r.noCountry === true,
    offset,
  };
}

export function searchTokens(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean).slice(0, PICKER_SEARCH_MAX_TOKENS);
}

/** Identity of a query ignoring paging: when it changes the list restarts at the first page. */
export function pickerQueryKey(q: PickerQuery): string {
  return JSON.stringify([q.search.trim(), q.florida, q.hiring, q.mine, q.showBlocked, [...q.industries].sort(), q.noIndustry, [...q.countries].sort(), q.noCountry]);
}

/** A later page appended to the list, skipping anyone already in it (offset paging can repeat a row if the data moved). */
export function appendPage(existing: readonly PickerContact[], next: readonly PickerContact[]): PickerContact[] {
  const seen = new Set(existing.map((c) => c.personId));
  return [...existing, ...next.filter((c) => !seen.has(c.personId))];
}
