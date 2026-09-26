/**
 * Thin DB glue for the bulk "Asignar responsable" action (task 13.2). Same
 * write shape as updateLeadOwner's dual-write branch (src/lib/leads/queries.ts)
 * — `person.owner_bd_id` only changes when the row has no `person_bd_connection`
 * yet (R3) — but writes `person` directly (no `person_id_map`/dual-write
 * indirection: `/contacts` already operates on `person`, not a legacy table).
 * Not unit-tested directly (imports `db`) — planBulkOwnerAssignment
 * (bulkOwner.ts) carries the tested rule.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, person, personBdConnection, personPropertyHistory } from "@/db/schema";
import {
  planBulkOwnerAssignment,
  sanitizeBulkPersonIds,
  type BulkOwnerPlanRow,
} from "@/lib/contacts/bulkOwner";
import { buildBulkOwnerAuditRow, type BulkOwnerAuditMode } from "@/lib/contacts/bulkOwnerAudit";

export interface BulkAssignOwnerOptions {
  idCap?: number;
  /** Owner-approved requirement: every bulk owner change writes one
   * audit_log row, in the SAME transaction as the update below — see
   * src/lib/contacts/bulkOwnerAudit.ts for the row shape. */
  mode?: BulkOwnerAuditMode;
  filtersQuery?: string;
}

/**
 * `idCap` defaults to MAX_BULK_SELECTION (the plain checked-boxes path);
 * "Seleccionar los N" filter-wide mode passes BULK_FILTER_TARGET_CAP —
 * `rawPersonIds` there is already a server-derived id list (see
 * getContactIdsForFilters), not raw client input, but still runs through
 * the same uuid/dedup validation here, just against a higher cap.
 */
export async function bulkAssignOwner(
  rawPersonIds: unknown,
  ownerBdId: string | null,
  changedByBdId: string,
  options: BulkAssignOwnerOptions = {},
): Promise<BulkOwnerPlanRow[]> {
  const { idCap, mode = "ids", filtersQuery } = options;
  const personIds = sanitizeBulkPersonIds(rawPersonIds, idCap);
  if (!personIds.length) return [];

  return db.transaction(async (tx) => {
    // An owner id that isn't a real BD would only fail on the FK (a 500).
    if (ownerBdId) {
      const [owner] = await tx.select({ id: bd.id }).from(bd).where(eq(bd.id, ownerBdId));
      if (!owner) return [];
    }
    // Merged-away persons are hidden everywhere; never write to them.
    const rows = await tx
      .select({ id: person.id, ownerBdId: person.ownerBdId })
      .from(person)
      .where(and(inArray(person.id, personIds), isNull(person.mergedIntoId)));
    if (!rows.length) return [];

    const connectionRows = await tx
      .select({ personId: personBdConnection.personId })
      .from(personBdConnection)
      .where(inArray(personBdConnection.personId, personIds));
    const connected = new Set(connectionRows.map((r) => r.personId));

    const plan = planBulkOwnerAssignment(
      rows.map((r) => ({ personId: r.id, hasConnection: connected.has(r.id) })),
    );
    const toAssign = plan.filter((p) => p.outcome === "assigned").map((p) => p.personId);

    if (toAssign.length) {
      await tx
        .update(person)
        .set({ ownerBdId, updatedByBdId: changedByBdId, updatedAt: new Date() })
        .where(inArray(person.id, toAssign));

      const historyRows = toAssign
        .map((id) => {
          const oldValue = rows.find((r) => r.id === id)?.ownerBdId ?? null;
          if (oldValue === ownerBdId) return null;
          return {
            personId: id,
            property: "ownerBdId",
            oldValue,
            newValue: ownerBdId,
            changedByBdId,
            source: "edit",
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
      if (historyRows.length) await tx.insert(personPropertyHistory).values(historyRows);

      const auditRow = buildBulkOwnerAuditRow({
        actorBdId: changedByBdId,
        ownerBdId,
        mode,
        filtersQuery,
        personIds: toAssign,
      });
      await tx.insert(auditLog).values(auditRow);
    }

    return plan;
  });
}

export async function listOwnerOptions(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: bd.id, name: bd.name }).from(bd).orderBy(asc(bd.name));
}

/** Keeps only live (not merged-away) persons, for bulk writes that don't go
 * through the single-record merge guard. */
export async function filterLivePersonIds(personIds: string[]): Promise<string[]> {
  if (!personIds.length) return [];
  const rows = await db
    .select({ id: person.id })
    .from(person)
    .where(and(inArray(person.id, personIds), isNull(person.mergedIntoId)));
  return rows.map((r) => r.id);
}
