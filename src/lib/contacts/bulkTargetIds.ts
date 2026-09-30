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
import { resolveRoleVisibility, type RoleVisibility } from "@/lib/contacts/roleVisibility";
import type { ContactFilters } from "@/lib/contacts/viewFilters";

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

/**
 * Fix (coordinator report): "Seleccionar los N" MUST act on exactly what
 * the list shows — the default "Ocultar grupos No priorizar por defecto"
 * hide (owner decision 2026-09-30, "opción A") and its `?roles=all`/
 * explicit-`roleGroup` overrides therefore need the EXACT SAME
 * resolveRoleVisibility composition page.tsx/export/route.ts already use
 * (roleVisibility.ts), reused here (not reimplemented) so bulkActions.ts/
 * bulkMessageActions.ts can never disagree with the table's own state.
 * Pure — same "no `@/db`" guarantee as the rest of this module.
 */
export function resolveBulkRoleVisibility(
  rolesParam: string | undefined,
  filters: Pick<ContactFilters, "roleGroup">,
): RoleVisibility {
  return resolveRoleVisibility(rolesParam, filters.roleGroup);
}
