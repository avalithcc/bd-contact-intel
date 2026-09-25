/**
 * Thin DB glue for design D4's status cache: recompute deriveStatus() for
 * one person from their real `activity` + `person_bd_connection` rows, and
 * write the result to `person.status`/`status_activity_id` when it changed.
 * Imports `db` (@/db has side effects requiring DATABASE_URL), so — same
 * convention as src/lib/identity/resolveDb.ts — this file is not
 * unit-tested directly; `activityRowToStatusEvent`/`connectionRowToStatusEvent`
 * and `deriveStatus` itself (src/lib/status/deriveStatus.ts) carry the
 * tested logic.
 *
 * TODO(Phase 6 — merge engine): `mergeContacts()` must call
 * `recomputePersonStatus(tx, survivorId)` after moving the merged person's
 * activities/connections onto the survivor, since a merge changes the
 * combined event set `deriveStatus()` sees for that person.
 */
import { asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { activity, person, personBdConnection } from "@/db/schema";
import {
  activityRowToStatusEvent,
  connectionRowToStatusEvent,
  deriveStatus,
  type StatusEvent,
} from "@/lib/status/deriveStatus";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Recomputes and, if it changed, writes `person.status`/`status_activity_id`
 * for one person, inside the caller's transaction — task 5.2's "same
 * transaction as every activity write" (createActivity, updateLeadStatus).
 * `status_activity_id` is only set when `because.source === "activity"`
 * (the column has no DB FK per design D4, but a connection-sourced status
 * has no single row to point at, so it's left null in that case).
 */
export async function recomputePersonStatus(tx: DbTransaction, personId: string): Promise<void> {
  const [activityRows, connectionRows] = await Promise.all([
    tx
      .select({ id: activity.id, type: activity.type, createdAt: activity.createdAt, metadata: activity.metadata })
      .from(activity)
      .where(eq(activity.personId, personId))
      .orderBy(asc(activity.createdAt)),
    tx
      .select({
        bdId: personBdConnection.bdId,
        sentCount: personBdConnection.sentCount,
        receivedCount: personBdConnection.receivedCount,
        lastMessageAt: personBdConnection.lastMessageAt,
      })
      .from(personBdConnection)
      .where(eq(personBdConnection.personId, personId)),
  ]);

  const events: StatusEvent[] = [
    ...activityRows.map(activityRowToStatusEvent),
    ...connectionRows.map(connectionRowToStatusEvent),
  ];
  const derived = deriveStatus(events);
  const statusActivityId = derived.because?.source === "activity" ? derived.because.activityId : null;

  await tx
    .update(person)
    .set({ status: derived.status, statusActivityId, updatedAt: new Date() })
    .where(eq(person.id, personId));
}
