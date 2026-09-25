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
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { db } from "@/db";
import {
  activity,
  auditLog,
  duplicateCandidate,
  mergeEvent,
  person,
  personBdConnection,
  personIdMap,
  personPropertyHistory,
  signal,
  task,
} from "@/db/schema";
import { recomputePersonStatuses } from "@/lib/status/recompute";
import {
  parseMergeSnapshot,
  planMerge,
  planUnmerge,
  type MergeConnection,
  type MergeDuplicateCandidateRow,
  type MergeIdMapRow,
  type MergePersonFields,
  type MergeReferenceRow,
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

/** Column set for a connection's mutable (non-identity) fields, used by both merge-time aggregation and unmerge-time restores. */
function connectionValueColumns(c: MergeConnection) {
  return {
    connectedOn: c.connectedOn,
    legacyContactId: c.legacyContactId,
    messageCount: c.messageCount,
    sentCount: c.sentCount,
    receivedCount: c.receivedCount,
    firstMessageAt: c.firstMessageAt,
    lastMessageAt: c.lastMessageAt,
    initiatedByMe: c.initiatedByMe,
    reciprocal: c.reciprocal,
  };
}

/**
 * Fresh-review fix (chained same-BD merges): bdIds where a LATER, still-in-effect
 * merge_event on this survivor recorded a same-BD conflict. Used so an
 * unmerge of an EARLIER merge that moved that bdId cleanly (no conflict at the
 * time) doesn't drag along a row that a subsequent merge has since aggregated
 * onto — that row now belongs to the later merge's history and must stay on
 * the survivor. Undone later merges are excluded: if that conflict was itself
 * unwound, it no longer blocks this bdId from moving back.
 */
async function readLaterConflictBdIds(tx: DbTransaction, survivorId: string, afterCreatedAt: Date, excludeMergeEventId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: mergeEvent.id, snapshot: mergeEvent.snapshot })
    .from(mergeEvent)
    .where(and(eq(mergeEvent.survivorId, survivorId), gt(mergeEvent.createdAt, afterCreatedAt), isNull(mergeEvent.undoneAt)));
  const bdIds = new Set<string>();
  for (const row of rows) {
    if (row.id === excludeMergeEventId) continue;
    const laterSnapshot = parseMergeSnapshot(row.snapshot);
    for (const conflict of laterSnapshot.connectionConflicts) bdIds.add(conflict.bdId);
  }
  return [...bdIds];
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

    for (const c of plan.connectionsToRepoint) {
      await tx
        .update(personBdConnection)
        .set({ personId: survivorId })
        .where(and(eq(personBdConnection.personId, mergedId), eq(personBdConnection.bdId, c.bdId)));
    }
    // Same-BD conflicts: aggregate onto survivor's row (never drop either side's facts), then drop merged's now-folded-in row.
    for (const conflict of plan.connectionConflicts) {
      await tx
        .update(personBdConnection)
        .set(connectionValueColumns(conflict.aggregated))
        .where(and(eq(personBdConnection.personId, survivorId), eq(personBdConnection.bdId, conflict.bdId)));
      await tx
        .delete(personBdConnection)
        .where(and(eq(personBdConnection.personId, mergedId), eq(personBdConnection.bdId, conflict.bdId)));
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

    if (plan.snapshot.survivorFieldChanges.length) {
      await tx.insert(personPropertyHistory).values(
        plan.snapshot.survivorFieldChanges.map((c) => ({
          personId: survivorId,
          property: c.field,
          oldValue: c.before == null ? null : String(c.before),
          newValue: c.after == null ? null : String(c.after),
          changedByBdId: actorBdId,
          source: "merge",
        })),
      );
    }

    await recomputePersonStatuses(tx, [survivorId]);

    return { mergeEventId: inserted.id };
  });
}

/**
 * Task 6.2 + fresh-review safe-unmerge fix: replays a `merge_event` snapshot
 * in reverse, no time limit (duplicate-review spec "Unmerge available
 * regardless of merge age"). Only reverts a survivor field or same-BD
 * connection conflict when its CURRENT value still equals what the merge
 * wrote (see planUnmerge's doc comment) — anything changed since (a later
 * merge, a manual edit, new messages) is kept, not silently overwritten.
 * The merged person's row and its non-conflicting connections are always
 * restored fully (it was hidden the whole time). References/id-map rows
 * created AFTER the merge (not present in the frozen snapshot) stay on the
 * survivor — the chosen minimal-safe interpretation.
 */
export async function unmergeContact(database: typeof db, mergeEventId: string, actorBdId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [event] = await tx.select().from(mergeEvent).where(eq(mergeEvent.id, mergeEventId)).for("update");
    if (!event) throw new Error("Unmerge refused: merge_event not found");
    if (event.undoneAt) throw new Error("Unmerge refused: this merge was already undone");

    const snapshot = parseMergeSnapshot(event.snapshot);

    const [survivorRow] = await tx.select().from(person).where(eq(person.id, event.survivorId)).for("update");
    if (!survivorRow) throw new Error("Unmerge refused: survivor not found");

    const relevantBdIds = [...new Set([...snapshot.movedConnectionBdIds, ...snapshot.connectionConflicts.map((c) => c.bdId)])];
    const [currentSurvivorConnectionRows, laterConflictBdIds] = await Promise.all([
      relevantBdIds.length
        ? tx
            .select()
            .from(personBdConnection)
            .where(and(eq(personBdConnection.personId, event.survivorId), inArray(personBdConnection.bdId, relevantBdIds)))
        : Promise.resolve([]),
      readLaterConflictBdIds(tx, event.survivorId, event.createdAt, mergeEventId),
    ]);
    const currentSurvivorConnections = currentSurvivorConnectionRows.map(toMergeConnection);

    const plan = planUnmerge(snapshot, {
      currentSurvivor: toMergeFields(survivorRow),
      currentSurvivorConnections,
      laterConflictBdIds,
    });

    if (plan.survivorFieldReverts.length) {
      const set: Record<string, string | number | null> = {};
      for (const r of plan.survivorFieldReverts) set[r.field] = r.to;
      await tx
        .update(person)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(person.id, event.survivorId));
    }
    await tx
      .update(person)
      .set({ ...plan.mergedRestore, mergedIntoId: null, updatedAt: new Date() })
      .where(eq(person.id, event.mergedId));

    // Moved connections (no conflict): repoint personId back onto merged, keeping their CURRENT values — never delete+reinsert.
    if (plan.movedConnectionBdIdsBack.length) {
      await tx
        .update(personBdConnection)
        .set({ personId: event.mergedId })
        .where(
          and(eq(personBdConnection.personId, event.survivorId), inArray(personBdConnection.bdId, [...plan.movedConnectionBdIdsBack])),
        );
    }

    // Chained same-BD merge (fresh-review fix): a LATER merge conflicted on
    // this bdId, so the row now belongs to that later merge's history and
    // stays on the survivor untouched. Re-create merged's original row instead
    // of moving the (now-aggregated) survivor row back.
    for (const kept of plan.movedConnectionsKeptOnSurvivor) {
      await tx
        .insert(personBdConnection)
        .values({ ...kept.mergedRestore, personId: event.mergedId })
        .onConflictDoUpdate({
          target: [personBdConnection.personId, personBdConnection.bdId],
          set: connectionValueColumns(kept.mergedRestore),
        });
    }

    // Same-BD conflicts: revert survivor's row only if untouched since the merge; merged's original row is always restored.
    for (const restore of plan.connectionConflictRestores) {
      if (restore.kind === "reverted" && restore.survivorRestore) {
        await tx
          .update(personBdConnection)
          .set(connectionValueColumns(restore.survivorRestore))
          .where(and(eq(personBdConnection.personId, event.survivorId), eq(personBdConnection.bdId, restore.bdId)));
      }
      await tx
        .insert(personBdConnection)
        .values({ ...restore.mergedRestore, personId: event.mergedId })
        .onConflictDoUpdate({
          target: [personBdConnection.personId, personBdConnection.bdId],
          set: connectionValueColumns(restore.mergedRestore),
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

    if (plan.survivorFieldReverts.length) {
      await tx.insert(personPropertyHistory).values(
        plan.survivorFieldReverts.map((r) => ({
          personId: event.survivorId,
          property: r.field,
          oldValue: r.from == null ? null : String(r.from),
          newValue: r.to == null ? null : String(r.to),
          changedByBdId: actorBdId,
          source: "unmerge",
        })),
      );
    }

    await recomputePersonStatuses(tx, [event.survivorId, event.mergedId]);
  });
}

/**
 * Task 6.3 + fresh-review WARNING 4: dismisses a possible-duplicate pair
 * (duplicate-review spec "Not-a-duplicate path") — the pair never resurfaces
 * because every candidate-creating path (matcher/resolver/catch-up) inserts
 * via `ON CONFLICT DO NOTHING` on the unique (person_a_id, person_b_id)
 * pair, so a `not_duplicate` row already blocks re-insertion. Guarded to
 * only transition `status='open'` -> `'not_duplicate'`: a conditional
 * update that refuses (zero rows updated) if the pair is missing or was
 * already decided (`merged`/`not_duplicate`), instead of silently
 * clobbering an existing decision.
 */
export async function markNotDuplicate(database: typeof db, pairId: string, actorBdId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [updated] = await tx
      .update(duplicateCandidate)
      .set({ status: "not_duplicate", decidedByBdId: actorBdId, decidedAt: new Date() })
      .where(and(eq(duplicateCandidate.id, pairId), eq(duplicateCandidate.status, "open")))
      .returning({ id: duplicateCandidate.id });
    if (!updated) throw new Error("markNotDuplicate refused: pair not found or not open");

    await tx.insert(auditLog).values({
      actorBdId,
      action: "not_duplicate",
      metadata: { duplicateCandidateId: pairId },
    });
  });
}
