/**
 * What the roster picker of "Nueva secuencia" asks the server for. Pure and client-safe (no ORM import): the picker
 * component builds a `PickerQuery`, the server action re-validates whatever arrives with `normalizePickerQuery`, and the
 * SQL (pickerQuery.ts) only ever sees the normalized value.
 *
 * The picker lists EVERY live contact with an email. Location and hiring are FILTERS the BD turns on, never a
 * restriction of the pool; all of them are off by default.
 */
import type { PickerContact } from "./pickerView";

export const PICKER_PAGE_SIZE = 50;
/** Deepest offset the server honors: a runaway client cannot make Postgres sort-and-skip the whole table. */
export const PICKER_MAX_OFFSET = 50_000;
export const PICKER_SEARCH_MAX_CHARS = 100;
export const PICKER_SEARCH_MAX_TOKENS = 4;

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
  offset: number;
};

export type PickerPage = { contacts: PickerContact[]; hasMore: boolean };

export const DEFAULT_PICKER_QUERY: PickerQuery = { search: "", florida: false, hiring: false, mine: false, showBlocked: false, offset: 0 };

export function normalizePickerQuery(raw: unknown): PickerQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const offset = typeof r.offset === "number" && Number.isFinite(r.offset) ? Math.min(Math.max(Math.trunc(r.offset), 0), PICKER_MAX_OFFSET) : 0;
  return {
    search: typeof r.search === "string" ? r.search.trim().slice(0, PICKER_SEARCH_MAX_CHARS) : "",
    florida: r.florida === true,
    hiring: r.hiring === true,
    mine: r.mine === true,
    showBlocked: r.showBlocked === true,
    offset,
  };
}

export function searchTokens(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean).slice(0, PICKER_SEARCH_MAX_TOKENS);
}

/** Identity of a query ignoring paging: when it changes the list restarts at the first page. */
export function pickerQueryKey(q: PickerQuery): string {
  return JSON.stringify([q.search.trim(), q.florida, q.hiring, q.mine, q.showBlocked]);
}

/** A later page appended to the list, skipping anyone already in it (offset paging can repeat a row if the data moved). */
export function appendPage(existing: readonly PickerContact[], next: readonly PickerContact[]): PickerContact[] {
  const seen = new Set(existing.map((c) => c.personId));
  return [...existing, ...next.filter((c) => !seen.has(c.personId))];
}
