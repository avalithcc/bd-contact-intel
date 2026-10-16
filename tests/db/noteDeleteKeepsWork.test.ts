/**
 * Deleting a note is text cleanup, not a verdict on the work: the BD still touched the contact and still worked the queue.
 * So the two reads with consequences beyond display (the owner rule's evidence and "worked today", in the badge and in the
 * report) keep counting a deleted note, while the display reads (timeline counts, "Última actividad") ignore it.
 * Opt-in and fail-closed like the other files here (`npm run test:db`, a loopback *_e2e database).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const QUEUE_DATE = "2026-09-10";
const NOTE_AT = new Date("2026-09-10T15:00:00Z"); // inside the 03:00Z..03:00Z+1d window of QUEUE_DATE
let bdId: string;
let personId: string;
let noteId: string;

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, followUpQueueItem, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Keeps", email: `zz-keeps-${run}@example.test` }).returning();
  bdId = b!.id;
  const [p] = await db.insert(person).values({ firstName: "Keeps", lastName: run, email: `keeps-${run}@prospect.test`, emailNormalized: `keeps-${run}@prospect.test`, ownerBdId: bdId, status: "contacted" }).returning();
  personId = p!.id;
  const [n] = await db.insert(activity).values({ personId, actorBdId: bdId, type: "note", metadata: { note: "wrong contact" }, createdAt: NOTE_AT }).returning();
  noteId = n!.id;
  await db.insert(followUpQueueItem).values({ bdId, personId, queueDate: QUEUE_DATE, position: 1, dueStatus: "due", lastTouchAt: new Date("2026-09-01T00:00:00Z"), state: "pending" });
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.id, personId)); // cascades activity and queue items
  await db.delete(bd).where(eq(bd.id, bdId));
});

async function badgeFollowUpCount() {
  const { db } = await import("@/db");
  const { buildAppShellBadgeCountsQuery } = await import("@/lib/shell/appShellBadgeCountsQuery");
  const rows = Array.from(
    await db.execute(
      buildAppShellBadgeCountsQuery({ bdId, queueDate: QUEUE_DATE, tomorrowStartUtcIso: "2026-09-11T00:00:00Z", workedTodayFromIso: "2026-09-10T03:00:00Z", workedTodayToIso: "2026-09-11T03:00:00Z" }),
    ),
  ) as { follow_up_count: number }[];
  return Number(rows[0]!.follow_up_count);
}

async function reportQueueWorked() {
  const { db } = await import("@/db");
  const { buildReportPerBdQuery } = await import("@/lib/reports/queries");
  const rows = Array.from(
    await db.execute(buildReportPerBdQuery({ fromIso: "2026-09-01T00:00:00Z", toIso: "2026-10-01T00:00:00Z", fromDate: QUEUE_DATE, toDateExclusive: "2026-09-11", bdId })),
  ) as { bd_id: string; queue_worked: number; queue_still_pending: number; notes: number }[];
  const mine = rows.find((r) => r.bd_id === bdId)!;
  return { worked: Number(mine.queue_worked), pending: Number(mine.queue_still_pending), notes: Number(mine.notes) };
}

/** The follow-up queue's staleness clock: -infinity means "never touched", so the contact is as cold as it was. */
async function followUpClockIsUntouched() {
  const { db } = await import("@/db");
  const { fuqCandidatesCte } = await import("@/lib/followUp/candidateQuery");
  const { sql } = await import("drizzle-orm");
  const rows = Array.from(
    await db.execute(sql`with ${fuqCandidatesCte()} select (fuq_last_touch = timestamptz '-infinity') as untouched from fuq_candidate where fuq_person_id = ${personId}::uuid`),
  ) as { untouched: boolean }[];
  return rows[0]!.untouched;
}

test("before deleting: the note counts as work (badge 0 due, report worked 1) and as ownership evidence", async () => {
  assert.equal(await badgeFollowUpCount(), 0);
  assert.deepEqual(await reportQueueWorked(), { worked: 1, pending: 0, notes: 1 });
  assert.equal(await followUpClockIsUntouched(), false);
});

test("after deleting: worked-today is unchanged in the badge and the report, and the owner evidence survives", async () => {
  const { softDeleteContactNote } = await import("@/lib/activity/noteDeleteDb");
  const { readOwnerTouches } = await import("@/lib/identity/ownerRuleDb");
  const { db } = await import("@/db");
  await softDeleteContactNote({ id: bdId, role: "bd" }, noteId);

  assert.equal(await badgeFollowUpCount(), 0, "deleting today's note must not put the contact back in the badge");
  assert.deepEqual(await reportQueueWorked(), { worked: 1, pending: 0, notes: 1 }, "the per-BD note KPI agrees with queue_worked: the BD did write it");
  assert.equal(await followUpClockIsUntouched(), true, "the follow-up queue asks 'is this contact stale?': a mis-filed note is no evidence it is not");

  const touches = await readOwnerTouches(db, [personId]);
  assert.equal(touches.length, 1, "the BD's only touch was the deleted note: the evidence stays");
  assert.equal(touches[0]!.bdId, bdId);
  assert.equal(touches[0]!.at.getTime(), NOTE_AT.getTime());
});

test("the display side still ignores the deleted note", async () => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { effectiveActivityAtSql } = await import("@/lib/contacts/effectiveActivityTime");
  const { getPersonTimeline } = await import("@/lib/activity/queries");
  const { eq, sql } = await import("drizzle-orm");
  const [row] = await db.select({ at: sql<Date | string | null>`max(${effectiveActivityAtSql()})` }).from(activity).where(eq(activity.personId, personId));
  assert.equal(row!.at, null, "'Última actividad' no longer sees it");
  const page = await getPersonTimeline(personId, bdId);
  assert.equal(page.countsByType.note ?? 0, 0, "the pill count excludes it");
  assert.equal(page.entries.length, 1, "but the tombstone is still in the timeline");
  assert.ok(page.entries[0]!.deleted);
});
