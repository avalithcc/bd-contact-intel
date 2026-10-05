/**
 * Pure helpers for the `/contacts` list's bulk "Asignar responsable" action
 * (task 13.2; mockup `.bulk-bar` "Asignar responsable"). A manual
 * reassignment always applies: the old R3 gate ("only when the person has no
 * person_bd_connection") is gone, and the change is recorded as a manual
 * `edit` that the automatic owner rule never overrides (see
 * src/lib/identity/ownerRule.ts). No I/O here — the DB glue is bulkOwnerDb.ts.
 */
import { isUuid } from "@/lib/uuid";

/** Mockup shows "Seleccionar los 9,812" for select-all-in-view; this caps a
 * single bulk action so one request can't silently touch the whole table. */
export const MAX_BULK_SELECTION = 200;

/** "Seleccionar los N" filter-wide mode (contacts.html:104) — the server
 * re-derives the id set from the active filter instead of a checked
 * selection, so it needs a higher hard cap than MAX_BULK_SELECTION (which
 * exists to bound a plain checked-boxes POST). Owner decision: 2,000. */
export const BULK_FILTER_TARGET_CAP = 2000;

/**
 * Normalizes a single `<select>` owner value (task 13.3 parity gap:
 * single-record owner reassignment on `/contacts/[id]`, reusing bulkAssignOwner
 * — see contacts/actions.ts#updateContactOwnerAction). A blank selection means
 * "unassign" (`null`, matches updateLeadOwner's `ownerBdId: string | null`
 * shape); a well-formed uuid passes through; anything else is `undefined` so
 * the caller can reject it before it reaches a `uuid` column.
 */
export function normalizeOwnerSelectValue(raw: string): string | null | undefined {
  if (raw === "") return null;
  return isUuid(raw) ? raw : undefined;
}

export interface OwnerAssignmentPlan {
  /** Persons whose owner really changes: the only ones whose row, updated_at and audit entry are written. */
  toUpdate: string[];
  /** One manual-owner marker per person that does not already have one, INCLUDING persons whose owner stays the same (picking the current owner confirms it). */
  history: { personId: string; oldValue: string | null }[];
}

/** Pure; never mutates its inputs. `manualPersonIds` = persons that already carry the manual-owner marker. */
export function planOwnerAssignment(
  rows: readonly { id: string; ownerBdId: string | null }[],
  ownerBdId: string | null,
  manualPersonIds: ReadonlySet<string>,
): OwnerAssignmentPlan {
  const toUpdate = rows.filter((r) => r.ownerBdId !== ownerBdId).map((r) => r.id);
  const history = rows
    .filter((r) => r.ownerBdId !== ownerBdId || !manualPersonIds.has(r.id))
    .map((r) => ({ personId: r.id, oldValue: r.ownerBdId }));
  return { toUpdate, history };
}

/** Shared by both bulk actions (assign owner, create task): validates every
 * id as a real UUID before it can reach a `uuid` column (src/lib/uuid.ts),
 * dedups, and caps at `cap` (defaults to MAX_BULK_SELECTION — the plain
 * checked-boxes path; filter-wide mode passes BULK_FILTER_TARGET_CAP). */
export function sanitizeBulkPersonIds(raw: unknown, cap: number = MAX_BULK_SELECTION): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !isUuid(entry)) continue;
    seen.add(entry);
    if (seen.size >= cap) break;
  }
  return [...seen];
}
