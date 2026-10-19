/**
 * "Reuniones agendadas" (status 'scheduled', dated by scheduled_at) next to "Reuniones realizadas" (meeting_logged, dated by
 * metadata.at) on /admin/reports, against a scratch Postgres (`npm run test:db`, a loopback *_e2e database; fail-closed). The
 * data is committed (the report reads through the pool, not a transaction) and scoped to one throwaway BD (the BD filter).
 * Tests run in file order and share state on purpose: they follow one meeting through its life.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const NOW = new Date("2026-10-19T14:00:00Z"); // Monday 11:00 ART: when the meetings are registered
const TODAY = new Date("2026-10-22T15:00:00Z"); // Thursday 12:00 ART: when the report is read
const TITLES = { no_show: "no show", cancelled: "cancelled" };
let bdId: string;
let otherBdId: string;
let contactA: string;
let contactB: string;
let meetingA: string;
let meetingB: string;

before(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Sched", email: `zz-sched-${run}@example.test` }).returning();
  const [o] = await db.insert(bd).values({ name: "ZZ Sched other", email: `zz-sched-o-${run}@example.test` }).returning();
  bdId = b!.id;
  otherBdId = o!.id;
  const mk = async (name: string) => {
    const email = `${name}-${run}@reports.test`;
    const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, ownerBdId: bdId }).returning();
    return p!.id;
  };
  contactA = await mk("sched-a");
  contactB = await mk("sched-b");
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(person).where(inArray(person.id, [contactA, contactB])); // cascades meeting and activity
  await db.delete(bd).where(inArray(bd.id, [bdId, otherBdId]));
  await db.$client.end();
});

async function figures(period: Parameters<typeof import("@/lib/reports/period").reportPeriodRange>[0], forBd: string | null = bdId) {
  const { reportPeriodRange } = await import("@/lib/reports/period");
  const { getMeetingsDrilldown, getReportAggregates, getReportPerBd } = await import("@/lib/reports/queriesDb");
  const range = reportPeriodRange(period, TODAY);
  const agg = await getReportAggregates({ fromIso: range.fromIso, toIso: range.toIso, scheduledToIso: range.endIso, bdId: forBd });
  const perBd = await getReportPerBd({ fromIso: range.fromIso, toIso: range.toIso, fromDate: range.fromDate, toDateExclusive: range.toDateExclusive, bdId: forBd });
  const drill = await getMeetingsDrilldown({ fromIso: range.fromIso, toIso: range.toIso, bdId: forBd });
  return {
    scheduled: agg.meetingsScheduled,
    held: perBd.find((r) => r.bdId === bdId)?.meetings ?? 0,
    heldAt: drill.map((r) => r.meetingAt.toISOString()),
  };
}

test("a scheduled meeting in the period counts as agendada and not as realizada", async () => {
  const { registerContactMeeting } = await import("@/lib/meetings/db");
  const r = await registerContactMeeting(contactA, bdId, "2026-10-21", "11:00", "Demo", NOW);
  meetingA = r.meetingId;
  assert.equal(r.kind, "scheduled");
  assert.deepEqual(await figures("month"), { scheduled: 1, held: 0, heldAt: [] });
  assert.equal((await figures("last_month")).scheduled, 0, "outside the period");
  assert.equal((await figures("month", otherBdId)).scheduled, 0, "the BD filter applies to the meeting's owner");
});

test("after 'Se hizo' it leaves agendadas and counts as realizada, dated at the meeting time", async () => {
  const { applyMeetingOutcome } = await import("@/lib/meetings/db");
  await applyMeetingOutcome(meetingA, bdId, { outcome: "held", notes: "ok" }, TITLES, new Date("2026-10-21T20:00:00Z"));
  assert.deepEqual(await figures("month"), { scheduled: 0, held: 1, heldAt: ["2026-10-21T14:00:00.000Z"] });
});

test("a rescheduled meeting counts once, with its new date", async () => {
  const { applyMeetingOutcome, registerContactMeeting } = await import("@/lib/meetings/db");
  const b = await registerContactMeeting(contactB, bdId, "2026-10-23", "10:00", "Demo", NOW);
  meetingB = b.meetingId;
  assert.equal((await figures("week")).scheduled, 1, "Oct 23 is inside the Oct 19-25 week");
  const r = await applyMeetingOutcome(meetingB, bdId, { outcome: "rescheduled", newDate: "2026-10-27", newTime: "10:00" }, TITLES, NOW);
  assert.ok(r.nextMeetingId);
  assert.equal((await figures("month")).scheduled, 1, "the old row is 'rescheduled': one meeting, not two");
  assert.equal((await figures("week")).scheduled, 0, "the new date is next week; the old one no longer counts");
  assert.equal((await figures("month")).held, 1, "a reschedule is not a held meeting");
});
