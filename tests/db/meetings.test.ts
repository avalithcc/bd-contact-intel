/**
 * meeting-outcomes against a scratch database (migration 0054 applied): a future meeting is not a held one, "Se hizo" moves the
 * contact to Reunión, a no-show creates the follow-up task, another BD (an admin included) cannot change a meeting that is not
 * theirs, a reschedule keeps its chain, an undo takes everything its save wrote back, and the migration's backfill turns the
 * meetings logged before this feature into held meetings. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e`
 * database. Every test runs in one transaction rolled back by a sentinel throw.
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
const TITLES = { no_show: "Seguimiento: no se presentó", cancelled: "Seguimiento: reunión cancelada" };

async function seed(tx: Tx) {
  const { bd, person } = await import("@/db/schema");
  const [me] = await tx.insert(bd).values({ email: "zz-meet-me@example.test", name: "ZZ Me" }).returning();
  const [admin] = await tx.insert(bd).values({ email: "zz-meet-admin@example.test", name: "ZZ Admin", role: "admin" }).returning();
  const [contact] = await tx.insert(person).values({ firstName: "Lucía", lastName: "Fernández" }).returning();
  return { me: me!, admin: admin!, contact: contact! };
}

/** A meeting registered "3 days ago" for tomorrow-in-that-frame, so by NOW it is scheduled and its time has passed. */
async function pendingMeeting(tx: Tx, personId: string, bdId: string) {
  const { registerContactMeeting } = await import("@/lib/meetings/db");
  const registeredAt = new Date("2026-10-19T15:00:00.000Z");
  const { meetingId, kind } = await registerContactMeeting(personId, bdId, "2026-10-20", "11:00", "Demo", registeredAt, { database: tx });
  assert.equal(kind, "scheduled");
  return meetingId;
}

async function stateOf(tx: Tx, personId: string) {
  const { eq } = await import("drizzle-orm");
  const { person } = await import("@/db/schema");
  const [row] = await tx.select({ status: person.status }).from(person).where(eq(person.id, personId));
  return row!.status;
}

async function activitiesOf(tx: Tx, personId: string) {
  const { asc, eq } = await import("drizzle-orm");
  const { activity } = await import("@/db/schema");
  return tx.select().from(activity).where(eq(activity.personId, personId)).orderBy(asc(activity.createdAt));
}

async function meetingRow(tx: Tx, id: string) {
  const { eq } = await import("drizzle-orm");
  const { meeting } = await import("@/db/schema");
  const [row] = await tx.select().from(meeting).where(eq(meeting.id, id));
  return row;
}

test("a future meeting is saved as scheduled, writes a status-neutral activity and does not count as held", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { registerContactMeeting } = await import("@/lib/meetings/db");
    const result = await registerContactMeeting(contact.id, me.id, "2026-10-22", "15:00", "Demo", NOW, { database: tx });
    assert.equal(result.kind, "scheduled");
    const row = await meetingRow(tx, result.meetingId);
    assert.equal(row?.status, "scheduled");
    assert.equal(row?.scheduledAt.toISOString(), "2026-10-22T18:00:00.000Z");
    const types = (await activitiesOf(tx, contact.id)).map((a) => a.type);
    assert.deepEqual(types, ["meeting_scheduled"]);
    assert.equal(await stateOf(tx, contact.id), "new", "Agendada never sets the Reunión status");
  });
});

test("a meeting in the past is held at once: meeting_logged, linked, and the contact moves to Reunión", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { registerContactMeeting } = await import("@/lib/meetings/db");
    const result = await registerContactMeeting(contact.id, me.id, "2026-10-16", "11:00", "Primera llamada", NOW, { database: tx });
    assert.equal(result.kind, "held");
    const row = await meetingRow(tx, result.meetingId);
    assert.equal(row?.status, "held");
    const acts = await activitiesOf(tx, contact.id);
    assert.deepEqual(acts.map((a) => a.type), ["meeting_logged"]);
    assert.equal(row?.heldActivityId, acts[0]!.id);
    assert.equal(await stateOf(tx, contact.id), "meeting");
  });
});

test("Se hizo on a pending meeting writes meeting_logged with the actor and sets the status; the first hold also blocks a second confirm", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome } = await import("@/lib/meetings/db");
    const id = await pendingMeeting(tx, contact.id, me.id);
    assert.equal(await stateOf(tx, contact.id), "new");
    await applyMeetingOutcome(id, me.id, { outcome: "held", notes: "Quedaron en enviar la propuesta" }, TITLES, NOW, { database: tx });
    assert.equal(await stateOf(tx, contact.id), "meeting");
    const acts = await activitiesOf(tx, contact.id);
    const held = acts.find((a) => a.type === "meeting_logged")!;
    assert.equal(held.actorBdId, me.id);
    assert.deepEqual(held.metadata, { at: "2026-10-20T14:00:00.000Z", notes: "Quedaron en enviar la propuesta", meetingId: id });
    const row = await meetingRow(tx, id);
    assert.equal(row?.status, "held");
    assert.equal(row?.outcomeByBdId, me.id);
    await assert.rejects(
      () => applyMeetingOutcome(id, me.id, { outcome: "cancelled" }, TITLES, NOW, { database: tx }),
      (e: { reason?: string }) => e.reason === "meeting_not_open",
    );
  });
});

test("No se presentó leaves the status alone and creates the follow-up task due on the chosen day", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome } = await import("@/lib/meetings/db");
    const { task } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await pendingMeeting(tx, contact.id, me.id);
    const result = await applyMeetingOutcome(
      id,
      me.id,
      { outcome: "no_show", reason: "imprevisto", followUp: true, followUpDueDate: "2026-10-24" },
      TITLES,
      NOW,
      { database: tx },
    );
    assert.equal(await stateOf(tx, contact.id), "new");
    const [created] = await tx.select().from(task).where(eq(task.id, result.followUpTaskId!));
    assert.equal(created?.title, TITLES.no_show);
    assert.equal(created?.personId, contact.id);
    assert.equal(created?.assignedToBdId, me.id);
    assert.equal(created?.dueAt?.toISOString(), "2026-10-24T00:00:00.000Z");
    const types = (await activitiesOf(tx, contact.id)).map((a) => a.type);
    assert.ok(types.includes("meeting_no_show") && types.includes("task_created"));
    assert.ok(!types.includes("meeting_logged"));
  });
});

test("another BD, an admin included, cannot confirm, reschedule, cancel or undo a meeting that is not theirs", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, admin, contact } = await seed(tx);
    const { applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const id = await pendingMeeting(tx, contact.id, me.id);
    const forbidden = (e: { reason?: string }) => e.reason === "meeting_forbidden";
    for (const input of [{ outcome: "held" }, { outcome: "cancelled" }, { outcome: "rescheduled", newDate: "2026-10-30", newTime: "10:00" }]) {
      await assert.rejects(() => applyMeetingOutcome(id, admin.id, input, TITLES, NOW, { database: tx }), forbidden);
    }
    assert.equal((await meetingRow(tx, id))?.status, "scheduled", "nothing changed");
    await applyMeetingOutcome(id, me.id, { outcome: "cancelled" }, TITLES, NOW, { database: tx });
    await assert.rejects(() => undoMeetingOutcome(id, admin.id, NOW, { database: tx }), forbidden);
  });
});

test("Reprogramada closes the meeting, opens the next one linked both ways, and the contact status is untouched", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome } = await import("@/lib/meetings/db");
    const id = await pendingMeeting(tx, contact.id, me.id);
    const result = await applyMeetingOutcome(id, me.id, { outcome: "rescheduled", newDate: "2026-10-26", newTime: "15:00" }, TITLES, NOW, { database: tx });
    const old = await meetingRow(tx, id);
    const next = await meetingRow(tx, result.nextMeetingId!);
    assert.equal(old?.status, "rescheduled");
    assert.equal(old?.rescheduledToId, next?.id);
    assert.equal(next?.status, "scheduled");
    assert.equal(next?.rescheduledFromId, id);
    assert.equal(next?.bdId, me.id);
    assert.equal(next?.notes, "Demo");
    assert.equal(next?.scheduledAt.toISOString(), "2026-10-26T18:00:00.000Z");
    assert.equal(await stateOf(tx, contact.id), "new");
  });
});

test("undo of Se hizo removes the held activity and the contact falls back to its previous status", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const id = await pendingMeeting(tx, contact.id, me.id);
    await applyMeetingOutcome(id, me.id, { outcome: "held" }, TITLES, NOW, { database: tx });
    assert.equal(await stateOf(tx, contact.id), "meeting");
    await undoMeetingOutcome(id, me.id, NOW, { database: tx });
    assert.equal(await stateOf(tx, contact.id), "new");
    assert.ok(!(await activitiesOf(tx, contact.id)).some((a) => a.type === "meeting_logged"));
    const row = await meetingRow(tx, id);
    assert.equal(row?.status, "scheduled");
    assert.equal(row?.outcomeAt, null);
    assert.equal(row?.heldActivityId, null);
  });
});

test("undo removes the follow-up task it created while untouched, and leaves an edited one alone", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const { task } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const input = { outcome: "cancelled", followUp: true, followUpDueDate: "2026-10-24" };

    const first = await pendingMeeting(tx, contact.id, me.id);
    const a = await applyMeetingOutcome(first, me.id, input, TITLES, NOW, { database: tx });
    await undoMeetingOutcome(first, me.id, NOW, { database: tx });
    assert.equal((await tx.select().from(task).where(eq(task.id, a.followUpTaskId!))).length, 0);
    assert.ok(!(await activitiesOf(tx, contact.id)).some((x) => x.type === "task_created" || x.type === "meeting_cancelled"));
    assert.equal((await meetingRow(tx, first))?.status, "scheduled");

    const second = await pendingMeeting(tx, contact.id, me.id);
    const b = await applyMeetingOutcome(second, me.id, input, TITLES, NOW, { database: tx });
    await tx.update(task).set({ title: "Editada a mano", updatedAt: new Date(NOW.getTime() + 60_000) }).where(eq(task.id, b.followUpTaskId!));
    await undoMeetingOutcome(second, me.id, NOW, { database: tx });
    assert.equal((await tx.select().from(task).where(eq(task.id, b.followUpTaskId!))).length, 1, "an edited task is the BD's own work now");
    assert.equal((await meetingRow(tx, second))?.status, "scheduled");
  });
});

test("undo of a reschedule deletes the untouched new meeting, and is refused once that one has an outcome", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const id = await pendingMeeting(tx, contact.id, me.id);
    const r = await applyMeetingOutcome(id, me.id, { outcome: "rescheduled", newDate: "2026-10-26", newTime: "15:00" }, TITLES, NOW, { database: tx });
    await undoMeetingOutcome(id, me.id, NOW, { database: tx });
    assert.equal(await meetingRow(tx, r.nextMeetingId!), undefined);
    const restored = await meetingRow(tx, id);
    assert.equal(restored?.status, "scheduled");
    assert.equal(restored?.rescheduledToId, null);

    const r2 = await applyMeetingOutcome(id, me.id, { outcome: "rescheduled", newDate: "2026-10-27", newTime: "10:00" }, TITLES, NOW, { database: tx });
    await applyMeetingOutcome(r2.nextMeetingId!, me.id, { outcome: "cancelled" }, TITLES, new Date("2026-10-27T14:00:00.000Z"), { database: tx });
    await assert.rejects(
      () => undoMeetingOutcome(id, me.id, new Date("2026-10-27T14:01:00.000Z"), { database: tx }),
      (e: { reason?: string }) => e.reason === "meeting_undo_unavailable",
    );
  });
});

test("an undo after the window is refused", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, contact } = await seed(tx);
    const { applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const { UNDO_WINDOW_MS } = await import("@/lib/meetings/outcome");
    const id = await pendingMeeting(tx, contact.id, me.id);
    await applyMeetingOutcome(id, me.id, { outcome: "held" }, TITLES, NOW, { database: tx });
    await assert.rejects(
      () => undoMeetingOutcome(id, me.id, new Date(NOW.getTime() + UNDO_WINDOW_MS + 1000), { database: tx }),
      (e: { reason?: string }) => e.reason === "meeting_undo_unavailable",
    );
  });
});

test("migration 0054's backfill turns existing meeting_logged activity into held meetings once, and skips rows nobody owns", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity, bd, person, meeting } = await import("@/db/schema");
    const { sql, eq } = await import("drizzle-orm");
    const [author] = await tx.insert(bd).values({ email: "zz-backfill@example.test", name: "ZZ Backfill" }).returning();
    const [owner] = await tx.insert(bd).values({ email: "zz-backfill-owner@example.test", name: "ZZ Owner" }).returning();
    const [withActor] = await tx.insert(person).values({ firstName: "A" }).returning();
    const [ownedOnly] = await tx.insert(person).values({ firstName: "B", ownerBdId: owner!.id }).returning();
    const [orphan] = await tx.insert(person).values({ firstName: "C" }).returning();
    const [a1] = await tx.insert(activity).values({ type: "meeting_logged", personId: withActor!.id, actorBdId: author!.id, metadata: { at: "2026-09-01T14:00:00.000Z", notes: "uno" } }).returning();
    const [a2] = await tx.insert(activity).values({ type: "meeting_logged", personId: ownedOnly!.id, metadata: { at: "no es una fecha" } }).returning();
    await tx.insert(activity).values({ type: "meeting_logged", personId: orphan!.id, metadata: { at: "2026-09-02T14:00:00.000Z" } });
    await tx.insert(activity).values({ type: "note", personId: withActor!.id, actorBdId: author!.id, metadata: { text: "x" } });

    const migration = readFileSync(join(__dirname, "..", "..", "drizzle", "0054_meeting_outcomes.sql"), "utf8");
    const backfill = migration.split("--> statement-breakpoint").find((s) => s.includes("INSERT INTO \"meeting\""))!;
    await tx.execute(sql.raw(backfill));
    await tx.execute(sql.raw(backfill)); // a rerun adds nothing

    const rows = await tx.select().from(meeting).where(sql`${meeting.personId} in (${withActor!.id}, ${ownedOnly!.id}, ${orphan!.id})`);
    assert.equal(rows.length, 2);
    const first = rows.find((r) => r.personId === withActor!.id)!;
    assert.equal(first.status, "held");
    assert.equal(first.bdId, author!.id);
    assert.equal(first.scheduledAt.toISOString(), "2026-09-01T14:00:00.000Z");
    assert.equal(first.notes, "uno");
    assert.equal(first.heldActivityId, a1!.id);
    const second = rows.find((r) => r.personId === ownedOnly!.id)!;
    assert.equal(second.bdId, owner!.id, "no actor: the contact's owner");
    assert.equal(second.heldActivityId, a2!.id);
    assert.equal(second.scheduledAt.getTime(), (await tx.select().from(activity).where(eq(activity.id, a2!.id)))[0]!.createdAt.getTime(), "malformed metadata.at falls back to created_at");
  });
});
