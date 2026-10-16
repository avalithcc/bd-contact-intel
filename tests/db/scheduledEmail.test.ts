/**
 * scheduled-send engine against a scratch database (migration 0049 applied). Opt-in and fail-closed: `npm run test:db`,
 * DATABASE_URL a local `_e2e` database. Gmail is never called: the dispatcher takes its sender as a dependency and every
 * test passes a fake. Everything is created under a per-run token and removed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const personIds: string[] = [];
const MIN = 60_000;

async function mkBd(name: string) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `${name} ${run}`, email: `zz-${name.toLowerCase()}-${run}@example.test` }).returning();
  bdIds.push(b.id);
  return b;
}
async function mkPerson(label: string) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const [p] = await db.insert(person).values({ firstName: label, lastName: run, email: `${label}-${run}@prospect.test` }).returning();
  personIds.push(p.id);
  return p;
}
async function schedule(bdId: string, personId: string, inMs = 60 * MIN, subject = "Hola") {
  const { scheduleEmail } = await import("@/lib/scheduledEmail/queries");
  const r = await scheduleEmail({ bdId, personId, toAddress: "x@prospect.test", subject, body: "Texto", sendAt: new Date(Date.now() + inMs) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; id: string }).id;
}
async function setRow(id: string, set: string) {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql.raw(`update scheduled_email set ${set} where id = '${id}'`));
}
async function getRow(id: string) {
  const { db } = await import("@/db");
  const { scheduledEmail } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(scheduledEmail).where(eq(scheduledEmail.id, id));
  return row!;
}
async function activityCount(personId: string) {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select({ id: activity.id }).from(activity).where(eq(activity.personId, personId))).length;
}
async function realDeps(send: (row: { id: string }) => Promise<{ messageId: string }>) {
  const q = await import("@/lib/scheduledEmail/queries");
  return { holdReplied: q.holdReplied, claimDue: q.claimDue, countDue: q.countDue, sweepStale: q.sweepStale, markSent: q.markSent, markFailed: q.markFailed, send };
}

after(async () => {
  const { db } = await import("@/db");
  const { bd, person } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds)); // cascades scheduled_email
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
});

test("scheduling enforces the lead limits and writes no activity (it is not a touch)", async () => {
  const { scheduleEmail } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Limits");
  const p = await mkPerson("limits");
  const base = { bdId: b.id, personId: p.id, toAddress: "x@prospect.test", subject: "s", body: "b" };
  assert.deepEqual(await scheduleEmail({ ...base, sendAt: new Date(Date.now() + 2 * MIN) }), { ok: false, reason: "schedule_too_soon" });
  assert.deepEqual(await scheduleEmail({ ...base, sendAt: new Date(Date.now() + 31 * 24 * 60 * MIN) }), { ok: false, reason: "schedule_too_far" });
  const id = await schedule(b.id, p.id);
  assert.equal((await getRow(id)).status, "scheduled");
  assert.equal(await activityCount(p.id), 0);
});

test("the cap of 50 pending per BD holds, also under concurrent scheduling", async () => {
  const { scheduleEmail } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Cap");
  const p = await mkPerson("cap");
  for (let i = 0; i < 48; i++) await schedule(b.id, p.id, (10 + i) * MIN);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => scheduleEmail({ bdId: b.id, personId: p.id, toAddress: "x@prospect.test", subject: "s", body: "b", sendAt: new Date(Date.now() + 90 * MIN) })),
  );
  assert.equal(results.filter((r) => r.ok).length, 2, "exactly the two free slots are granted");
  assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "schedule_cap_reached"));
  const other = await mkBd("CapOther");
  await schedule(other.id, p.id); // the cap is per BD
});

test("edit and cancel are owner-only and locked 2 minutes before the send time", async () => {
  const { editScheduled, cancelScheduled } = await import("@/lib/scheduledEmail/queries");
  const owner = await mkBd("Owner");
  const stranger = await mkBd("Stranger");
  const p = await mkPerson("lock");
  const id = await schedule(owner.id, p.id);
  const sendAt = new Date(Date.now() + 120 * MIN);

  assert.deepEqual(await editScheduled({ id, bdId: stranger.id, subject: "x", body: "y", sendAt }), { ok: false, reason: "not_found" });
  assert.deepEqual(await cancelScheduled({ id, bdId: stranger.id }), { ok: false, reason: "not_found" });
  assert.deepEqual(await editScheduled({ id, bdId: owner.id, subject: "Nuevo", body: "y", sendAt }), { ok: true });
  assert.equal((await getRow(id)).subject, "Nuevo");
  assert.deepEqual(await editScheduled({ id, bdId: owner.id, subject: "x", body: "y", sendAt: new Date(Date.now() + MIN) }), { ok: false, reason: "schedule_too_soon" });

  await setRow(id, `send_at = now() + interval '90 seconds'`); // inside the lock window
  assert.deepEqual(await editScheduled({ id, bdId: owner.id, subject: "tarde", body: "y", sendAt: (await getRow(id)).sendAt }), { ok: false, reason: "schedule_locked" });
  assert.deepEqual(await cancelScheduled({ id, bdId: owner.id }), { ok: false, reason: "schedule_locked" });
  assert.equal((await getRow(id)).status, "scheduled");

  await setRow(id, `send_at = now() + interval '10 minutes'`);
  assert.deepEqual(await cancelScheduled({ id, bdId: owner.id }), { ok: true });
  assert.equal((await getRow(id)).status, "cancelled");
  assert.deepEqual(await cancelScheduled({ id, bdId: owner.id }), { ok: false, reason: "schedule_locked" }, "a cancelled row stays cancelled");
  assert.equal(await activityCount(p.id), 0);
});

test("claiming is atomic: two concurrent runs send each due row exactly once", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const b = await mkBd("Claim");
  const p = await mkPerson("claim");
  const ids = [await schedule(b.id, p.id, 10 * MIN), await schedule(b.id, p.id, 11 * MIN), await schedule(b.id, p.id, 12 * MIN)];
  for (const id of ids) await setRow(id, `send_at = now() - interval '1 minute'`);
  const sentIds: string[] = [];
  const deps = await realDeps(async (row) => {
    sentIds.push(row.id);
    await new Promise((r) => setTimeout(r, 20));
    return { messageId: `gm-${row.id}` };
  });
  await Promise.all([dispatchScheduledEmails(deps, { dryRun: false }), dispatchScheduledEmails(deps, { dryRun: false }), dispatchScheduledEmails(deps, { dryRun: false })]);
  assert.deepEqual([...sentIds].sort(), [...ids].sort());
  for (const id of ids) {
    const row = await getRow(id);
    assert.equal(row.status, "sent");
    assert.equal(row.gmailMessageId, `gm-${id}`);
    assert.ok(row.sentAt);
  }
});

test("a dry run reports what is due and writes nothing", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const b = await mkBd("Dry");
  const p = await mkPerson("dry");
  const id = await schedule(b.id, p.id);
  await setRow(id, `send_at = now() - interval '1 minute'`);
  let called = 0;
  const summary = await dispatchScheduledEmails(await realDeps(async () => (called++, { messageId: "no" })), { dryRun: true });
  assert.ok(summary.due >= 1);
  assert.equal(called, 0);
  assert.equal((await getRow(id)).status, "scheduled");
});

test("a reply since scheduling puts the row on hold and it never sends by itself", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const b = await mkBd("Reply");
  const other = await mkBd("ReplyOther");
  const p = await mkPerson("reply");
  const q = await mkPerson("replyq");
  const inbound = async (bdId: string, personId: string, over: Record<string, unknown> = {}) => {
    const [m] = await db.insert(emailMessage).values({
      bdId, gmailMessageId: `g-${randomUUID()}`, gmailThreadId: "t", direction: "inbound", personId, fromAddress: "x@prospect.test",
      sentAt: new Date(Date.now() + MIN), matchedEmail: "x@prospect.test", matchConfidence: "exact", ...over,
    }).returning();
    await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId, matchedEmail: "x@prospect.test", matchConfidence: "exact" });
  };
  const held = await schedule(b.id, p.id);
  const noReply = await schedule(b.id, q.id);
  const autoOnly = await schedule(b.id, await mkPerson("replyauto").then((x) => x.id));
  const autoPersonId = (await getRow(autoOnly)).personId;
  const oldReply = await schedule(other.id, p.id); // another BD's mailbox heard nothing
  await inbound(b.id, p.id);
  await inbound(b.id, autoPersonId, { isAutomatic: true });
  await inbound(b.id, q.id, { sentAt: new Date(Date.now() - 60 * MIN) }); // before the baseline (the row's creation)
  for (const id of [held, noReply, autoOnly, oldReply]) await setRow(id, `send_at = now() - interval '1 minute'`);

  const sentIds: string[] = [];
  const deps = await realDeps(async (row) => (sentIds.push(row.id), { messageId: "m" }));
  await dispatchScheduledEmails(deps, { dryRun: false });
  await dispatchScheduledEmails(deps, { dryRun: false });
  assert.equal((await getRow(held)).status, "on_hold");
  assert.ok(!sentIds.includes(held), "a held email is never sent by the dispatcher");
  for (const id of [noReply, autoOnly, oldReply]) assert.equal((await getRow(id)).status, "sent", id);
  assert.equal(await activityCount(p.id), 0, "holding is not a touch");
});

test("a failed send keeps its text, is never resent, and an unconfirmed crash is swept to failed, not retried", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const { GmailSendError } = await import("@/lib/gmail/errors");
  const b = await mkBd("Fail");
  const p = await mkPerson("fail");
  const dead = await schedule(b.id, p.id, 10 * MIN, "Asunto guardado");
  const crashed = await schedule(b.id, p.id, 11 * MIN);
  await setRow(dead, `send_at = now() - interval '1 minute'`);
  await setRow(crashed, `status = 'sending', send_at = now() - interval '30 minutes', updated_at = now() - interval '20 minutes'`);

  let calls = 0;
  const deps = await realDeps(async () => {
    calls++;
    throw new GmailSendError("reauth_required", "Gmail authorization expired. token=SECRET-REFRESH");
  });
  const summary = await dispatchScheduledEmails(deps, { dryRun: false });
  assert.equal(summary.swept, 1);
  await dispatchScheduledEmails(deps, { dryRun: false });
  await dispatchScheduledEmails(deps, { dryRun: false });
  assert.equal(calls, 1, "one attempt, never a retry on later runs or after a reconnect");
  const row = await getRow(dead);
  assert.equal(row.status, "failed");
  assert.equal(row.error, "gmail_not_connected");
  assert.equal(row.subject, "Asunto guardado");
  assert.doesNotMatch(String(row.error), /SECRET/);
  const swept = await getRow(crashed);
  assert.equal(swept.status, "failed");
  assert.equal(swept.error, "outcome_unknown");
  assert.equal(await activityCount(p.id), 0);
});

test("an edited held or failed row goes back to scheduled with a fresh reply baseline", async () => {
  const { editScheduled } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Reedit");
  const p = await mkPerson("reedit");
  const id = await schedule(b.id, p.id);
  await setRow(id, `status = 'failed', error = 'gmail_not_connected', send_at = now() - interval '1 hour', reply_baseline_at = now() - interval '2 hours'`);
  assert.deepEqual(await editScheduled({ id, bdId: b.id, subject: "s", body: "b", sendAt: (await getRow(id)).sendAt }), { ok: false, reason: "schedule_too_soon" }, "a past time is never accepted back");
  assert.deepEqual(await editScheduled({ id, bdId: b.id, subject: "s", body: "b", sendAt: new Date(Date.now() + 30 * MIN) }), { ok: true });
  const row = await getRow(id);
  assert.equal(row.status, "scheduled");
  assert.equal(row.error, null);
  assert.ok(Date.now() - row.replyBaselineAt.getTime() < 60_000);
});
