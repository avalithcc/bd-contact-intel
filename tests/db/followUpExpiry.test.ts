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
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

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
    const d3 = await plusDays(d0, 3);
    assert.deepEqual(await dropFollowUp({ itemId: item!.id, bdId, reason: "no_response", detail: null, today: await plusDays(d0, 1) }, tx as never), { dropped: false }, "a day-1 item is not Vencido yet");
    const input = { itemId: item!.id, bdId, reason: "no_response" as const, detail: null, today: d3 };
    assert.deepEqual(await dropFollowUp(input, tx as never), { dropped: true });
    assert.deepEqual(await dropFollowUp(input, tx as never), { dropped: false });
    assert.equal((await activitiesOf(tx, id, "follow_up_dropped")).length, 1);
    const [row] = await activitiesOf(tx, id, "follow_up_dropped");
    assert.equal(row!.actorBdId, bdId);
    assert.deepEqual(row!.metadata, { reason: "no_response", detail: null, cycleStartedOn: d0, status: "replied" });
    const [p] = await tx.select().from(person).where(eq(person.id, id));
    assert.equal(p!.status, "replied");
    assert.equal((await read(tx, bdId, d3)).length, 0);
    await materialize(tx, bdId, d3);
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
    assert.deepEqual(await dropFollowUp({ itemId: item!.id, bdId: other, reason: "not_now", detail: null, today: await plusDays(await today(), 3) }, tx as never), { dropped: false });
  });
});

test("a new touch ends the cycle: the item leaves the page and waits five days again", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity } = await import("@/db/schema");
    const bdId = await seedBd(tx);
    const d0 = await today();
    const id = await seedPerson(tx, bdId, "worked", "contacted", 6);
    await materialize(tx, bdId, d0);
    await tx.insert(activity).values({ personId: id, actorBdId: bdId, type: "note", metadata: { note: "hablé" }, createdAt: hoursAgo(30) });
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

test("the record page reads the owner's latest cycle row and the derived state matches the page", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { readOwnerWithFollowUpCycle } = await import("@/lib/contacts/queries");
    const { deriveFollowUpRecordState } = await import("@/lib/followUp/recordState");
    const bdId = await seedBd(tx);
    const other = await seedBd(tx);
    const d0 = await today();
    const id = await seedPerson(tx, bdId, "rec", "contacted", 6);
    await materialize(tx, bdId, d0);
    const [owner] = await readOwnerWithFollowUpCycle(tx as never, bdId, id);
    assert.equal(owner!.name, "ZZ Expiry");
    assert.equal(owner!.followUpCycle?.cycleStartedOn, d0);
    const [stranger] = await readOwnerWithFollowUpCycle(tx as never, other, id);
    assert.equal(stranger!.followUpCycle, null, "another BD's queue is not this person's cycle");
    const cycle = { cycleStartedOn: owner!.followUpCycle!.cycleStartedOn, lastTouchAt: new Date(owner!.followUpCycle!.lastTouchAt), createdAt: new Date(owner!.followUpCycle!.createdAt) };
    const state = deriveFollowUpRecordState({ cycle, activities: [], connectionLastMessageAt: null, today: await plusDays(d0, 3) });
    assert.equal(state?.kind, "overdue");
  });
});


// ---- review fixes -------------------------------------------------------------------------------------------------------

/** A cycle opened `startedDaysAgo` Argentina days before today, still unworked; its last touch was `lastTouchDaysAgo` days ago. */
async function seedCarried(tx: Tx, bdId: string, personId: string, startedDaysAgo: number, lastTouchDaysAgo: number) {
  const { followUpQueueItem } = await import("@/db/schema");
  const start = await plusDays(await today(), -startedDaysAgo);
  const [row] = await tx
    .insert(followUpQueueItem)
    .values({
      bdId,
      personId,
      queueDate: start,
      cycleStartedOn: start,
      position: 1,
      dueStatus: "contacted",
      lastTouchAt: ago(lastTouchDaysAgo),
      createdAt: ago(startedDaysAgo),
    })
    .returning();
  return row!;
}

async function addActivity(tx: Tx, personId: string, type: string, createdAt: Date, extra: { metadata?: Record<string, unknown>; deletedAt?: Date } = {}) {
  const { activity } = await import("@/db/schema");
  await tx.insert(activity).values({ personId, type, createdAt, metadata: extra.metadata ?? {}, deletedAt: extra.deletedAt ?? null });
}

async function badge(tx: Tx, bdId: string, queueDate: string) {
  const { buildAppShellBadgeCountsQuery } = await import("@/lib/shell/appShellBadgeCountsQuery");
  const { argentinaDayBoundaries, argentinaInstantDayWindow } = await import("@/lib/tasks/argentinaDate");
  const w = argentinaInstantDayWindow(NOW);
  const [counts] = (await tx.execute(
    buildAppShellBadgeCountsQuery({
      bdId,
      queueDate,
      tomorrowStartUtcIso: argentinaDayBoundaries(NOW).tomorrowStartUtc.toISOString(),
      workedTodayFromIso: w.fromUtc.toISOString(),
      workedTodayToIso: w.toUtc.toISOString(),
      nowIso: NOW.toISOString(),
    }),
  )) as unknown as { follow_up_count: number; follow_up_overdue_count: number }[];
  return { total: Number(counts!.follow_up_count), overdue: Number(counts!.follow_up_overdue_count) };
}

test("the page builds today's queue even when carried items already show in the read", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { getFollowUpQueuePage } = await import("@/lib/followUp/queueQueries");
    const bdId = await seedBd(tx);
    const carried = await seedPerson(tx, bdId, "carried", "contacted", 7);
    await seedCarried(tx, bdId, carried, 1, 7);
    const fresh = await seedPerson(tx, bdId, "fresh", "contacted", 6);
    const page = await getFollowUpQueuePage(bdId, NOW, tx as never);
    assert.deepEqual(page.map((r) => r.personId).sort(), [carried, fresh].sort());
    const d0 = await today();
    assert.equal((await rowsFor(tx, bdId)).filter((r) => r.queueDate === d0).length, 1, "today's row for the new contact was written");
  });
});

test("a note that was added and then soft-deleted still closes the cycle: deleting text does not un-count work", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const id = await seedPerson(tx, bdId, "deleted", "contacted", 7);
    await seedCarried(tx, bdId, id, 1, 7);
    assert.equal((await read(tx, bdId, await today())).length, 1);
    await addActivity(tx, id, "note", hoursAgo(30), { deletedAt: hoursAgo(1) });
    assert.equal((await read(tx, bdId, await today())).length, 0);
  });
});

test("only the owner's worked set closes a cycle: a Hunter lookup or a status change does not, a reply does", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const d0 = await today();
    const p = await seedPerson(tx, bdId, "hunter", "contacted", 10);
    await seedCarried(tx, bdId, p, 4, 10);
    await addActivity(tx, p, "hunter_lookup", hoursAgo(30));
    await addActivity(tx, p, "status_change", hoursAgo(30), { metadata: { status: "contacted" } });
    const page = await read(tx, bdId, d0);
    assert.deepEqual(page.map((r) => r.personId), [p], "the Vencido keeps its clock");
    await addActivity(tx, p, "reply_received", hoursAgo(30), { metadata: { occurredAt: hoursAgo(30).toISOString() } });
    assert.equal((await read(tx, bdId, d0)).length, 0, "a reply closes it");
  });
});

test("a Hunter lookup on a carried item does not let selection queue the same contact a second time", async () => {
  await inRolledBackTransaction(async (tx) => {
    const bdId = await seedBd(tx);
    const d0 = await today();
    // Last real touch 10 days ago, cycle opened 4 days ago, Hunter lookup 6 days ago: fuq_last_touch moved and is due again.
    const p = await seedPerson(tx, bdId, "dup", "contacted", 10);
    await seedCarried(tx, bdId, p, 4, 10);
    await addActivity(tx, p, "hunter_lookup", ago(6));
    await materialize(tx, bdId, d0);
    assert.equal((await rowsFor(tx, bdId)).filter((r) => r.personId === p).length, 1);
  });
});

test("a carried item worked TODAY stays on the page as done, for the Hoy progress; worked yesterday it is gone", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { classifyQueueItems } = await import("@/lib/followUp/cycle");
    const bdId = await seedBd(tx);
    const d0 = await today();
    const normal = await seedPerson(tx, bdId, "normal", "contacted", 7);
    const overdue = await seedPerson(tx, bdId, "overdue", "contacted", 10);
    const gone = await seedPerson(tx, bdId, "gone", "contacted", 7);
    await seedCarried(tx, bdId, normal, 1, 7);
    await seedCarried(tx, bdId, overdue, 4, 10);
    await seedCarried(tx, bdId, gone, 1, 7);
    await addActivity(tx, normal, "note", NOW);
    await addActivity(tx, overdue, "call", NOW, { metadata: { outcome: "connected" } });
    await addActivity(tx, gone, "note", hoursAgo(30));
    const page = await read(tx, bdId, d0);
    assert.deepEqual(page.map((r) => r.personId).sort(), [normal, overdue].sort());
    assert.ok(page.every((r) => r.workedToday && r.state === "pending"));
    const { today: hoy, overdue: venc } = classifyQueueItems(page, d0);
    assert.equal(hoy.length, 2, "both count in Hoy's progress");
    assert.equal(venc.length, 0);
    assert.deepEqual(await badge(tx, bdId, d0), { total: 0, overdue: 0 }, "the badge counts only what is still pending");
  });
});

/** Committed fixtures for the concurrency tests (a rolled-back transaction cannot show two connections the same rows). Cleans up. */
async function withCommittedBd(body: (ctx: { bdId: string; db: typeof import("@/db").db }) => Promise<void>) {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const tag = Math.random().toString(36).slice(2);
  // The expiry job is global, so a fixture left behind by an interrupted run would be counted by the next one: sweep first.
  const { like, inArray } = await import("drizzle-orm");
  const stale = (await db.select({ id: bd.id }).from(bd).where(like(bd.email, "zz-fc-%"))).map((r) => r.id);
  if (stale.length) {
    await db.delete(person).where(inArray(person.ownerBdId, stale));
    await db.delete(bd).where(inArray(bd.id, stale));
  }
  const [me] = await db.insert(bd).values({ email: `zz-fc-${tag}@example.test`, name: "ZZ Concurrent" }).returning();
  try {
    await body({ bdId: me!.id, db });
  } finally {
    await db.delete(person).where(eq(person.ownerBdId, me!.id));
    await db.delete(bd).where(eq(bd.id, me!.id));
  }
}

test("two drops at once write one activity: the second evaluates 'open' only after it holds the row lock", async () => {
  await withCommittedBd(async ({ bdId, db }) => {
    const { followUpQueueItem, activity } = await import("@/db/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    const { dropFollowUp } = await import("@/lib/followUp/dropQueries");
    const p = await db.transaction((tx) => seedPerson(tx, bdId, "race", "contacted", 10));
    const row = await db.transaction((tx) => seedCarried(tx, bdId, p, 4, 10));
    const today3 = await today();
    // A holds the row lock and drops it; B starts meanwhile and must wait for A's commit, then see the drop.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${followUpQueueItem} where id = ${row.id}::uuid for update`);
      await tx.insert(activity).values({ personId: p, actorBdId: bdId, type: "follow_up_dropped", metadata: {} });
      await gate;
    });
    await new Promise((r) => setTimeout(r, 150));
    const b = dropFollowUp({ itemId: row.id, bdId, reason: "not_now", detail: null, today: today3 });
    await new Promise((r) => setTimeout(r, 300));
    release();
    await a;
    assert.deepEqual(await b, { dropped: false });
    const rows = await db.select().from(activity).where(and(eq(activity.personId, p), eq(activity.type, "follow_up_dropped")));
    assert.equal(rows.length, 1);
  });
});

test("two expiry runs at once write one activity: the second waits on the advisory lock and then finds nothing", async () => {
  await withCommittedBd(async ({ bdId, db }) => {
    const { activity } = await import("@/db/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    const { EXPIRY_LOCK_KEY, expireOverdueFollowUps } = await import("@/lib/followUp/dropQueries");
    const p = await db.transaction((tx) => seedPerson(tx, bdId, "race2", "contacted", 14));
    await db.transaction((tx) => seedCarried(tx, bdId, p, 11, 14));
    const day = await today();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${EXPIRY_LOCK_KEY})`);
      const n = await expireOverdueFollowUps(day, tx as never);
      await gate;
      return n;
    });
    await new Promise((r) => setTimeout(r, 150));
    const b = expireOverdueFollowUps(day, db);
    await new Promise((r) => setTimeout(r, 300));
    release();
    assert.equal(await a, 1);
    assert.equal(await b, 0);
    const rows = await db.select().from(activity).where(and(eq(activity.personId, p), eq(activity.type, "follow_up_expired")));
    assert.equal(rows.length, 1);
  });
});

test("a drop cannot change the person row at all, even when the cached status disagrees with the derived one", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { person } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { dropFollowUp } = await import("@/lib/followUp/dropQueries");
    const bdId = await seedBd(tx);
    // Cached 'replied', but the only activity is an email we sent: recomputing would flip it to 'contacted'.
    const id = await seedPerson(tx, bdId, "inconsistent", "replied", 10);
    await tx.update(person).set({ status: "replied" }).where(eq(person.id, id));
    const item = await seedCarried(tx, bdId, id, 4, 10);
    const [before] = await tx.select().from(person).where(eq(person.id, id));
    assert.deepEqual(await dropFollowUp({ itemId: item.id, bdId, reason: "not_now", detail: null, today: await today() }, tx as never), { dropped: true });
    const [after] = await tx.select().from(person).where(eq(person.id, id));
    assert.deepEqual(after, before);
  });
});
