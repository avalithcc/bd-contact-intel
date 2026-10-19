/**
 * Review follow-ups for meeting-outcomes against a scratch database (migration 0054 applied): a caller that hides scheduling is
 * refused a future time, the backfill survives malformed `metadata.at`, only a meeting closed through the outcome flow can be
 * undone, and a held meeting is dated by when it happened. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local
 * `_e2e` database. Every test runs in one transaction rolled back by a sentinel throw.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

const ROLLBACK = new Error("rollback");
type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];

async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
  const { db } = await import("@/db");
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

const NOW = new Date("2026-10-22T15:00:00.000Z"); // 12:00 ART
const TITLES = { no_show: "a", cancelled: "b" };

async function seed(tx: Tx) {
  const { bd, person } = await import("@/db/schema");
  const [me] = await tx.insert(bd).values({ email: "zz-review-me@example.test", name: "ZZ Review" }).returning();
  const [contact] = await tx.insert(person).values({ firstName: "Ana" }).returning();
  return { me: me!, contact: contact! };
}

test("a caller that hides scheduling is refused a later-today time, and nothing is written", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { registerContactMeeting } = await import("@/lib/meetings/db");
    const { MeetingOccurredAtInFutureError, meetingErrorReason } = await import("@/lib/contacts/meeting");
    const { meeting } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await assert.rejects(
      () => registerContactMeeting(contact.id, me.id, "2026-10-22", "16:00", "", NOW, { database: tx, allowScheduling: false }),
      (e) => e instanceof MeetingOccurredAtInFutureError && meetingErrorReason(e) === "meeting_occurred_at_in_future",
    );
    assert.equal((await tx.select().from(meeting).where(eq(meeting.personId, contact.id))).length, 0);
    // A time that already passed still registers through the same caller.
    const ok = await registerContactMeeting(contact.id, me.id, "2026-10-22", "11:00", "", NOW, { database: tx, allowScheduling: false });
    assert.equal(ok.kind, "held");
  });
});

test("the backfill turns an impossible metadata.at into created_at instead of aborting the migration", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity, bd, person, meeting } = await import("@/db/schema");
    const { sql, eq } = await import("drizzle-orm");
    const [author] = await tx.insert(bd).values({ email: "zz-review-bf@example.test", name: "ZZ BF" }).returning();
    const cases: [string, string | null][] = [
      ["2026-02-30T10:00:00Z", null],
      ["2026-13-01T10:00:00Z", null],
      ["2026-04-31T10:00:00Z", null],
      ["2023-02-29T10:00:00Z", null],
      ["0000-01-01T00:00:00Z", null],
      ["2026-01-01T25:00:00Z", null],
      ["2026-01-01T10:00:00+99:00", null],
      ["2026-01-01T10:00:00", null],
      ["2024-02-29T10:00:00.000Z", "2024-02-29T10:00:00.000Z"],
      ["2026-10-01T14:00:00.000Z", "2026-10-01T14:00:00.000Z"],
      ["2026-10-01T11:00:00-03:00", "2026-10-01T14:00:00.000Z"],
    ];
    const acts: { id: string; personId: string; at: string; expected: string | null }[] = [];
    for (const [at, expected] of cases) {
      const [p] = await tx.insert(person).values({ firstName: "P" }).returning();
      const [a] = await tx.insert(activity).values({ type: "meeting_logged", personId: p!.id, actorBdId: author!.id, metadata: { at } }).returning();
      acts.push({ id: a!.id, personId: p!.id, at, expected });
    }
    const migration = readFileSync(join(__dirname, "..", "..", "drizzle", "0054_meeting_outcomes.sql"), "utf8");
    const backfill = migration.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "meeting"'))!;
    await tx.execute(sql.raw(backfill));
    for (const a of acts) {
      const [m] = await tx.select().from(meeting).where(eq(meeting.heldActivityId, a.id));
      const [src] = await tx.select().from(activity).where(eq(activity.id, a.id));
      assert.ok(m, `${a.at} was backfilled`);
      assert.equal(m.scheduledAt.toISOString(), a.expected ?? src!.createdAt.toISOString(), a.at);
    }
  });
});

test("only a meeting closed through the outcome flow can be undone: directly logged and backfilled held meetings cannot", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { registerContactMeeting, applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const { activity, meeting } = await import("@/db/schema");
    const { sql, eq } = await import("drizzle-orm");
    const refused = (e: { reason?: string }) => e.reason === "meeting_undo_unavailable";

    const direct = await registerContactMeeting(contact.id, me.id, "2026-10-16", "11:00", "x", NOW, { database: tx });
    assert.equal(direct.kind, "held");
    await assert.rejects(() => undoMeetingOutcome(direct.meetingId, me.id, NOW, { database: tx }), refused);

    const [legacy] = await tx.insert(activity).values({ type: "meeting_logged", personId: contact.id, actorBdId: me.id, metadata: { at: "2026-09-01T14:00:00.000Z" } }).returning();
    const migration = readFileSync(join(__dirname, "..", "..", "drizzle", "0054_meeting_outcomes.sql"), "utf8");
    await tx.execute(sql.raw(migration.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "meeting"'))!));
    const [backfilled] = await tx.select().from(meeting).where(eq(meeting.heldActivityId, legacy!.id));
    await assert.rejects(() => undoMeetingOutcome(backfilled!.id, me.id, NOW, { database: tx }), refused);

    // The same meeting closed through the outcome flow IS undoable.
    const scheduled = await registerContactMeeting(contact.id, me.id, "2026-10-20", "11:00", "y", new Date("2026-10-19T15:00:00.000Z"), { database: tx });
    await applyMeetingOutcome(scheduled.meetingId, me.id, { outcome: "held" }, TITLES, NOW, { database: tx });
    await undoMeetingOutcome(scheduled.meetingId, me.id, NOW, { database: tx });
    assert.equal((await tx.select().from(meeting).where(eq(meeting.id, scheduled.meetingId)))[0]?.status, "scheduled");
  });
});

test("a held meeting is dated by when it happened (metadata.at = scheduled_at), whether logged directly or confirmed later", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { registerContactMeeting, applyMeetingOutcome } = await import("@/lib/meetings/db");
    const { activity } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const direct = await registerContactMeeting(contact.id, me.id, "2026-10-16", "11:00", "", NOW, { database: tx });
    const scheduled = await registerContactMeeting(contact.id, me.id, "2026-10-20", "11:00", "", new Date("2026-10-19T15:00:00.000Z"), { database: tx });
    await applyMeetingOutcome(scheduled.meetingId, me.id, { outcome: "held" }, TITLES, new Date("2026-10-23T15:00:00.000Z"), { database: tx });
    const rows = await tx.select().from(activity).where(eq(activity.personId, contact.id));
    const at = (id: string) => (rows.find((r) => (r.metadata as { meetingId?: string }).meetingId === id)!.metadata as { at: string }).at;
    assert.equal(at(direct.meetingId), "2026-10-16T14:00:00.000Z");
    assert.equal(at(scheduled.meetingId), "2026-10-20T14:00:00.000Z", "confirmed three days later, still dated at the meeting");
  });
});
