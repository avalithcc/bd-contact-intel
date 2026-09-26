/**
 * Audit row for "Asignar responsable" (owner-approved requirement): every
 * owner change — explicit checked ids, "Seleccionar los N" filter-wide
 * mode, or a single record-page reassignment — writes one `audit_log` row,
 * in the SAME transaction as the `person.owner_bd_id` update
 * (bulkOwnerDb.ts#bulkAssignOwner). Same table/action-vocabulary
 * convention as merge/unmerge (src/lib/identity/mergeDb.ts) and the
 * migration runner (src/lib/migration/queries.ts). `targetBdId` = the new
 * owner (or `null` for unassign), `metadata` carries everything a
 * fixed-column schema has no room for (mode, filtersQuery, the affected id
 * list).
 *
 * `mode: "single"` (the record page's own-Contact reassignment,
 * contacts/actions.ts#updateContactOwnerAction) writes a DISTINCT
 * `"owner_change"` action rather than `"bulk_owner_change"` — reassigning
 * one Contact from its own record page is not the same operator action as
 * a list-page bulk/filter-wide reassignment, even though both go through
 * the same `bulkAssignOwner` write path (R3 rule, one-element selection).
 */
export const AUDIT_LOG_ID_CAP = 100;

export type BulkOwnerAuditMode = "ids" | "filter" | "single";

export interface BulkOwnerAuditInput {
  actorBdId: string;
  /** The new owner, or `null` for "unassign". */
  ownerBdId: string | null;
  mode: BulkOwnerAuditMode;
  /** Only meaningful (and only ever set) for `mode: "filter"` — the same
   * serialized ContactFilters the filter-wide request itself sent. */
  filtersQuery?: string;
  /** The ids actually updated (bulkAssignOwner's `toAssign`, not the raw
   * request) — R3-skipped rows never touched `owner_bd_id`, so they don't
   * belong in an audit of what changed. */
  personIds: string[];
}

export interface BulkOwnerAuditMetadata {
  count: number;
  mode: BulkOwnerAuditMode;
  filtersQuery?: string;
  /** Capped at AUDIT_LOG_ID_CAP — `count` above always reflects the full,
   * uncapped total so the row is honest about scale even when the list
   * itself is truncated. */
  personIds: string[];
  truncated: boolean;
}

export type BulkOwnerAuditAction = "bulk_owner_change" | "owner_change";

export interface BulkOwnerAuditRow {
  actorBdId: string;
  action: BulkOwnerAuditAction;
  targetBdId: string | null;
  metadata: BulkOwnerAuditMetadata;
}

export function buildBulkOwnerAuditRow(input: BulkOwnerAuditInput): BulkOwnerAuditRow {
  const truncated = input.personIds.length > AUDIT_LOG_ID_CAP;
  const metadata: BulkOwnerAuditMetadata = {
    count: input.personIds.length,
    mode: input.mode,
    personIds: input.personIds.slice(0, AUDIT_LOG_ID_CAP),
    truncated,
  };
  if (input.mode === "filter" && input.filtersQuery) metadata.filtersQuery = input.filtersQuery;

  return {
    actorBdId: input.actorBdId,
    action: input.mode === "single" ? "owner_change" : "bulk_owner_change",
    targetBdId: input.ownerBdId,
    metadata,
  };
}
