/**
 * `task_created` activity on every creation path, against a scratch database: a single create logs one (actor, title, due date,
 * assignee), a bulk create logs one per contact through ONE activity INSERT, none of it moves a contact's status, and the meeting
 * undo that deletes its follow-up task takes the activity with it. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local
 * `_e2e` database. Every test runs in one transaction rolled back by a sentinel throw.
 */
import assert from "node:assert/strict";
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

async function seed(tx: Tx, contacts = 1) {
  const { bd, person } = await import("@/db/schema");
  const [me] = await tx.insert(bd).values({ email: "zz-tc-me@example.test", name: "ZZ Creator" }).returning();
  const [other] = await tx.insert(bd).values({ email: "zz-tc-other@example.test", name: "ZZ Assignee" }).returning();
  const people = await tx
    .insert(person)
    .values(Array.from({ length: contacts }, (_, i) => ({ firstName: `Contacto${i}`, lastName: "Prueba" })))
    .returning();
  return { me: me!, other: other!, people };
}

async function createdActivities(tx: Tx, personIds: string[]) {
  const { and, eq, inArray } = await import("drizzle-orm");
  const { activity } = await import("@/db/schema");
  return tx.select().from(activity).where(and(eq(activity.type, "task_created"), inArray(activity.personId, personIds)));
}

async function statusOf(tx: Tx, personId: string) {
  const { eq } = await import("drizzle-orm");
  const { person } = await import("@/db/schema");
  const [row] = await tx.select({ status: person.status }).from(person).where(eq(person.id, personId));
  return row!.status;
}

test("a single create logs one task_created with the actor, title, due date and assignee, and leaves the status alone", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, other, people } = await seed(tx);
    const contact = people[0]!;
    const before = await statusOf(tx, contact.id);
    const { createTaskWithActivity } = await import("@/lib/tasks/updateWithActivity");
    const created = await createTaskWithActivity(
      { personId: contact.id, title: "Enviar propuesta", dueAt: new Date("2026-10-30T15:00:00.000Z"), assignedToBdId: other.id, actorBdId: me.id },
      { id: me.id, role: "bd" },
      tx as never,
    );
    const rows = await createdActivities(tx, [contact.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actorBdId, me.id);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    assert.equal(meta.taskId, created.id);
    assert.equal(meta.taskTitle, "Enviar propuesta");
    assert.equal(meta.assigneeName, "ZZ Assignee");
    assert.equal(typeof meta.dueLabel, "string");
    assert.equal(await statusOf(tx, contact.id), before);
  });
});

test("a bulk create over N contacts logs N task_created through ONE activity insert, with the status unchanged", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, other, people } = await seed(tx, 5);
    const ids = people.map((p) => p.id);
    const before = await Promise.all(ids.map((id) => statusOf(tx, id)));
    let activityInserts = 0;
    const { activity } = await import("@/db/schema");
    const counting = new Proxy(tx, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return async (fn: (inner: Tx) => Promise<unknown>) => fn(counting);
        }
        if (prop === "insert") {
          return (table: unknown) => {
            if (table === activity) activityInserts += 1;
            return target.insert(table as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Tx;
    const { bulkCreateTasks } = await import("@/lib/tasks/bulkCreateDb");
    const count = await bulkCreateTasks(ids, { title: "Llamar", assignedToBdId: other.id, actorBdId: me.id }, counting as never);
    assert.equal(count, 5);
    assert.equal(activityInserts, 1, "one multi-row activity insert, not one per contact");
    const rows = await createdActivities(tx, ids);
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.actorBdId === me.id && (r.metadata as Record<string, unknown>).assigneeName === "ZZ Assignee"));
    assert.deepEqual(await Promise.all(ids.map((id) => statusOf(tx, id))), before);
  });
});

test("undoing a meeting outcome removes its follow-up task together with the task_created activity", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { me, people } = await seed(tx);
    const contact = people[0]!;
    const { registerContactMeeting, applyMeetingOutcome, undoMeetingOutcome } = await import("@/lib/meetings/db");
    const now = new Date("2026-10-22T15:00:00.000Z");
    const { meetingId } = await registerContactMeeting(contact.id, me.id, "2026-10-20", "11:00", "Demo", new Date("2026-10-19T15:00:00.000Z"), { database: tx });
    await applyMeetingOutcome(
      meetingId,
      me.id,
      { outcome: "cancelled", followUp: true, followUpDueDate: "2026-10-24" },
      { no_show: "Seguimiento: no se presentó", cancelled: "Seguimiento: reunión cancelada" },
      now,
      { database: tx },
    );
    const during = await createdActivities(tx, [contact.id]);
    assert.equal(during.length, 1);
    assert.equal((during[0]!.metadata as Record<string, unknown>).assigneeName, "ZZ Creator");
    await undoMeetingOutcome(meetingId, me.id, now, { database: tx });
    assert.equal((await createdActivities(tx, [contact.id])).length, 0);
  });
});
