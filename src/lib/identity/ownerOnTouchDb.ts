/**
 * DB glue of the on-touch owner transfer: "the BD who contacts is the new owner".
 * Called INSIDE the transaction of every writer of a real touch, right after
 * recomputePersonStatus(es), over the same person ids (see the call sites).
 *
 * Cost: ONE read of the persons (owner + manual flag), then, only when some
 * person is not manual, one of connections and one of touches; writes only when
 * the decided owner differs (UPDATE + history, one statement each per batch).
 * A touch on a contact you already own, or on a manual-owner contact, writes nothing.
 *
 * The manual flag is read with the same property list and source as hasManualOwner /
 * readManualOwnerPersonIds, and the UPDATE re-checks it, so a hand assignment committed
 * between the read and the write is still never overwritten. Not unit-tested directly
 * (needs a DB): tests/db/ownerFollowsLastTouch.test.ts drives it through the real writers.
 */
import { and, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { person, personBdConnection, personPropertyHistory } from "@/db/schema";
import { planOwnerTransfersOnTouch } from "@/lib/identity/ownerOnTouch";
import { MANUAL_OWNER_SOURCE, OWNER_HISTORY_PROPERTIES, OWNER_HISTORY_PROPERTY, OWNER_TOUCH_SOURCE } from "@/lib/identity/ownerRule";
import { readOwnerTouches } from "@/lib/identity/ownerRuleDb";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const propertyList = () => sql.join(OWNER_HISTORY_PROPERTIES.map((p) => sql`${p}`), sql`, `);

/** Correlated EXISTS on the person's history: the owner was assigned by hand. */
const manualOwnerExists = (personId: unknown) => sql`exists (
  select 1 from person_property_history h
  where h.person_id = ${personId} and h.property in (${propertyList()}) and h.source = ${MANUAL_OWNER_SOURCE}
)`;

/** Returns the number of owners moved. `actorBdId` is the BD whose touch triggered it (recorded as the history author). */
export async function transferOwnersOnTouch(tx: DbTransaction, personIds: readonly string[], actorBdId: string | null): Promise<number> {
  let moved = 0;
  for (const ids of chunk([...new Set(personIds)], WRITE_BATCH_SIZE)) moved += await transferChunk(tx, ids, actorBdId);
  return moved;
}

async function transferChunk(tx: DbTransaction, ids: string[], actorBdId: string | null): Promise<number> {
  if (ids.length === 0) return 0;

  const persons = await tx
    .select({ id: person.id, ownerBdId: person.ownerBdId, manual: sql<boolean>`${manualOwnerExists(person.id)}` })
    .from(person)
    .where(and(inArray(person.id, ids), isNull(person.mergedIntoId)));
  const open = persons.filter((p) => !p.manual);
  if (open.length === 0) return 0;
  const openIds = open.map((p) => p.id);

  const connections = await tx
    .select({
      personId: personBdConnection.personId,
      bdId: personBdConnection.bdId,
      connectedOn: personBdConnection.connectedOn,
      lastMessageAt: personBdConnection.lastMessageAt,
    })
    .from(personBdConnection)
    .where(inArray(personBdConnection.personId, openIds));
  const touches = await readOwnerTouches(tx, openIds);

  const changes = planOwnerTransfersOnTouch({
    persons: open.map((p) => ({ id: p.id, ownerBdId: p.ownerBdId })),
    connections,
    touches,
    manualPersonIds: new Set(),
  });
  if (changes.length === 0) return 0;

  const values = changes.map((c) => sql`(${c.personId}::uuid, ${c.fromBdId}::uuid, ${c.toBdId}::uuid)`);
  const updated = (await tx.execute(sql`
    UPDATE person AS p SET owner_bd_id = v.new_owner, updated_at = now()
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, old_owner, new_owner)
    WHERE p.id = v.id AND p.owner_bd_id IS NOT DISTINCT FROM v.old_owner AND NOT ${manualOwnerExists(sql`p.id`)}
    RETURNING p.id::text AS id
  `)) as unknown as { id: string }[];
  const movedIds = new Set(updated.map((r) => r.id));
  const moved = changes.filter((c) => movedIds.has(c.personId));
  for (const batch of chunk(moved, WRITE_BATCH_SIZE)) {
    await tx.insert(personPropertyHistory).values(
      batch.map((c) => ({
        personId: c.personId,
        property: OWNER_HISTORY_PROPERTY,
        oldValue: c.fromBdId,
        newValue: c.toBdId,
        changedByBdId: actorBdId,
        source: OWNER_TOUCH_SOURCE,
      })),
    );
  }
  return moved.length;
}
