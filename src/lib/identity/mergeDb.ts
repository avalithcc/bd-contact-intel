/**
 * Thin DB layer for Phase 6's merge/unmerge engine (design.md D6,
 * contact-identity R7, duplicate-review + admin-access-audit specs).
 * `mergeContacts`/`unmergeContact`/`markNotDuplicate` read the current rows,
 * delegate all decisions to the pure planner (./merge.ts), and write the
 * resulting plan inside one transaction each. Not unit-tested directly —
 * importing `db` throws without DATABASE_URL, same convention as
 * ./resolveDb.ts and src/lib/status/recompute.ts; the planner it calls is
 * fully covered by tests/unit/identityMerge.test.ts.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { db } from "@/db";
import {
  activity,
  auditLog,
  duplicateCandidate,
  mergeEvent,
  person,
  personBdConnection,
  personIdMap,
  signal,
  task,
} from "@/db/schema";
import { recomputePersonStatuses } from "@/lib/status/recompute";
import {
  planMerge,
  planUnmerge,
  type MergeConnection,
  type MergeDuplicateCandidateRow,
  type MergeIdMapRow,
  type MergePersonFields,
  type MergeReferenceRow,
  type MergeSnapshot,
} from "@/lib/identity/merge";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toMergeFields(row: typeof person.$inferSelect): MergePersonFields {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    emailNormalized: row.emailNormalized,
    emailStatus: row.emailStatus as MergePersonFields["emailStatus"],
    emailConfidence: row.emailConfidence,
    emailSource: row.emailSource,
    company: row.company,
    companyKey: row.companyKey,
    companyCategory: row.companyCategory,
    jobTitle: row.jobTitle,
    roleGroup: row.roleGroup,
    seniority: row.seniority,
    industry: row.industry,
    city: row.city,
    region: row.region,
    country: row.country,
    ownerBdId: row.ownerBdId,
    sourceKey: row.sourceKey,
  };
}

function toMergeConnection(row: typeof personBdConnection.$inferSelect): MergeConnection {
  return {
    personId: row.personId,
    bdId: row.bdId,
    connectedOn: row.connectedOn,
    legacyContactId: row.legacyContactId,
    messageCount: row.messageCount,
    sentCount: row.sentCount,
    receivedCount: row.receivedCount,
    firstMessageAt: row.firstMessageAt,
    lastMessageAt: row.lastMessageAt,
    initiatedByMe: row.initiatedByMe,
    reciprocal: row.reciprocal,
  };
}

async function readReferencesOnPerson(tx: DbTransaction, personId: string): Promise<MergeReferenceRow[]> {
  const [activityRows, taskRows, signalRows] = await Promise.all([
    tx.select({ id: activity.id }).from(activity).where(eq(activity.personId, personId)),
    tx.select({ id: task.id }).from(task).where(eq(task.personId, personId)),
    tx.select({ id: signal.id }).from(signal).where(eq(signal.personId, personId)),
  ]);
  return [
    ...activityRows.map((r) => ({ table: "activity" as const, id: r.id })),
    ...taskRows.map((r) => ({ table: "task" as const, id: r.id })),
    ...signalRows.map((r) => ({ table: "signal" as const, id: r.id })),
  ];
}

async function readIdMapRowsOnPerson(tx: DbTransaction, personId: string): Promise<MergeIdMapRow[]> {
  const rows = await tx
    .select({ legacyTable: personIdMap.legacyTable, legacyId: personIdMap.legacyId })
    .from(personIdMap)
    .where(eq(personIdMap.personId, personId));
  return rows.map((r) => ({ legacyTable: r.legacyTable as "contact" | "lead", legacyId: r.legacyId }));
}

async function readDuplicateCandidatesInvolving(tx: DbTransaction, personId: string): Promise<MergeDuplicateCandidateRow[]> {
  const rows = await tx
    .select()
    .from(duplicateCandidate)
    .where(or(eq(duplicateCandidate.personAId, personId), eq(duplicateCandidate.personBId, personId)));
  return rows.map((r) => ({ id: r.id, personAId: r.personAId, personBId: r.personBId, status: r.status }));
}

async function readSurvivorPairedPersonIds(tx: DbTransaction, survivorId: string, mergedId: string): Promise<string[]> {
  const rows = await tx
    .select({ personAId: duplicateCandidate.personAId, personBId: duplicateCandidate.personBId })
    .from(duplicateCandidate)
    .where(or(eq(duplicateCandidate.personAId, survivorId), eq(duplicateCandidate.personBId, survivorId)));
  return rows
    .map((r) => (r.personAId === survivorId ? r.personBId : r.personAId))
    .filter((id) => id !== mergedId);
}

async function repointReferences(tx: DbTransaction, refs: readonly MergeReferenceRow[], toPersonId: string): Promise<void> {
  const activityIds = refs.filter((r) => r.table === "activity").map((r) => r.id);
  const taskIds = refs.filter((r) => r.table === "task").map((r) => r.id);
  const signalIds = refs.filter((r) => r.table === "signal").map((r) => r.id);
  if (activityIds.length) await tx.update(activity).set({ personId: toPersonId }).where(inArray(activity.id, activityIds));
  if (taskIds.length) await tx.update(task).set({ personId: toPersonId }).where(inArray(task.id, taskIds));
  if (signalIds.length) await tx.update(signal).set({ personId: toPersonId }).where(inArray(signal.id, signalIds));
}

async function repointIdMapRows(tx: DbTransaction, rows: readonly MergeIdMapRow[], toPersonId: string): Promise<void> {
  for (const row of rows) {
    await tx
      .update(personIdMap)
      .set({ personId: toPersonId })
      .where(and(eq(personIdMap.legacyTable, row.legacyTable), eq(personIdMap.legacyId, row.legacyId)));
  }
}

/**
 * Task 6.1: folds `mergedId` into `survivorId` in one transaction. Refuses
 * (throws, rolling back) if either person is missing or already merged —
 * `SELECT ... FOR UPDATE` on both rows also guards against a concurrent
 * merge of the same person racing this one. Recomputes the survivor's
 * status in the same transaction (the 5b hook `recompute.ts` documents).
 */
export async function mergeContacts(
  database: typeof db,
  survivorId: string,
  mergedId: string,
  reason: string,
  actorBdId: string,
): Promise<{ mergeEventId: string }> {
  if (survivorId === mergedId) throw new Error("Cannot merge a person into itself");

  return database.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(person)
      .where(inArray(person.id, [survivorId, mergedId]))
      .for("update");
    const survivorRow = rows.find((r) => r.id === survivorId);
    const mergedRow = rows.find((r) => r.id === mergedId);
    if (!survivorRow || !mergedRow) throw new Error("Merge refused: survivor or merged person not found");
    if (survivorRow.mergedIntoId) throw new Error("Merge refused: survivor is already merged into another person");
    if (mergedRow.mergedIntoId) throw new Error("Merge refused: merged person is already merged into another person");

    const [survivorConnections, mergedConnections, referencesOnMerged, idMapRowsOnMerged, duplicateCandidatesInvolvingMerged, survivorPairedPersonIds] =
      await Promise.all([
        tx.select().from(personBdConnection).where(eq(personBdConnection.personId, survivorId)),
        tx.select().from(personBdConnection).where(eq(personBdConnection.personId, mergedId)),
        readReferencesOnPerson(tx, mergedId),
        readIdMapRowsOnPerson(tx, mergedId),
        readDuplicateCandidatesInvolving(tx, mergedId),
        readSurvivorPairedPersonIds(tx, survivorId, mergedId),
      ]);

    const plan = planMerge({
      survivor: toMergeFields(survivorRow),
      merged: toMergeFields(mergedRow),
      survivorConnections: survivorConnections.map(toMergeConnection),
      mergedConnections: mergedConnections.map(toMergeConnection),
      referencesOnMerged,
      idMapRowsOnMerged,
      duplicateCandidatesInvolvingMerged,
      survivorPairedPersonIds,
    });

    await tx
      .update(person)
      .set({ ...plan.survivorUpdate, updatedAt: new Date() })
      .where(eq(person.id, survivorId));
    await tx.update(person).set({ mergedIntoId: survivorId }).where(eq(person.id, mergedId));

    for (const c of plan.connectionsToDrop) {
      await tx.delete(personBdConnection).where(and(eq(personBdConnection.personId, mergedId), eq(personBdConnection.bdId, c.bdId)));
    }
    for (const c of plan.connectionsToRepoint) {
      await tx
        .update(personBdConnection)
        .set({ personId: survivorId })
        .where(and(eq(personBdConnection.personId, mergedId), eq(personBdConnection.bdId, c.bdId)));
    }

    await repointReferences(tx, plan.referencesToRepoint, survivorId);
    await repointIdMapRows(tx, plan.idMapRowsToRepoint, survivorId);

    for (const id of plan.duplicateCandidatesToDrop) {
      await tx.delete(duplicateCandidate).where(eq(duplicateCandidate.id, id));
    }
    for (const pair of plan.duplicateCandidatesToRepoint) {
      await tx
        .update(duplicateCandidate)
        .set({ personAId: pair.personAId, personBId: pair.personBId })
        .where(eq(duplicateCandidate.id, pair.id));
    }
    if (plan.duplicateCandidateToMarkMerged) {
      await tx
        .update(duplicateCandidate)
        .set({ status: "merged", decidedByBdId: actorBdId, decidedAt: new Date() })
        .where(eq(duplicateCandidate.id, plan.duplicateCandidateToMarkMerged));
    }

    const [inserted] = await tx
      .insert(mergeEvent)
      .values({ survivorId, mergedId, reason, actorBdId, snapshot: plan.snapshot })
      .returning({ id: mergeEvent.id });

    await tx.insert(auditLog).values({
      actorBdId,
      action: "merge",
      personId: survivorId,
      metadata: { mergeEventId: inserted.id },
    });

    await recomputePersonStatuses(tx, [survivorId]);

    return { mergeEventId: inserted.id };
  });
}

/**
 * Task 6.2: replays a `merge_event` snapshot in reverse, no time limit
 * (duplicate-review spec "Unmerge available regardless of merge age").
 * References/id-map rows created AFTER the merge (not present in the frozen
 * snapshot) stay on the survivor — see planUnmerge's doc comment for why
 * this is the chosen minimal-safe interpretation.
 */
export async function unmergeContact(database: typeof db, mergeEventId: string, actorBdId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [event] = await tx.select().from(mergeEvent).where(eq(mergeEvent.id, mergeEventId)).for("update");
    if (!event) throw new Error("Unmerge refused: merge_event not found");
    if (event.undoneAt) throw new Error("Unmerge refused: this merge was already undone");

    const snapshot = event.snapshot as unknown as MergeSnapshot;
    const plan = planUnmerge(snapshot);

    await tx
      .update(person)
      .set({ ...plan.survivorRestore, updatedAt: new Date() })
      .where(eq(person.id, event.survivorId));
    await tx
      .update(person)
      .set({ ...plan.mergedRestore, mergedIntoId: null, updatedAt: new Date() })
      .where(eq(person.id, event.mergedId));

    if (plan.survivorBdIdsToRemove.length) {
      await tx
        .delete(personBdConnection)
        .where(
          and(eq(personBdConnection.personId, event.survivorId), inArray(personBdConnection.bdId, [...plan.survivorBdIdsToRemove])),
        );
    }
    for (const c of plan.mergedConnectionsRestore) {
      await tx
        .insert(personBdConnection)
        .values({ ...c, personId: event.mergedId })
        .onConflictDoUpdate({
          target: [personBdConnection.personId, personBdConnection.bdId],
          set: {
            connectedOn: c.connectedOn,
            legacyContactId: c.legacyContactId,
            messageCount: c.messageCount,
            sentCount: c.sentCount,
            receivedCount: c.receivedCount,
            firstMessageAt: c.firstMessageAt,
            lastMessageAt: c.lastMessageAt,
            initiatedByMe: c.initiatedByMe,
            reciprocal: c.reciprocal,
          },
        });
    }

    await repointReferences(tx, plan.referencesToRepointBack, event.mergedId);
    await repointIdMapRows(tx, plan.idMapRowsToRepointBack, event.mergedId);

    for (const c of plan.duplicateCandidatesToRestore) {
      await tx
        .update(duplicateCandidate)
        .set({ personAId: c.personAId, personBId: c.personBId, status: c.status })
        .where(eq(duplicateCandidate.id, c.id));
    }
    if (plan.mergedPairCandidateToReopen) {
      await tx
        .update(duplicateCandidate)
        .set({ status: plan.mergedPairCandidateToReopen.originalStatus, decidedByBdId: null, decidedAt: null })
        .where(eq(duplicateCandidate.id, plan.mergedPairCandidateToReopen.id));
    }

    await tx.update(mergeEvent).set({ undoneAt: new Date(), undoneBy: actorBdId }).where(eq(mergeEvent.id, mergeEventId));
    await tx.insert(auditLog).values({
      actorBdId,
      action: "unmerge",
      personId: event.survivorId,
      metadata: { mergeEventId },
    });

    await recomputePersonStatuses(tx, [event.survivorId, event.mergedId]);
  });
}

/**
 * Task 6.3: dismisses a possible-duplicate pair (duplicate-review spec
 * "Not-a-duplicate path") — the pair never resurfaces because every
 * candidate-creating path (matcher/resolver/catch-up) inserts via
 * `ON CONFLICT DO NOTHING` on the unique (person_a_id, person_b_id) pair,
 * so a `not_duplicate` row already blocks re-insertion; this just records
 * the decision.
 */
export async function markNotDuplicate(database: typeof db, pairId: string, actorBdId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [updated] = await tx
      .update(duplicateCandidate)
      .set({ status: "not_duplicate", decidedByBdId: actorBdId, decidedAt: new Date() })
      .where(eq(duplicateCandidate.id, pairId))
      .returning({ id: duplicateCandidate.id });
    if (!updated) throw new Error("markNotDuplicate refused: pair not found");

    await tx.insert(auditLog).values({
      actorBdId,
      action: "not_duplicate",
      metadata: { duplicateCandidateId: pairId },
    });
  });
}
