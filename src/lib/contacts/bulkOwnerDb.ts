/**
 * Thin DB glue for the bulk "Asignar responsable" action (task 13.2). Same
 * write shape as updateLeadOwner's dual-write branch (src/lib/leads/queries.ts)
 * — `person.owner_bd_id` only changes when the row has no `person_bd_connection`
 * yet (R3) — but writes `person` directly (no `person_id_map`/dual-write
 * indirection: `/contacts` already operates on `person`, not a legacy table).
 * Not unit-tested directly (imports `db`) — planBulkOwnerAssignment
 * (bulkOwner.ts) carries the tested rule.
 */
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bd, person, personBdConnection, personPropertyHistory } from "@/db/schema";
import {
  planBulkOwnerAssignment,
  sanitizeBulkPersonIds,
  type BulkOwnerPlanRow,
} from "@/lib/contacts/bulkOwner";

export async function bulkAssignOwner(
  rawPersonIds: unknown,
  ownerBdId: string | null,
  changedByBdId: string,
): Promise<BulkOwnerPlanRow[]> {
  const personIds = sanitizeBulkPersonIds(rawPersonIds);
  if (!personIds.length) return [];

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: person.id, ownerBdId: person.ownerBdId })
      .from(person)
      .where(inArray(person.id, personIds));
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
    }

    return plan;
  });
}

export async function listOwnerOptions(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: bd.id, name: bd.name }).from(bd).orderBy(asc(bd.name));
}
