/**
 * The metadata timestamp casts behind the reports must be total: a value that LOOKS like an ISO datetime but is not a real
 * one ('2026-02-30T10:00:00Z', 'T25:00') used to make Postgres throw inside the per-BD report and the meetings drill-down.
 * It must fall back to created_at instead. Scratch database only (`npm run test:db`).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const CREATED = new Date("2026-10-05T15:00:00Z");
const BAD_VALUES = ["2026-02-30T10:00:00Z", "2026-10-02T25:00:00Z", "2026-13-01T10:00:00Z", "2026-10-02T10:61:00Z", "2026-02-29T10:00:00Z", "2026-10-02T10:00:00garbage"];
let bdId: string;
let personId: string;

before(async () => {
  const { db } = await import("@/db");
  const { activity, bd, person } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Cast", email: `zz-cast-${run}@example.test` }).returning();
  bdId = b!.id;
  const email = `cast-${run}@reports.test`;
  const [p] = await db.insert(person).values({ firstName: "Cast", lastName: run, email, emailNormalized: email, ownerBdId: bdId, status: "meeting" }).returning();
  personId = p!.id;
  await db.insert(activity).values([
    ...BAD_VALUES.map((at) => ({ personId, actorBdId: bdId, type: "meeting_logged", metadata: { at }, createdAt: CREATED })),
    { personId, actorBdId: bdId, type: "meeting_logged", metadata: { at: "2028-02-29T10:00:00.000Z" }, createdAt: CREATED }, // real leap day
    { personId, actorBdId: bdId, type: "status_backfill", metadata: { originalAt: "2026-02-30T10:00:00Z", status: "contacted" }, createdAt: CREATED },
    { personId, actorBdId: bdId, type: "call", metadata: { occurredAt: "2026-10-02T25:00:00Z" }, createdAt: CREATED },
  ]);
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(person).where(eq(person.id, personId));
  await db.delete(bd).where(eq(bd.id, bdId));
});

test("per-BD report and meetings drill-down do not throw on impossible dates and fall back to created_at", async () => {
  const { getMeetingsDrilldown, getReportPerBd } = await import("@/lib/reports/queriesDb");
  const params = { fromIso: "2026-10-01T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z" };
  const perBd = await getReportPerBd({ ...params, fromDate: "2026-10-01", toDateExclusive: "2026-11-01", bdId });
  const mine = perBd.find((r) => r.bdId === bdId)!;
  assert.equal(mine.meetings, BAD_VALUES.length, "every bad value counted on its created_at; the 2028 leap-day one is in the future");
  assert.equal(mine.calls, 1, "the bad occurredAt falls back to created_at");
  const rows = await getMeetingsDrilldown({ ...params, bdId });
  assert.equal(rows.length, BAD_VALUES.length);
  for (const r of rows) assert.equal(r.meetingAt.toISOString(), CREATED.toISOString());
});

test("a real leap day is honored, an impossible 2026-02-29 is not", async () => {
  const { getMeetingsDrilldown } = await import("@/lib/reports/queriesDb");
  const rows = await getMeetingsDrilldown({ fromIso: "2028-02-29T00:00:00.000Z", toIso: "2028-03-01T00:00:00.000Z", bdId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.meetingAt.toISOString(), "2028-02-29T10:00:00.000Z");
});

test("the shared effective time (status_backfill originalAt) is total too", async () => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const { effectiveActivityAtSql } = await import("@/lib/contacts/effectiveActivityTime");
  const rows = Array.from(
    await db.execute(sql`select ${effectiveActivityAtSql()} as at from ${activity} where activity.person_id = ${personId}::uuid and activity.type = 'status_backfill'`),
  ) as { at: Date | string }[];
  assert.equal(new Date(rows[0]!.at).toISOString(), CREATED.toISOString());
});
