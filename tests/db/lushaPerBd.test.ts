/**
 * lusha-per-bd against a scratch database (migration 0047 applied): the switch's default and its migration, the server-side
 * refusal, the audited toggle, and the admin report. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e`
 * database. NEVER calls Lusha: the ledger rows are seeded by hand. Everything is created under a per-run token and removed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const OPEN_LIMITS = { dailyCap: 1_000_000, monthlyCap: 1_000_000, cycleStartDay: 1 };
const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const personIds: string[] = [];
let admin: { id: string; role: string };
let ana: { id: string };
let lucia: { id: string };

async function mkBd(name: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `${name} ${run}`, email: `zz-${name.toLowerCase()}-${run}@example.test`, ...over }).returning();
  bdIds.push(b.id);
  return b;
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
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds)); // cascades the ledger
  await db.delete(bd).where(inArray(bd.id, bdIds));
});

test("a BD created without saying anything starts with Lusha disabled", async () => {
  const fresh = await mkBd("Fresh");
  assert.equal(fresh.lushaEnabled, false);
});

test("migration 0047 enables every BD that exists and leaves later ones disabled; a rerun changes nothing", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { createIsolatedBd, migrationStatements } = await import("../support/migrationReplay");
  const schema = `mig0047_${run}`;
  const statements = migrationStatements(readFileSync(join(__dirname, "..", "..", "drizzle", "0047_bd_lusha_enabled.sql"), "utf8"), schema);
  const ROLLBACK = new Error("rollback");
  const seen: Record<string, unknown> = {};
  await db
    .transaction(async (tx) => {
      await createIsolatedBd(tx, schema); // the world before 0047, in a private schema: DDL on the shared `bd` would lock out the other files
      await tx.execute(sql`insert into bd (name, email) values ('old', ${`zz-old-${run}@example.test`})`);
      await tx.execute(sql`insert into bd (name, email) values ('existing', ${`zz-ana-${run}@example.test`})`); // a BD that exists when 0047 first runs
      for (const s of statements) await tx.execute(sql.raw(s));
      await tx.execute(sql`insert into bd (name, email) values ('new', ${`zz-new-${run}@example.test`})`);
      await tx.execute(sql`update bd set lusha_enabled = false where email = ${`zz-old-${run}@example.test`}`); // an admin switches the old one off
      for (const s of statements) await tx.execute(sql.raw(s)); // the migration runs a second time
      const rows = (await tx.execute(sql`select email as pb_email, lusha_enabled as pb_on from bd where email like ${`zz-%-${run}@example.test`}`)) as unknown as { pb_email: string; pb_on: boolean }[];
      for (const r of rows) seen[r.pb_email] = r.pb_on;
      const first = (await tx.execute(sql`select lusha_enabled as pb_on from bd where email = ${`zz-ana-${run}@example.test`}`)) as unknown as { pb_on: boolean }[];
      seen.existingAfterRerun = first[0].pb_on;
      throw ROLLBACK; // DDL is transactional: the scratch schema is untouched
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  assert.equal(seen[`zz-new-${run}@example.test`], false, "a BD created after the migration starts disabled");
  assert.equal(seen[`zz-old-${run}@example.test`], false, "a rerun must not re-enable a BD an admin switched off");
  assert.equal(seen.existingAfterRerun, true, "a BD that existed when the migration first ran is enabled");
});

test("reserve() refuses a disabled BD inside the lock: no ledger row is written", async () => {
  const { db } = await import("@/db");
  const { lushaReveal, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { reserve } = await import("@/lib/lusha/revealDb");
  const off = await mkBd("Off", { lushaEnabled: false });
  const [p] = await db.insert(person).values({ firstName: "Off", lastName: run }).returning();
  personIds.push(p.id);
  const longAgo = new Date("2020-03-15T15:00:00Z"); // a day of its own: the cap is global, so a test must not add to today's spend, nor reap other files' rows
  const r = await reserve({ personId: p.id, field: "search", actorBdId: off.id, limits: OPEN_LIMITS, now: longAgo });
  assert.deepEqual(r, { ok: false, reason: "not_enabled" });
  assert.equal((await db.select().from(lushaReveal).where(eq(lushaReveal.personId, p.id))).length, 0);
  const on = await reserve({ personId: p.id, field: "search", actorBdId: ana.id, limits: OPEN_LIMITS, now: longAgo });
  assert.equal(on.ok, true, "the same Contact is reservable by an enabled BD");
});

test("only an admin can flip the switch; a refused attempt changes nothing and records nothing", async () => {
  const { db } = await import("@/db");
  const { auditLog, bd } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { setLushaEnabled } = await import("@/lib/lusha/adminDb");
  await assert.rejects(() => setLushaEnabled({ actor: { id: ana.id, role: "bd" }, bdId: ana.id, enabled: false }), { name: "AdminRequiredError" });
  assert.equal((await db.select().from(bd).where(eq(bd.id, ana.id)))[0].lushaEnabled, true);
  assert.equal((await db.select().from(auditLog).where(eq(auditLog.actorBdId, ana.id))).length, 0);
});

test("a toggle is recorded with the admin who made it, in the same write; a no-op records nothing; admins have their own switch", async () => {
  const { db } = await import("@/db");
  const { auditLog, bd } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { isLushaEnabled, setLushaEnabled } = await import("@/lib/lusha/adminDb");
  const off = await setLushaEnabled({ actor: admin, bdId: lucia.id, enabled: false });
  assert.deepEqual(off, { ok: true, changed: true });
  assert.equal(await isLushaEnabled(lucia.id), false);
  const again = await setLushaEnabled({ actor: admin, bdId: lucia.id, enabled: false });
  assert.deepEqual(again, { ok: true, changed: false });
  const rows = await db.select().from(auditLog).where(and(eq(auditLog.targetBdId, lucia.id)));
  assert.equal(rows.length, 1, "the no-op wrote nothing");
  assert.deepEqual([rows[0].action, rows[0].actorBdId, rows[0].metadata], ["bd_lusha_disable", admin.id, { enabled: false }]);
  await setLushaEnabled({ actor: admin, bdId: lucia.id, enabled: true });
  assert.equal((await db.select().from(auditLog).where(eq(auditLog.targetBdId, lucia.id))).filter((r) => r.action === "bd_lusha_enable").length, 1);
  // The admin switches themselves off like anyone else, and is then refused like anyone else.
  await setLushaEnabled({ actor: admin, bdId: admin.id, enabled: false });
  assert.equal((await db.select().from(bd).where(eq(bd.id, admin.id)))[0].lushaEnabled, false);
  assert.deepEqual(await setLushaEnabled({ actor: admin, bdId: randomUUID(), enabled: true }), { ok: false, reason: "not_found" });
  await setLushaEnabled({ actor: admin, bdId: admin.id, enabled: true });
});

test("the report matches the seeded ledger for the period, keeps a disabled BD's consumption, and counts charged apart from reserved", async () => {
  const { db } = await import("@/db");
  const { lushaReveal, person } = await import("@/db/schema");
  const { getLushaUsageReport, setLushaEnabled } = await import("@/lib/lusha/adminDb");
  const { summarizeUsage } = await import("@/lib/lusha/usageReport");
  const [p] = await db.insert(person).values({ firstName: "Report", lastName: run }).returning();
  personIds.push(p.id);
  // A window far from real data, so only these rows are in it.
  const start = new Date("2031-03-01T03:00:00Z");
  const end = new Date("2031-04-01T03:00:00Z");
  const at = (d: string) => new Date(`2031-03-${d}T15:00:00Z`);
  const row = (over: Record<string, unknown>) => ({ personId: p.id, field: "search", state: "settled", creditsReserved: 1, creditsCharged: 1, actorBdId: ana.id, at: at("05"), ...over });
  await db.insert(lushaReveal).values([
    row({ outcome: "matched", creditsCharged: 1 }),
    row({ field: "emails", outcome: "revealed", creditsReserved: 1, creditsCharged: 1, at: at("06") }),
    row({ field: "phones", outcome: "revealed", creditsReserved: 5, creditsCharged: 5, at: at("07") }),
    row({ field: "emails", state: "failed", outcome: null, errorCode: "outcome_unknown", creditsReserved: 1, creditsCharged: null, at: at("08") }), // reserved, never charged
    row({ field: "search", outcome: "match_rejected", creditsCharged: 1, rejectedByBdId: ana.id, rejectedAt: at("09"), at: at("09") }),
    row({ actorBdId: lucia.id, outcome: "matched", creditsCharged: 1, at: at("10") }),
    row({ outcome: "matched", creditsCharged: 9, at: new Date("2031-02-27T15:00:00Z") }), // before the window
    row({ outcome: "matched", creditsCharged: 9, at: new Date("2031-04-02T15:00:00Z") }), // after it
  ] as never);
  await setLushaEnabled({ actor: admin, bdId: ana.id, enabled: false }); // disabling deletes nothing
  const rows = await getLushaUsageReport({ start, end });
  const a = rows.find((r) => r.bdId === ana.id)!;
  const l = rows.find((r) => r.bdId === lucia.id)!;
  assert.deepEqual([a.lushaEnabled, a.chargedCredits, a.pendingCredits, a.emails, a.phones, a.rejections], [false, 8, 1, 1, 1, 1]);
  assert.equal(a.lastUseAt!.toISOString(), new Date("2031-04-02T15:00:00Z").toISOString(), "last use is all-time, not just the period");
  assert.equal(a.toggledByName, `Admin ${run}`);
  assert.deepEqual([l.lushaEnabled, l.chargedCredits, l.pendingCredits, l.emails, l.phones, l.rejections], [true, 1, 0, 0, 0, 0]);
  assert.ok(rows.every((r) => r.chargedCredits >= 0 && Number.isInteger(r.chargedCredits)), "aggregates arrive as numbers");
  const mine = rows.filter((r) => [ana.id, lucia.id, admin.id].includes(r.bdId));
  assert.deepEqual([summarizeUsage(mine).chargedCredits, summarizeUsage(mine).reveals], [9, 2]);
  // Scoped to this run's BDs: other test files create and delete BDs in parallel, so the table-wide row count is not stable.
  const seeded = rows.filter((r) => bdIds.includes(r.bdId));
  assert.deepEqual([...seeded.map((r) => r.bdId)].sort(), [...bdIds].sort(), "every seeded BD is in the report exactly once, so none loses its switch");
  assert.equal(new Set(rows.map((r) => r.bdId)).size, rows.length, "the report never repeats a BD");
  await setLushaEnabled({ actor: admin, bdId: ana.id, enabled: true });
});
