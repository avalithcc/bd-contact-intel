/**
 * gmail-reminder-email against a scratch database (migration 0048 applied): the backfill, the claim idempotency, the
 * throttled last_seen write and the batched candidate read. Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local
 * `_e2e` database. Never sends mail. Everything is created under a per-run token and removed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];

async function mkBd(name: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `${name} ${run}`, email: `zz-${name.toLowerCase()}-${run}@example.test`, ...over }).returning();
  bdIds.push(b.id);
  return b;
}

after(async () => {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds)); // cascades gmail_reminder_send
});

test("a BD created after the migration has last_seen_at NULL and reminders enabled", async () => {
  const b = await mkBd("Fresh");
  assert.equal(b.lastSeenAt, null);
  assert.equal(b.emailRemindersEnabled, true);
});

test("migration 0048 backfills existing BDs to now() once; a rerun leaves a NULL and real values alone", async () => {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { createIsolatedBd, migrationStatements } = await import("../support/migrationReplay");
  const schema = `mig0048_${run}`;
  const statements = migrationStatements(readFileSync(join(__dirname, "..", "..", "drizzle", "0048_gmail_reminder.sql"), "utf8"), schema);
  const ROLLBACK = new Error("rollback");
  const seen: Record<string, unknown> = {};
  await db
    .transaction(async (tx) => {
      // The world before 0048, in a private schema: DDL on the shared `bd` would lock out (and deadlock with) the other files.
      await createIsolatedBd(tx, schema);
      await tx.execute(sql`insert into bd (name, email) values ('old', ${`zz-old-${run}@example.test`})`);
      await tx.execute(sql`insert into bd (name, email) values ('ZZ E2E', 'e2e-bot@avalith.net') on conflict (email) do nothing`);
      await tx.execute(sql`insert into bd (name, email) values ('ZZ Otro', 'otro-bd-e2e@avalith.net') on conflict (email) do nothing`);
      for (const s of statements) await tx.execute(sql.raw(s));
      const first = (await tx.execute(sql`select last_seen_at is not null as pb_set, now() - last_seen_at < interval '1 minute' as pb_recent from bd where email = ${`zz-old-${run}@example.test`}`)) as unknown as { pb_set: boolean; pb_recent: boolean }[];
      seen.backfilled = first[0];
      await tx.execute(sql`update bd set email_reminders_enabled = true where email = 'otro-bd-e2e@avalith.net'`); // an operator re-enables one
      await tx.execute(sql`insert into bd (name, email) values ('new', ${`zz-new-${run}@example.test`})`);
      for (const s of statements) await tx.execute(sql.raw(s)); // the migration runs a second time
      const after = (await tx.execute(sql`select email as pb_email, last_seen_at is null as pb_null from bd where email like ${`zz-%-${run}@example.test`}`)) as unknown as { pb_email: string; pb_null: boolean }[];
      for (const r of after) seen[r.pb_email] = r.pb_null;
      const flags = (await tx.execute(sql`select email as pb_email, email_reminders_enabled as pb_on from bd where email in ('e2e-bot@avalith.net', 'otro-bd-e2e@avalith.net', ${`zz-old-${run}@example.test`})`)) as unknown as { pb_email: string; pb_on: boolean }[];
      for (const r of flags) seen[`flag:${r.pb_email}`] = r.pb_on;
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  assert.deepEqual(seen.backfilled, { pb_set: true, pb_recent: true });
  assert.equal(seen[`zz-old-${run}@example.test`], false, "a rerun keeps the backfilled value");
  assert.equal(seen[`zz-new-${run}@example.test`], true, "a rerun must not stamp a BD created after the first run");
  assert.equal(seen["flag:e2e-bot@avalith.net"], false, "the e2e test account is switched off by email");
  assert.equal(seen["flag:otro-bd-e2e@avalith.net"], true, "a rerun must not undo a later change to the flag");
  assert.equal(seen[`flag:zz-old-${run}@example.test`], true, "any other existing BD stays enabled");
});

test("claimGmailReminder: the same BD on the same day twice yields one claim; another day or BD claims again", async () => {
  const { claimGmailReminder } = await import("@/lib/gmail/reminderQueries");
  const a = await mkBd("ClaimA");
  const b = await mkBd("ClaimB");
  const first = await claimGmailReminder(a.id, "2026-10-16", 1);
  const dup = await claimGmailReminder(a.id, "2026-10-16", 1);
  assert.ok(first);
  assert.equal(dup, null);
  assert.ok(await claimGmailReminder(a.id, "2026-10-17", 2));
  assert.ok(await claimGmailReminder(b.id, "2026-10-16", 1));
});

test("concurrent claims for the same BD and day: exactly one wins", async () => {
  const { claimGmailReminder } = await import("@/lib/gmail/reminderQueries");
  const c = await mkBd("Race");
  const results = await Promise.all([1, 2, 3, 4].map(() => claimGmailReminder(c.id, "2026-10-20", 1)));
  assert.equal(results.filter((r) => r !== null).length, 1);
});

test("touchLastSeen writes when NULL, skips inside the throttle window, writes again once it has passed", async () => {
  const { touchLastSeen } = await import("@/lib/auth/lastSeenDb");
  const { LAST_SEEN_THROTTLE_MS } = await import("@/lib/auth/lastSeenPolicy");
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const b = await mkBd("Seen");
  const read = async () => (await db.select({ at: bd.lastSeenAt }).from(bd).where(eq(bd.id, b.id)))[0]!.at;

  const t0 = new Date("2026-10-16T12:00:00Z");
  assert.equal(await touchLastSeen(b.id, t0), true);
  assert.equal((await read())!.toISOString(), t0.toISOString());

  const soon = new Date(t0.getTime() + 60_000);
  assert.equal(await touchLastSeen(b.id, soon), false);
  assert.equal((await read())!.toISOString(), t0.toISOString(), "unchanged inside the window");

  const later = new Date(t0.getTime() + LAST_SEEN_THROTTLE_MS + 1000);
  assert.equal(await touchLastSeen(b.id, later), true);
  assert.equal((await read())!.toISOString(), later.toISOString());
});

test("getReminderRows: one read returns each BD with its account state and only its sent reminders", async () => {
  const { claimGmailReminder, getReminderRows, markGmailReminderFailed, markGmailReminderSent } = await import("@/lib/gmail/reminderQueries");
  const { rowToCandidate } = await import("@/lib/gmail/reminderRows");
  const { planGmailReminders } = await import("@/lib/gmail/reminderPlan");
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const d = await mkBd("Rows");
  const sentAt = new Date("2026-10-10T12:00:00Z");
  await db.update(bd).set({ lastSeenAt: new Date("2026-10-05T12:00:00Z") }).where(eq(bd.id, d.id));
  await markGmailReminderSent((await claimGmailReminder(d.id, "2026-10-10", 1))!, sentAt);
  await markGmailReminderFailed((await claimGmailReminder(d.id, "2026-10-11", 2))!, "boom");
  await claimGmailReminder(d.id, "2026-10-12", 2); // left pending

  const rows = await getReminderRows();
  const mine = rows.find((r) => r.rm_bd_id === d.id)!;
  assert.equal(mine.rm_has_account, false);
  assert.equal(mine.rm_reminders_enabled, true);
  assert.equal(mine.rm_sent.length, 1, "failed and pending rows are not reminders that went out");

  const now = new Date("2026-10-16T12:00:00Z");
  const [decision] = planGmailReminders([rowToCandidate(mine, now)], now);
  assert.deepEqual(decision, { bdId: d.id, action: "send", number: 2, notifyOwner: false });
});
