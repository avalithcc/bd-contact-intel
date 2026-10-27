/**
 * Writes of follow-up-expiry: a BD's "Dar de baja del seguimiento" and the system's day-10 drop. Both only append an activity
 * (activityTypes.ts); neither touches `person.status`, the queue row or the owner. The queue and the badge stop showing the
 * contact because `openCycleRowSql` treats "a drop since the row was written" as the end of the cycle, and the selection keeps
 * it out until a newer touch (candidateQuery.ts).
 *
 * `executor` defaults to the app's `db`; the scratch-database tests pass a rolled-back transaction.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, followUpQueueItem, person } from "@/db/schema";
import { createActivityInTx } from "@/lib/activity/queries";
import { FOLLOW_UP_DROPPED_TYPE, FOLLOW_UP_EXPIRED_TYPE } from "@/lib/followUp/activityTypes";
import {
  FOLLOW_UP_EXPIRY_DAYS,
  buildDroppedMetadata,
  buildExpiredMetadata,
  type FollowUpDropReason,
} from "@/lib/followUp/cycle";
import { openCycleRowSql } from "@/lib/followUp/openCycle";
import { addDaysToDateString } from "@/lib/tasks/argentinaDate";

type Executor = Pick<typeof db, "transaction">;

/** Expiry looks back this far for items the job missed (a skipped run); older ones were dropped long ago or never shown. */
const EXPIRY_LOOKBACK_DAYS = 30;
/** One run never writes more than this many rows (rule: cap bulk operations); the next daily run takes the rest. */
export const EXPIRY_BATCH_CAP = 500;

export interface DropFollowUpInput {
  itemId: string;
  bdId: string;
  reason: FollowUpDropReason;
  detail: string | null;
}

/**
 * "Dar de baja del seguimiento". Scoped to the BD's own row, serialized on that row (a double click drops once), and a no-op
 * when the cycle is already over (dropped, worked or expired): `{ dropped: false }`.
 */
export async function dropFollowUp(input: DropFollowUpInput, executor: Executor = db): Promise<{ dropped: boolean }> {
  return executor.transaction(async (tx) => {
    const [item] = await tx
      .select({
        personId: followUpQueueItem.personId,
        cycleStartedOn: followUpQueueItem.cycleStartedOn,
        open: sql<boolean>`${openCycleRowSql()}`,
        status: person.status,
      })
      .from(followUpQueueItem)
      .innerJoin(person, eq(person.id, followUpQueueItem.personId))
      .where(and(eq(followUpQueueItem.id, input.itemId), eq(followUpQueueItem.bdId, input.bdId)))
      .for("update", { of: followUpQueueItem });
    if (!item || !item.cycleStartedOn || !Boolean(item.open)) return { dropped: false };
    await createActivityInTx(tx, {
      personId: item.personId,
      actorBdId: input.bdId,
      type: FOLLOW_UP_DROPPED_TYPE,
      metadata: buildDroppedMetadata({ reason: input.reason, detail: input.detail, cycleStartedOn: item.cycleStartedOn, status: item.status }),
    });
    return { dropped: true };
  });
}

/**
 * The daily job: every open item whose cycle began `FOLLOW_UP_EXPIRY_DAYS` or more days before `today` (an ART date) gets one
 * `follow_up_expired` activity with no actor. Idempotent (an expired item is no longer open), bounded, one transaction.
 * Returns how many were dropped.
 */
export async function expireOverdueFollowUps(
  today: string,
  executor: Executor = db,
  options: { dryRun?: boolean } = {},
): Promise<number> {
  return executor.transaction(async (tx) => {
    const due = await tx
      .select({
        id: followUpQueueItem.id,
        personId: followUpQueueItem.personId,
        cycleStartedOn: followUpQueueItem.cycleStartedOn,
        status: person.status,
      })
      .from(followUpQueueItem)
      .innerJoin(person, eq(person.id, followUpQueueItem.personId))
      .where(
        and(
          sql`${followUpQueueItem.cycleStartedOn} <= ${addDaysToDateString(today, -FOLLOW_UP_EXPIRY_DAYS)}::date`,
          sql`${followUpQueueItem.cycleStartedOn} > ${addDaysToDateString(today, -EXPIRY_LOOKBACK_DAYS)}::date`,
          openCycleRowSql(),
        ),
      )
      .limit(EXPIRY_BATCH_CAP);
    // One expiry per contact even if a merge left it two open rows.
    const perPerson = [...new Map(due.map((d) => [d.personId, d])).values()];
    if (perPerson.length === 0 || options.dryRun) return perPerson.length;
    await tx.insert(activity).values(
      perPerson.map((d) => ({
        personId: d.personId,
        type: FOLLOW_UP_EXPIRED_TYPE,
        metadata: buildExpiredMetadata(d.cycleStartedOn!, today, d.status),
      })),
    );
    return perPerson.length;
  });
}
