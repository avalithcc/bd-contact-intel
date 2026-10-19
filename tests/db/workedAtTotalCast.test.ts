/**
 * The "worked" pivots (queue worked-today, app-shell badge, per-day report) cast metadata.occurredAt to timestamptz. A
 * prefix-only regex let '2026-02-30T10:00:00Z' through and Postgres threw, taking the whole page/report down. The cast
 * must be total: an impossible date falls back to created_at. Scratch database only (`npm run test:db`).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const CREATED = new Date("2026-10-05T15:00:00Z");
const BAD_VALUES = ["2026-02-30T10:00:00Z", "2026-10-02T25:00:00Z", "2026-13-01T10:00:00Z", "2026-02-29T10:00:00Z", "2026-10-02T10:00:00garbage"];
let bdId: string;
let personId: string;

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Worked", email: `zz-worked-${run}@example.test` }).returning();
  bdId = b!.id;
  const email = `worked-${run}@reports.test`;
  const [p] = await db.insert(person).values({ firstName: "Worked", lastName: run, email, emailNormalized: email, ownerBdId: bdId }).returning();
  personId = p!.id;
  await db.insert(activity).values([
    ...BAD_VALUES.map((occurredAt) => ({ personId, actorBdId: bdId, type: "email_sent", metadata: { occurredAt }, createdAt: CREATED })),
    { personId, actorBdId: bdId, type: "reply_received", metadata: { occurredAt: "2026-10-02T10:00:00.000Z" }, createdAt: CREATED },
    { personId, actorBdId: bdId, type: "email_sent", metadata: { occurredAt: "2028-02-29T10:00:00Z" }, createdAt: CREATED },
  ]);
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.id, personId));
  await db.delete(bd).where(eq(bd.id, bdId));
});

async function pivot(expr: import("drizzle-orm").SQL) {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const rows = Array.from(
    await db.execute(sql`select ${expr} as at, activity.metadata->>'occurredAt' as raw from activity where activity.person_id = ${personId}::uuid`),
  ) as { at: Date | string; raw: string }[];
  return rows.map((r) => ({ raw: r.raw, at: new Date(r.at).toISOString() }));
}

function assertTotal(rows: { raw: string; at: string }[]) {
  assert.equal(rows.length, BAD_VALUES.length + 2);
  for (const r of rows) {
    if (BAD_VALUES.includes(r.raw)) assert.equal(r.at, CREATED.toISOString(), `${r.raw} falls back to created_at`);
  }
  assert.equal(rows.find((r) => r.raw === "2026-10-02T10:00:00.000Z")!.at, "2026-10-02T10:00:00.000Z");
  assert.equal(rows.find((r) => r.raw === "2028-02-29T10:00:00Z")!.at, "2028-02-29T10:00:00.000Z", "a real leap day is honored");
}

test("reports WORKED_AT_SQL_TEXT is total", async () => {
  const { sql } = await import("drizzle-orm");
  const { WORKED_AT_SQL_TEXT } = await import("@/lib/reports/queries");
  assertTotal(await pivot(sql.raw(WORKED_AT_SQL_TEXT)));
});

test("app-shell WORKED_TODAY_AT_SQL_TEXT is total", async () => {
  const { sql } = await import("drizzle-orm");
  const { WORKED_TODAY_AT_SQL_TEXT } = await import("@/lib/shell/appShellBadgeCountsQuery");
  assertTotal(await pivot(sql.raw(WORKED_TODAY_AT_SQL_TEXT)));
});

test("queueSelection workedTodayAtSql() is total", async () => {
  const { workedTodayAtSql } = await import("@/lib/followUp/queueSelection");
  assertTotal(await pivot(workedTodayAtSql()));
});
