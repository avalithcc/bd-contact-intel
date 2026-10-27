/**
 * Writes of follow-up-expiry: a BD's "Dar de baja del seguimiento" and the system's day-10 drop. Both only append an activity
 * (activityTypes.ts), inserted directly; neither touches `person` (status, cache or updated_at), the queue row or the owner. The queue and the badge stop showing the
 * contact because `openCycleRowSql` treats "a drop since the row was written" as the end of the cycle, and the selection keeps
 * it out until a newer touch (candidateQuery.ts).
 *
 * `executor` defaults to the app's `db`; the scratch-database tests pass a rolled-back transaction.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, followUpQueueItem, person } from "@/db/schema";
import { FOLLOW_UP_DROPPED_TYPE, FOLLOW_UP_EXPIRED_TYPE } from "@/lib/followUp/activityTypes";
import {
  FOLLOW_UP_EXPIRY_DAYS,
  buildDroppedMetadata,
  buildExpiredMetadata,
  cycleStage,
  daysInQueue,
  type FollowUpDropReason,
} from "@/lib/followUp/cycle";
import { EXPIRY_LOOKBACK_DAYS, openCycleRowSql } from "@/lib/followUp/openCycle";
import { addDaysToDateString } from "@/lib/tasks/argentinaDate";

type Executor = Pick<typeof db, "transaction">;

/** One run never writes more than this many rows (rule: cap bulk operations); the next daily run takes the rest. */
export const EXPIRY_BATCH_CAP = 500;

export interface DropFollowUpInput {
  itemId: string;
  bdId: string;
  reason: FollowUpDropReason;
  detail: string | null;
  /** The Argentina calendar date the BD acts on; only a Vencido (day 3-9 in the queue) can be dropped. */
  today: string;
}

/**
 * "Dar de baja del seguimiento". Scoped to the BD's own row. Two statements in one transaction, in this order on purpose: (1) lock
 * the row, (2) only then evaluate "is it still open". Evaluating `open` in the locking statement would read a snapshot taken before
 * a concurrent drop committed and write a second activity. The activity is inserted directly, not through `createActivityInTx`:
 * that path recomputes the person's cached status, and a drop must structurally be unable to touch `person`. A no-op
 * (`{ dropped: false }`) when the row is not the BD's, is not Vencido on `today`, or its cycle is already over.
 */
export async function dropFollowUp(input: DropFollowUpInput, executor: Executor = db): Promise<{ dropped: boolean }> {
  return executor.transaction(async (tx) => {
    const locked = await tx
      .select({ id: followUpQueueItem.id })
      .from(followUpQueueItem)
      .where(and(eq(followUpQueueItem.id, input.itemId), eq(followUpQueueItem.bdId, input.bdId)))
      .for("update");
    if (locked.length === 0) return { dropped: false };
    const [item] = await tx
      .select({
        personId: followUpQueueItem.personId,
        cycleStartedOn: followUpQueueItem.cycleStartedOn,
        open: sql<boolean>`${openCycleRowSql()}`,
        status: person.status,
      })
      .from(followUpQueueItem)
      .innerJoin(person, eq(person.id, followUpQueueItem.personId))
      .where(eq(followUpQueueItem.id, input.itemId));
    if (!item || !item.cycleStartedOn || !Boolean(item.open)) return { dropped: false };
    if (cycleStage(daysInQueue(item.cycleStartedOn, input.today)) !== "overdue") return { dropped: false };
    await tx.insert(activity).values({
      personId: item.personId,
      actorBdId: input.bdId,
      type: FOLLOW_UP_DROPPED_TYPE,
      metadata: buildDroppedMetadata({ reason: input.reason, detail: input.detail, cycleStartedOn: item.cycleStartedOn, status: item.status }),
    });
    return { dropped: true };
  });
}

/** Arbitrary constant key of the expiry job's transaction-level advisory lock (two runs never overlap). */
export const EXPIRY_LOCK_KEY = 7_204_001;

/**
 * The daily job: every open item whose cycle began `FOLLOW_UP_EXPIRY_DAYS` or more days before `today` (an ART date) gets one
 * `follow_up_expired` activity with no actor. The first statement takes an advisory lock, so a doubled or retried run waits for
 * the first to commit and then finds nothing to do (idempotent; an expired item is no longer open). Bounded, one transaction.
 * Returns how many were dropped.
 */
export async function expireOverdueFollowUps(
  today: string,
  executor: Executor = db,
  options: { dryRun?: boolean } = {},
): Promise<number> {
  return executor.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${EXPIRY_LOCK_KEY})`);
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
