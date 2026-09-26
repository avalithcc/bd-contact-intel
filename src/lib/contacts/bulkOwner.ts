/**
 * Pure planner for the `/contacts` list's bulk "Asignar responsable" action
 * (task 13.2; mockup `.bulk-bar` "Asignar responsable"; orchestrator
 * decision: same R3 rule as updateLeadOwner — "owner set only when the
 * person has no person_bd_connection yet" — applied per row, with a
 * per-row outcome reported back instead of a silent no-op on skipped rows).
 * No I/O here — the DB glue (bulkOwnerDb.ts) reads which selected persons
 * already have a connection and calls this to decide the plan.
 */
import { isUuid } from "@/lib/uuid";

/** Mockup shows "Seleccionar los 9,812" for select-all-in-view; this caps a
 * single bulk action so one request can't silently touch the whole table. */
export const MAX_BULK_SELECTION = 200;

export interface BulkOwnerRowInput {
  personId: string;
  hasConnection: boolean;
}

export type BulkOwnerOutcome = "assigned" | "skipped_has_connection";

export interface BulkOwnerPlanRow {
  personId: string;
  outcome: BulkOwnerOutcome;
}

export function planBulkOwnerAssignment(rows: BulkOwnerRowInput[]): BulkOwnerPlanRow[] {
  return rows.map((row) => ({
    personId: row.personId,
    outcome: row.hasConnection ? "skipped_has_connection" : "assigned",
  }));
}

/** Shared by both bulk actions (assign owner, create task): validates every
 * id as a real UUID before it can reach a `uuid` column (src/lib/uuid.ts),
 * dedups, and caps at MAX_BULK_SELECTION. */
export function sanitizeBulkPersonIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !isUuid(entry)) continue;
    seen.add(entry);
    if (seen.size >= MAX_BULK_SELECTION) break;
  }
  return [...seen];
}
