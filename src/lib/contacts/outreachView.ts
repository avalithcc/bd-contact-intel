/**
 * `/contacts` "Outreach" system view (owner decision 2026-09-26): pure
 * mapping layer over the shared, DB-free ranking module
 * (src/lib/outreach/ranking.ts) — reused verbatim, not re-derived, so
 * `/contacts?view=outreach` and `/outreach` are guaranteed to agree on row
 * order for the same BD. Deliberately has NO `@/db` import (unlike
 * src/lib/outreach/queries.ts) so it stays unit-testable without a DB
 * connection — the DB read itself lives in
 * src/lib/contacts/outreachViewDb.ts. Once the redirect (task 15c) lands,
 * `/outreach` goes away and this becomes the only ranking consumer.
 */
import { outreachReasons, type OutreachFilters, type OutreachRow } from "@/lib/outreach/ranking";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type { OutreachFilters };

export interface OutreachContactRow extends OutreachRow {
  // Same Spanish reason chips /outreach renders (outreachReasons) — kept as
  // pre-built strings, not re-derived by the page, so wording never drifts
  // between the two views.
  reasons: string[];
}

/** Pure mapping step: attaches the same reason chips /outreach shows, in
 * the same order the ranking produced them. */
export function attachOutreachReasons(
  rows: OutreachRow[],
  relativeTime: (d: Date) => string,
  dict: Dictionary,
): OutreachContactRow[] {
  return rows.map((r) => ({ ...r, reasons: outreachReasons(r, relativeTime, dict) }));
}
