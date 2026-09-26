/**
 * "Seleccionar los N" filter-wide bulk mode (mockups/contacts.html:104).
 * Pure mapping only — no DB, no `@/db` import (deliberately: importing
 * listQueries.ts here would pull in `@/db`, which throws eagerly without
 * DATABASE_URL, making this untestable — see src/db/index.ts).
 * listQueries.ts#getContactIdsForFilters (the DB-touching half) calls
 * `getContactListPage(filters, meBdId, q, 1, cap, ...)` — the EXACT same
 * function the table itself renders from — and passes its result straight
 * through `idsFromContactListPage` below, so "the filter-derived id set
 * equals what the list shows" is guaranteed by reuse, not by two
 * independent implementations that could drift. This module's tests pin
 * the one part that reuse doesn't automatically prove: the mapping itself
 * never re-sorts, drops, or dedups rows independently of what the
 * page-generating query already decided.
 */

export interface ContactListPageLike {
  rows: { id: string }[];
  total: number;
}

export interface ContactIdsForFiltersResult {
  ids: string[];
  total: number;
}

export function idsFromContactListPage(page: ContactListPageLike): ContactIdsForFiltersResult {
  return { ids: page.rows.map((r) => r.id), total: page.total };
}
