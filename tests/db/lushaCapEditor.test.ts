/**
 * lusha-cap-editor against a scratch database (migration 0060 applied): the audited write of a BD's personal cap, and today's spend
 * in the admin report. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database. NEVER calls Lusha.
 * Everything is created under a per-run token and removed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const personIds: string[] = [];
let admin: { id: string; role: string };
let ana: { id: string };
let lucia: { id: string };

async function mkBd(name: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `${name} ${run}`, email: `zz-cap-${name.toLowerCase()}-${run}@example.test`, ...over }).returning();
  bdIds.push(b.id);
  return b;
}

async function state(bdId: string) {
  const { db } = await import("@/db");
  const { auditLog, bd } = await import("@/db/schema");
  const { asc, eq } = await import("drizzle-orm");
  const [row] = await db.select({ cap: bd.lushaPersonalDailyCreditCap }).from(bd).where(eq(bd.id, bdId));
  const audit = await db.select().from(auditLog).where(eq(auditLog.targetBdId, bdId)).orderBy(asc(auditLog.at));
  return { cap: row.cap, audit: audit.filter((a) => a.action.startsWith("bd_lusha_cap_")) };
}

before(async () => {
  admin = await mkBd("Admin", { role: "admin", lushaEnabled: true });
  ana = await mkBd("Ana", { lushaEnabled: true });
  lucia = await mkBd("Lucia", { lushaEnabled: true });
});

after(async () => {
  const { db } = await import("@/db");
  const { auditLog, bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(auditLog).where(inArray(auditLog.actorBdId, bdIds));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(bd).where(inArray(bd.id, bdIds));
});

test("a BD starts with no personal cap, and a non-admin cannot set one: nothing is written", async () => {
  const { setLushaPersonalCap } = await import("@/lib/lusha/adminDb");
  assert.equal((await state(ana.id)).cap, null);
  await assert.rejects(() => setLushaPersonalCap({ actor: { id: ana.id, role: "bd" }, bdId: ana.id, cap: 50 }), { name: "AdminRequiredError" });
  const s = await state(ana.id);
  assert.deepEqual([s.cap, s.audit.length], [null, 0]);
});

test("a change records exactly one audit row with the actor, the new value and the previous one, in the same write", async () => {
  const { setLushaPersonalCap } = await import("@/lib/lusha/adminDb");
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: ana.id, cap: 12 }), { ok: true, changed: true });
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: ana.id, cap: 8 }), { ok: true, changed: true });
  const s = await state(ana.id);
  assert.equal(s.cap, 8);
  assert.deepEqual(s.audit.map((a) => [a.action, a.actorBdId, a.metadata]), [
    ["bd_lusha_cap_set", admin.id, { cap: 12, previousCap: null }],
    ["bd_lusha_cap_set", admin.id, { cap: 8, previousCap: 12 }],
  ]);
});

test("saving the same value again records nothing", async () => {
  const { setLushaPersonalCap } = await import("@/lib/lusha/adminDb");
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: ana.id, cap: 8 }), { ok: true, changed: false });
  assert.equal((await state(ana.id)).audit.length, 2);
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: lucia.id, cap: null }), { ok: true, changed: false }, "null over null is not a change either");
  assert.equal((await state(lucia.id)).audit.length, 0);
});

test("null and 0 stay different all the way through: 0 -> null -> 0", async () => {
  const { setLushaPersonalCap } = await import("@/lib/lusha/adminDb");
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: lucia.id, cap: 0 }), { ok: true, changed: true });
  assert.equal((await state(lucia.id)).cap, 0, "0 is stored as 0 (blocked), not as no cap");
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: lucia.id, cap: null }), { ok: true, changed: true });
  assert.equal((await state(lucia.id)).cap, null, "clearing stores no cap, not 0");
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: lucia.id, cap: 0 }), { ok: true, changed: true });
  const s = await state(lucia.id);
  assert.equal(s.cap, 0);
  assert.deepEqual(s.audit.map((a) => [a.action, a.metadata]), [
    ["bd_lusha_cap_set", { cap: 0, previousCap: null }],
    ["bd_lusha_cap_cleared", { cap: null, previousCap: 0 }],
    ["bd_lusha_cap_set", { cap: 0, previousCap: null }],
  ]);
});

test("every rejected input touches no row, and an unknown BD is not_found", async () => {
  const { setLushaPersonalCap } = await import("@/lib/lusha/adminDb");
  const before = await state(ana.id);
  for (const bad of [1.5, -1, 1000, Number.NaN, "8", undefined, Infinity]) {
    assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: ana.id, cap: bad as never }), { ok: false, reason: "invalid" }, String(bad));
  }
  assert.deepEqual(await state(ana.id), before);
  assert.deepEqual(await setLushaPersonalCap({ actor: admin, bdId: randomUUID(), cap: 5 }), { ok: false, reason: "not_found" });
});

test("the report's 'today' is the cap's own Argentina day and credit definition, apart from the period's charged sum", async () => {
  const { db } = await import("@/db");
  const { lushaReveal, person } = await import("@/db/schema");
  const { getLushaUsageReport } = await import("@/lib/lusha/adminDb");
  const { artDayWindow } = await import("@/lib/lusha/cap");
  const [p] = await db.insert(person).values({ firstName: "Day", lastName: run }).returning();
  personIds.push(p.id);
  const now = new Date("2031-03-10T15:00:00Z");
  const day = artDayWindow(now);
  const row = (over: Record<string, unknown>) => ({ personId: p.id, field: "search", state: "settled", outcome: "matched", creditsReserved: 1, creditsCharged: 1, actorBdId: ana.id, at: now, ...over });
  await db.insert(lushaReveal).values([
    row({ creditsCharged: 3 }),
    row({ field: "emails", state: "failed", outcome: null, errorCode: "outcome_unknown", creditsReserved: 1, creditsCharged: null }), // reserved, never charged: counts against the cap
    row({ creditsCharged: 7, at: new Date(day.start.getTime() - 1) }), // the evening before, Argentina time
    row({ creditsCharged: 9, at: day.end }), // the next day
    row({ actorBdId: lucia.id, creditsCharged: 2 }),
  ] as never);
  const rows = await getLushaUsageReport({ start: new Date("2031-03-01T03:00:00Z"), end: new Date("2031-04-01T03:00:00Z") }, now);
  const a = rows.find((r) => r.bdId === ana.id)!;
  const l = rows.find((r) => r.bdId === lucia.id)!;
  assert.deepEqual([a.todayCredits, l.todayCredits, rows.find((r) => r.bdId === admin.id)!.todayCredits], [4, 2, 0]);
  assert.equal(a.chargedCredits, 3 + 7 + 9, "the period's charged sum is a different number and is unchanged");
});
