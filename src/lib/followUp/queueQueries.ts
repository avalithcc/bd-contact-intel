/**
 * Thin DB layer for the per-BD daily follow-up queue — touches `@/db`, so
 * (unlike queueSelection.ts/candidateQuery.ts) this file needs a live
 * DATABASE_URL and is not unit-tested directly (same split as
 * src/lib/identity/resolveDb.ts vs. resolve.ts).
 *
 * The sidebar badge count used to live here (`getFollowUpQueueBadgeCount`)
 * but was folded into `src/lib/shell/appShellBadgeCounts.ts` (fresh-review
 * fix: AppLayout was running it as a SEPARATE round trip from the task
 * badge — see that module's doc comment) — deleted here rather than kept
 * as unused dead code.
 */
import { and, asc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, company, followUpQueueItem, person } from "@/db/schema";
import { addDaysToDateString, argentinaCalendarDate, argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";
import { WORKED_ACTIVITY_TYPES, workedTodayAtSql } from "@/lib/followUp/queueSelection";
import { buildFollowUpInsertQuery } from "@/lib/followUp/candidateQuery";

export interface FollowUpQueueRow {
  id: string;
  personId: string;
  position: number;
  state: "pending" | "postponed" | "skipped";
  dueStatus: "replied" | "contacted";
  lastTouchAt: Date;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyKey: string | null;
  companyName: string | null;
  workedToday: boolean;
}

/**
 * Correlated EXISTS ("worked today"), reused by both the page read and the
 * badge count — never a per-row query (rule 7). Uses
 * `workedTodayAtSql()` (queueSelection.ts), NOT the raw `activity.created_at`
 * (email-sync brief follow-up fix): for most types the raw log time IS the
 * right signal — a `call` logged today about an event from yesterday still
 * counts, since LOGGING it is the BD's action today — but a synced
 * `email_sent`/`reply_received` row's `created_at` is only when the
 * automated Gmail sync/backfill happened to run, not when the BD did
 * anything. `workedTodayAtSql()` redirects those two types to
 * `metadata.occurredAt` (the real send/receive time) while leaving `call`
 * and everything else on `created_at` — see its doc comment for the full
 * rationale.
 *
 * Fresh-review fix: this used to also require `activity.actorBdId = bdId`
 * (the viewing BD specifically). The approved decision is "ANY activity
 * logged on that contact today, by any BD" — a contact can be worked by a
 * teammate (e.g. covering while the owner is out) and it still counts, same
 * as every other "worked" signal in this app is contact-scoped, not
 * actor-scoped. `WORKED_ACTIVITY_TYPES` (queueSelection.ts) still gates
 * which activity types count.
 */
function workedTodayExists(now: Date) {
  const { todayStartUtc, tomorrowStartUtc } = argentinaDayBoundaries(now);
  const workedAt = workedTodayAtSql();
  return exists(
    db
      .select({ one: sql`1` })
      .from(activity)
      .where(
        and(
          eq(activity.personId, followUpQueueItem.personId),
          inArray(activity.type, [...WORKED_ACTIVITY_TYPES]),
          sql`${workedAt} >= ${todayStartUtc.toISOString()}::timestamptz`,
          sql`${workedAt} < ${tomorrowStartUtc.toISOString()}::timestamptz`,
        ),
      ),
  );
}

async function readQueueRows(bdId: string, queueDate: string, now: Date): Promise<FollowUpQueueRow[]> {
  const rows = await db
    .select({
      id: followUpQueueItem.id,
      personId: followUpQueueItem.personId,
      position: followUpQueueItem.position,
      state: followUpQueueItem.state,
      dueStatus: followUpQueueItem.dueStatus,
      lastTouchAt: followUpQueueItem.lastTouchAt,
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      companyKey: person.companyKey,
      companyName: company.displayName,
      workedToday: workedTodayExists(now),
    })
    .from(followUpQueueItem)
    .innerJoin(person, eq(person.id, followUpQueueItem.personId))
    .leftJoin(company, eq(company.companyKey, person.companyKey))
    .where(
      and(
        eq(followUpQueueItem.bdId, bdId),
        eq(followUpQueueItem.queueDate, queueDate),
        // Defense in depth: a person queued this morning could be merged
        // away later the same day (a duplicate cleanup can run any time) —
        // merged persons are hidden from every read in this app (design
        // D1/D6), including a day's already-materialized queue rows.
        isNull(person.mergedIntoId),
      ),
    )
    .orderBy(asc(followUpQueueItem.position));

  return rows.map((r) => ({
    ...r,
    state: r.state as FollowUpQueueRow["state"],
    dueStatus: r.dueStatus as FollowUpQueueRow["dueStatus"],
    workedToday: Boolean(r.workedToday),
  }));
}

/**
 * Race-safety: `pg_advisory_xact_lock(hashtextextended(bd_id || ':' ||
 * queue_date, 0))` serializes concurrent first-loads for the SAME (bd, day)
 * — the lock key is computed IN SQL from the two identifying values, so
 * there is no separate JS-side hash function that could drift from it. Two
 * tabs opening at once both call this; the first to acquire the lock
 * re-checks "does today's queue already have rows?" (the caller's own
 * pre-check, done before taking the lock, is only a fast-path hint — it can
 * be stale by the time the lock is granted) and, finding none, computes and
 * inserts the day's up-to-10 rows; the second waits, then acquires the same
 * lock, re-checks, finds the rows the first just committed, and no-ops. The
 * `ON CONFLICT (bd_id, queue_date, person_id) DO NOTHING` on the insert
 * itself (candidateQuery.ts) is the belt-and-suspenders backstop — without
 * the lock it alone would NOT be enough, since two concurrent computations
 * could each independently decide on a different top-10 (e.g. if
 * eligibility data changes between the two reads) and, combined, insert
 * more than 10 rows for the day; the lock guarantees only one computation
 * ever runs.
 */
export async function ensureTodayFollowUpQueue(bdId: string, now: Date): Promise<void> {
  const queueDate = argentinaCalendarDate(now);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bdId} || ':' || ${queueDate}, 0))`);
    const existing = await tx.execute(
      sql`select 1 from ${followUpQueueItem} where bd_id = ${bdId}::uuid and queue_date = ${queueDate}::date limit 1`,
    );
    if (existing.length > 0) return;
    await tx.execute(buildFollowUpInsertQuery(bdId, queueDate));
  });
}

/**
 * Read side of the follow-up queue page: a fast path that reads today's
 * already-materialized rows (the common case — one round trip); only on
 * the first view of the Argentina calendar day does it fall through to
 * `ensureTodayFollowUpQueue` (a few extra round trips, but this runs once
 * per BD per day, not once per page view) and re-reads.
 */
export async function getFollowUpQueuePage(bdId: string, now: Date): Promise<FollowUpQueueRow[]> {
  const queueDate = argentinaCalendarDate(now);
  const rows = await readQueueRows(bdId, queueDate, now);
  if (rows.length > 0) return rows;

  await ensureTodayFollowUpQueue(bdId, now);
  return readQueueRows(bdId, queueDate, now);
}

/**
 * "Posponer a mañana" / "Omitir hoy" (mockup README decision 5): both leave
 * today's active list without being counted as worked and without logging
 * an activity or needing a reason — the only difference is the `state`
 * value stored, kept for display/analytics. `snoozedUntil` is set to
 * tomorrow's ART calendar date either way — `buildFollowUpInsertQuery`
 * (candidateQuery.ts) excludes this person from selection on any day before
 * `snoozedUntil` arrives, then re-includes them once it does (still subject
 * to every other eligibility rule). Scoped to `bdId` too — defense in depth
 * against a BD acting on another BD's row via a guessed id.
 */
async function setFollowUpItemState(
  itemId: string,
  bdId: string,
  now: Date,
  state: "postponed" | "skipped",
): Promise<void> {
  const snoozedUntil = addDaysToDateString(argentinaCalendarDate(now), 1);
  await db
    .update(followUpQueueItem)
    .set({ state, snoozedUntil, updatedAt: now })
    .where(and(eq(followUpQueueItem.id, itemId), eq(followUpQueueItem.bdId, bdId)));
}

export function postponeFollowUpItem(itemId: string, bdId: string, now: Date): Promise<void> {
  return setFollowUpItemState(itemId, bdId, now, "postponed");
}

export function skipFollowUpItem(itemId: string, bdId: string, now: Date): Promise<void> {
  return setFollowUpItemState(itemId, bdId, now, "skipped");
}
