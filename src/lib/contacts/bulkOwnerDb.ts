/**
 * Thin DB glue for the bulk "Asignar responsable" action (task 13.2). Same
 * write shape as updateLeadOwner's dual-write branch (src/lib/leads/queries.ts):
 * an explicit owner change ALWAYS applies to `person.owner_bd_id` (the old R3
 * "no connection yet" gate is gone) and writes a `source = 'edit'` history row,
 * which is what makes the owner sticky against the automatic rule. Writes
 * `person` directly (no `person_id_map`/dual-write indirection: `/contacts`
 * already operates on `person`, not a legacy table). Not unit-tested directly
 * (imports `db`).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, person, personPropertyHistory } from "@/db/schema";
import { sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";
import { buildBulkOwnerAuditRow, type BulkOwnerAuditMode } from "@/lib/contacts/bulkOwnerAudit";
import { MANUAL_OWNER_SOURCE, OWNER_HISTORY_PROPERTY } from "@/lib/identity/ownerRule";

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
): Promise<number> {
  const { idCap, mode = "ids", filtersQuery } = options;
  const personIds = sanitizeBulkPersonIds(rawPersonIds, idCap);
  if (!personIds.length) return 0;

  return db.transaction(async (tx) => {
    // An owner id that isn't a real BD would only fail on the FK (a 500).
    if (ownerBdId) {
      const [owner] = await tx.select({ id: bd.id }).from(bd).where(eq(bd.id, ownerBdId));
      if (!owner) return 0;
    }
    // Merged-away persons are hidden everywhere; never write to them.
    const rows = await tx
      .select({ id: person.id, ownerBdId: person.ownerBdId })
      .from(person)
      .where(and(inArray(person.id, personIds), isNull(person.mergedIntoId)));
    if (!rows.length) return 0;

    const toAssign = rows.map((r) => r.id);
    const oldOwnerById = new Map(rows.map((r) => [r.id, r.ownerBdId]));

    await tx
      .update(person)
      .set({ ownerBdId, updatedByBdId: changedByBdId, updatedAt: new Date() })
      .where(inArray(person.id, toAssign));

    const historyRows = toAssign
      .map((id) => {
        const oldValue = oldOwnerById.get(id) ?? null;
        if (oldValue === ownerBdId) return null;
        return {
          personId: id,
          property: OWNER_HISTORY_PROPERTY,
          oldValue,
          newValue: ownerBdId,
          changedByBdId,
          source: MANUAL_OWNER_SOURCE,
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

    return toAssign.length;
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
