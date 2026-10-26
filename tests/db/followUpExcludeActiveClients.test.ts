/**
 * Seguimientos excludes contacts of ACTIVE clients (owner decision 2026-10-26), against a scratch database:
 * the insert-side selection (buildFollowUpInsertQuery), the page read (readQueueRows) and the sidebar badge
 * (buildAppShellBadgeCountsQuery) must all apply it, former clients (`inactive`) and non-clients (null) stay, and
 * the page and the badge must report the same number. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a
 * local `_e2e` database. Each test runs in one transaction rolled back by a sentinel throw.
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
const TEN_DAYS_AGO = new Date(NOW.getTime() - 10 * 24 * 3600 * 1000);

type Seeded = { bdId: string; active: string; inactive: string; none: string };

/** One BD owning three contacts, each due (contacted 10 days ago), at an active / inactive / non-client company. */
async function seed(tx: Tx): Promise<Seeded> {
  const { activity, bd, company, person } = await import("@/db/schema");
  const tag = Math.random().toString(36).slice(2);
  const [me] = await tx.insert(bd).values({ email: `zz-fa-${tag}@example.test`, name: "ZZ Follow" }).returning();
  const out: Record<string, string> = {};
  for (const [label, clientStatus] of [["active", "active"], ["inactive", "inactive"], ["none", null]] as const) {
    const companyKey = `zz-fa-${label}-${tag}`;
    await tx.insert(company).values({ companyKey, displayName: `ZZ ${label}`, clientStatus });
    const [p] = await tx
      .insert(person)
      .values({ firstName: label, lastName: "Contact", ownerBdId: me!.id, companyKey, status: "contacted" })
      .returning();
    await tx.insert(activity).values({ personId: p!.id, actorBdId: me!.id, type: "email_sent", metadata: {}, createdAt: TEN_DAYS_AGO });
    out[label] = p!.id;
  }
  return { bdId: me!.id, active: out.active!, inactive: out.inactive!, none: out.none! };
}

async function queueDate() {
  const { argentinaCalendarDate } = await import("@/lib/tasks/argentinaDate");
  return argentinaCalendarDate(NOW);
}

async function pageIds(tx: Tx, bdId: string) {
  const { readQueueRows } = await import("@/lib/followUp/queueQueries");
  return (await readQueueRows(bdId, await queueDate(), NOW, tx as never)).map((r) => r.personId).sort();
}

async function badgeCount(tx: Tx, bdId: string) {
  const { buildAppShellBadgeCountsQuery } = await import("@/lib/shell/appShellBadgeCountsQuery");
  const { argentinaDayBoundaries, argentinaInstantDayWindow } = await import("@/lib/tasks/argentinaDate");
  const w = argentinaInstantDayWindow(NOW);
  const [r] = (await tx.execute(
    buildAppShellBadgeCountsQuery({
      bdId,
      queueDate: await queueDate(),
      tomorrowStartUtcIso: argentinaDayBoundaries(NOW).tomorrowStartUtc.toISOString(),
      workedTodayFromIso: w.fromUtc.toISOString(),
      workedTodayToIso: w.toUtc.toISOString(),
      nowIso: NOW.toISOString(),
    }),
  )) as unknown as { follow_up_count: number }[];
  return Number(r!.follow_up_count);
}

test("selection and read skip an active client; an inactive client and a non-client stay", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { buildFollowUpInsertQuery } = await import("@/lib/followUp/candidateQuery");
    const s = await seed(tx);
    await tx.execute(buildFollowUpInsertQuery(s.bdId, await queueDate()));
    const expected = [s.inactive, s.none].sort();
    const { followUpQueueItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const written = (await tx.select().from(followUpQueueItem).where(eq(followUpQueueItem.bdId, s.bdId))).map((r) => r.personId).sort();
    assert.deepEqual(written, expected, "the insert-side selection must not write the active client");
    assert.deepEqual(await pageIds(tx, s.bdId), expected);
  });
});

test("a snapshot row already written for an active client is not returned by the read", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { followUpQueueItem } = await import("@/db/schema");
    const s = await seed(tx);
    const date = await queueDate();
    await tx.insert(followUpQueueItem).values(
      [s.active, s.inactive, s.none].map((personId, i) => ({ bdId: s.bdId, queueDate: date, personId, position: i + 1, dueStatus: "contacted", lastTouchAt: TEN_DAYS_AGO })),
    );
    assert.deepEqual(await pageIds(tx, s.bdId), [s.inactive, s.none].sort());
  });
});

test("a company marked active after the snapshot was written disappears from the read and the badge at once", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { followUpQueueItem, company } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const s = await seed(tx);
    const date = await queueDate();
    await tx.insert(followUpQueueItem).values(
      [s.inactive, s.none].map((personId, i) => ({ bdId: s.bdId, queueDate: date, personId, position: i + 1, dueStatus: "contacted", lastTouchAt: TEN_DAYS_AGO })),
    );
    assert.equal((await pageIds(tx, s.bdId)).length, 2);
    await tx.update(company).set({ clientStatus: "active" }).where(eq(company.displayName, "ZZ none"));
    assert.deepEqual(await pageIds(tx, s.bdId), [s.inactive]);
    assert.equal(await badgeCount(tx, s.bdId), 1);
  });
});

test("the page and the sidebar badge agree for a BD whose eligible set includes an active client", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { followUpQueueItem } = await import("@/db/schema");
    const s = await seed(tx);
    const date = await queueDate();
    await tx.insert(followUpQueueItem).values(
      [s.active, s.inactive, s.none].map((personId, i) => ({ bdId: s.bdId, queueDate: date, personId, position: i + 1, dueStatus: "contacted", lastTouchAt: TEN_DAYS_AGO })),
    );
    const page = await pageIds(tx, s.bdId);
    const badge = await badgeCount(tx, s.bdId);
    assert.equal(page.length, 2);
    assert.equal(badge, page.length, "badge and page must report the same number");
  });
});
