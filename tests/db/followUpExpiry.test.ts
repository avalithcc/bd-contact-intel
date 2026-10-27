/**
 * follow-up-expiry against a scratch database: the 5-day entry, the carry-over of unworked items across days, Vencidos
 * outside the cap, the day-10 drop (page and job), the BD drop, the touch that ends a cycle, and the re-entry row. Opt-in and
 * fail-closed like tests/db/followUpExcludeActiveClients.test.ts: `npm run test:db`, DATABASE_URL a local `_e2e` database.
 * Each test runs in one transaction rolled back by a sentinel throw. Days are simulated with the `queueDate` argument; the
 * SQL's own `now()` only decides how old a TOUCH is, so touches are seeded relative to the real clock.
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

const NOW = new Date();
const HOUR = 3600 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * 24 * HOUR - HOUR);

async function today() {
  const { argentinaCalendarDate } = await import("@/lib/tasks/argentinaDate");
  return argentinaCalendarDate(NOW);
}
async function plusDays(date: string, n: number) {
  const { addDaysToDateString } = await import("@/lib/tasks/argentinaDate");
  return addDaysToDateString(date, n);
}

async function seedBd(tx: Tx) {
  const { bd } = await import("@/db/schema");
  const tag = Math.random().toString(36).slice(2);
  const [me] = await tx.insert(bd).values({ email: `zz-fx-${tag}@example.test`, name: "ZZ Expiry" }).returning();
  return me!.id;
}

async function seedPerson(tx: Tx, bdId: string, label: string, status: "contacted" | "replied", touchedDaysAgo: number) {
  const { activity, person } = await import("@/db/schema");
  const [p] = await tx.insert(person).values({ firstName: label, lastName: "Expiry", ownerBdId: bdId, status }).returning();
  await tx.insert(activity).values({
    personId: p!.id,
    actorBdId: bdId,
    type: status === "replied" ? "reply_received" : "email_sent",
    metadata: { occurredAt: ago(touchedDaysAgo).toISOString() },
    createdAt: ago(touchedDaysAgo),
  });
  return p!.id;
}

async function materialize(tx: Tx, bdId: string, queueDate: string) {
  const { materializeQueueInTx } = await import("@/lib/followUp/queueQueries");
  await materializeQueueInTx(tx as never, bdId, queueDate);
}

async function read(tx: Tx, bdId: string, queueDate: string) {
  const { readQueueRows } = await import("@/lib/followUp/queueQueries");
  return readQueueRows(bdId, queueDate, NOW, tx as never);
}

async function rowsFor(tx: Tx, bdId: string) {
  const { followUpQueueItem } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return tx.select().from(followUpQueueItem).where(eq(followUpQueueItem.bdId, bdId));
}

async function activitiesOf(tx: Tx, personId: string, type: string) {
  const { activity } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return tx.select().from(activity).where(and(eq(activity.personId, personId), eq(activity.type, type)));
}

test("a contact enters five days after its last touch, Respondió and Contactado alike, and the row opens a cycle", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const d0 = await today();
    const c4 = await seedPerson(tx, bdId, "c4", "contacted", 4);
    const c5 = await seedPerson(tx, bdId, "c5", "contacted", 5);
    const r4 = await seedPerson(tx, bdId, "r4", "replied", 4);
    const r5 = await seedPerson(tx, bdId, "r5", "replied", 5);
    await materialize(tx, bdId, d0);
    const rows = await rowsFor(tx, bdId);
    assert.deepEqual(rows.map((r) => r.personId).sort(), [c5, r5].sort());
    assert.ok(![c4, r4].some((id) => rows.some((r) => r.personId === id)));
    for (const r of rows) assert.equal(r.cycleStartedOn, d0);
  });
});

test("an unworked item stays on the page on the next days and is never re-added as new", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const d0 = await today();
    const first = await seedPerson(tx, bdId, "first", "contacted", 6);
    await materialize(tx, bdId, d0);
    const d1 = await plusDays(d0, 1);
    const second = await seedPerson(tx, bdId, "second", "contacted", 6);
    await materialize(tx, bdId, d1);
    const rows = await rowsFor(tx, bdId);
    assert.equal(rows.filter((r) => r.personId === first).length, 1, "the same contact is not queued twice in one cycle");
    const page = await read(tx, bdId, d1);
    assert.deepEqual(page.map((r) => r.personId).sort(), [first, second].sort());
    const carried = page.find((r) => r.personId === first)!;
    assert.equal(carried.cycleStartedOn, d0);
    assert.equal(carried.state, "pending");
  });
});

test("Vencidos sit outside the daily cap; days 0-2 carried items use it", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const d0 = await today();
    for (let i = 0; i < 12; i += 1) await seedPerson(tx, bdId, `p${i}`, "contacted", 6);
    await materialize(tx, bdId, d0);
    assert.equal((await rowsFor(tx, bdId)).length, 10, "day 0: the cap");
    await materialize(tx, bdId, await plusDays(d0, 1));
    assert.equal((await rowsFor(tx, bdId)).length, 10, "day 1: ten carried items fill the cap, nothing new");
    await materialize(tx, bdId, await plusDays(d0, 3));
    assert.equal((await rowsFor(tx, bdId)).length, 12, "day 3: the ten are Vencidos and no longer use the cap, so the other two enter");
    const d3 = await read(tx, bdId, await plusDays(d0, 3));
    assert.equal(d3.length, 12);
    assert.equal(d3.filter((r) => r.cycleStartedOn === d0).length, 10);
  });
});

test("day 10: the page hides the item, the job drops it once, and selection does not bring it back", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const d0 = await today();
    const id = await seedPerson(tx, bdId, "old", "contacted", 6);
    await materialize(tx, bdId, d0);
    const d9 = await plusDays(d0, 9);
    const d10 = await plusDays(d0, 10);
    assert.equal((await read(tx, bdId, d9)).length, 1, "day 9 still shows it");
    assert.equal((await read(tx, bdId, d10)).length, 0, "day 10 is past the deadline even if the job has not run");
    const { expireOverdueFollowUps } = await import("@/lib/followUp/dropQueries");
    assert.equal(await expireOverdueFollowUps(d10, tx as never, { dryRun: true }), 1);
    assert.equal((await activitiesOf(tx, id, "follow_up_expired")).length, 0, "a dry run writes nothing");
    assert.equal(await expireOverdueFollowUps(d10, tx as never), 1);
    assert.equal(await expireOverdueFollowUps(d10, tx as never), 0, "idempotent");
    const [expired] = await activitiesOf(tx, id, "follow_up_expired");
    assert.equal(expired!.actorBdId, null);
    assert.deepEqual(expired!.metadata, { cycleStartedOn: d0, daysInQueue: 10, status: "contacted" });
    await materialize(tx, bdId, d10);
    assert.equal((await rowsFor(tx, bdId)).length, 1, "a dropped contact is not queued again until new activity");
  });
});

test("a BD drop removes the item without touching the pipeline status, and a second click is a no-op", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { person } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const bdId = await seedBd(tx);
    const d0 = await today();
    const id = await seedPerson(tx, bdId, "drop", "replied", 6);
    await materialize(tx, bdId, d0);
    const [item] = await rowsFor(tx, bdId);
    const { dropFollowUp } = await import("@/lib/followUp/dropQueries");
    const input = { itemId: item!.id, bdId, reason: "no_response" as const, detail: null };
    assert.deepEqual(await dropFollowUp(input, tx as never), { dropped: true });
    assert.deepEqual(await dropFollowUp(input, tx as never), { dropped: false });
    assert.equal((await activitiesOf(tx, id, "follow_up_dropped")).length, 1);
    const [row] = await activitiesOf(tx, id, "follow_up_dropped");
    assert.equal(row!.actorBdId, bdId);
    assert.deepEqual(row!.metadata, { reason: "no_response", detail: null, cycleStartedOn: d0, status: "replied" });
    const [p] = await tx.select().from(person).where(eq(person.id, id));
    assert.equal(p!.status, "replied");
    assert.equal((await read(tx, bdId, await plusDays(d0, 1))).length, 0);
    await materialize(tx, bdId, await plusDays(d0, 1));
    assert.equal((await rowsFor(tx, bdId)).length, 1);
  });
});

test("another BD cannot drop my item", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const other = await seedBd(tx);
    await seedPerson(tx, bdId, "mine", "contacted", 6);
    await materialize(tx, bdId, await today());
    const [item] = await rowsFor(tx, bdId);
    const { dropFollowUp } = await import("@/lib/followUp/dropQueries");
    assert.deepEqual(await dropFollowUp({ itemId: item!.id, bdId: other, reason: "not_now", detail: null }, tx as never), { dropped: false });
  });
});

test("a new touch ends the cycle: the item leaves the page and waits five days again", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity } = await import("@/db/schema");
    const bdId = await seedBd(tx);
    const d0 = await today();
    const id = await seedPerson(tx, bdId, "worked", "contacted", 6);
    await materialize(tx, bdId, d0);
    await tx.insert(activity).values({ personId: id, actorBdId: bdId, type: "note", metadata: { note: "hablé" } });
    const d1 = await plusDays(d0, 1);
    assert.equal((await read(tx, bdId, d1)).length, 0);
    await materialize(tx, bdId, d1);
    assert.equal((await rowsFor(tx, bdId)).length, 1, "not re-queued: the note restarted the five-day wait");
  });
});

test("an unanswered dial is not a touch: the item stays", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity } = await import("@/db/schema");
    const bdId = await seedBd(tx);
    const d0 = await today();
    const id = await seedPerson(tx, bdId, "dialled", "contacted", 6);
    await materialize(tx, bdId, d0);
    await tx.insert(activity).values({ personId: id, actorBdId: bdId, type: "call_attempt", metadata: {} });
    assert.equal((await read(tx, bdId, await plusDays(d0, 1))).length, 1);
  });
});

test("after a drop, new activity brings the contact back five days later with one re-entry row; fresher drops stay out", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity, followUpQueueItem } = await import("@/db/schema");
    const bdId = await seedBd(tx);
    const d0 = await today();
    const back = await seedPerson(tx, bdId, "back", "contacted", 6);
    const stays = await seedPerson(tx, bdId, "stays", "contacted", 6);
    // A previous cycle for "back": opened 12 days ago, dropped 8 days ago, touched again 6 days ago (the seed touch above).
    for (const [personId, droppedDaysAgo] of [[back, 8], [stays, 1]] as const) {
      await tx.insert(followUpQueueItem).values({
        bdId,
        personId,
        queueDate: await plusDays(d0, -12),
        cycleStartedOn: await plusDays(d0, -12),
        position: 1,
        dueStatus: "contacted",
        lastTouchAt: ago(20),
        createdAt: ago(12),
      });
      await tx.insert(activity).values({ personId, actorBdId: bdId, type: "follow_up_dropped", metadata: {}, createdAt: ago(droppedDaysAgo) });
    }
    await materialize(tx, bdId, d0);
    const rows = (await rowsFor(tx, bdId)).filter((r) => r.queueDate === d0);
    assert.deepEqual(rows.map((r) => r.personId), [back], "the drop that is newer than the last touch keeps its contact out");
    assert.equal(rows[0]!.cycleStartedOn, d0);
    assert.equal((await activitiesOf(tx, back, "follow_up_reentered")).length, 1);
    assert.equal((await activitiesOf(tx, stays, "follow_up_reentered")).length, 0);
    const { buildFollowUpReentryQuery } = await import("@/lib/followUp/candidateQuery");
    await tx.execute(buildFollowUpReentryQuery(bdId, d0));
    assert.equal((await activitiesOf(tx, back, "follow_up_reentered")).length, 1, "idempotent");
  });
});

test("the sidebar badge counts Vencidos plus the rest of the page, and reports the Vencidos apart", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { buildAppShellBadgeCountsQuery } = await import("@/lib/shell/appShellBadgeCountsQuery");
    const { argentinaDayBoundaries, argentinaInstantDayWindow } = await import("@/lib/tasks/argentinaDate");
    const bdId = await seedBd(tx);
    const d0 = await today();
    for (let i = 0; i < 3; i += 1) await seedPerson(tx, bdId, `old${i}`, "contacted", 6);
    await materialize(tx, bdId, d0);
    const d3 = await plusDays(d0, 3);
    for (let i = 0; i < 2; i += 1) await seedPerson(tx, bdId, `new${i}`, "contacted", 6);
    await materialize(tx, bdId, d3);
    const w = argentinaInstantDayWindow(NOW);
    const [counts] = (await tx.execute(
      buildAppShellBadgeCountsQuery({
        bdId,
        queueDate: d3,
        tomorrowStartUtcIso: argentinaDayBoundaries(NOW).tomorrowStartUtc.toISOString(),
        workedTodayFromIso: w.fromUtc.toISOString(),
        workedTodayToIso: w.toUtc.toISOString(),
        nowIso: NOW.toISOString(),
      }),
    )) as unknown as { follow_up_count: number; follow_up_overdue_count: number }[];
    assert.equal(Number(counts!.follow_up_count), 5);
    assert.equal(Number(counts!.follow_up_overdue_count), 3);
    assert.equal((await read(tx, bdId, d3)).length, 5, "the page and the badge report the same number");
  });
});
