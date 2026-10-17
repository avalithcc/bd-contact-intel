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
  const { listSuppressionRules } = await import("@/lib/sequences/suppressionQueries");
  return { holdReplied: q.holdReplied, claimDue: q.claimDue, countDue: q.countDue, sweepStale: q.sweepStale, markSent: q.markSent, markFailed: q.markFailed, markCancelled: q.markCancelled, releaseClaimed: q.releaseClaimed, loadSuppression: listSuppressionRules, send };
}
async function tasksFor(personId: string) {
  const { db } = await import("@/db");
  const { task, activity } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const tasks = await db.select().from(task).where(eq(task.personId, personId));
  const acts = (await db.select().from(activity).where(eq(activity.personId, personId))).filter((a) => a.type === "task_created");
  return { tasks, acts };
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
  // No email_sent/touch activity; only the two follow-up tasks' task_created rows (one per failed row).
  const { tasks, acts } = await tasksFor(p.id);
  assert.equal(tasks.length, 2);
  assert.equal(acts.length, 2);
  assert.equal(await activityCount(p.id), 2);
});

test("a failed or swept row opens exactly one task for the owning BD with an activity, and reruns never duplicate it", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const { GmailSendError } = await import("@/lib/gmail/errors");
  const b = await mkBd("TaskOwner");
  const p = await mkPerson("taskp");
  const dead = await schedule(b.id, p.id, 10 * MIN);
  const crashed = await schedule(b.id, p.id, 11 * MIN);
  await setRow(dead, `send_at = now() - interval '1 minute'`);
  await setRow(crashed, `status = 'sending', send_at = now() - interval '30 minutes', updated_at = now() - interval '20 minutes'`);
  const deps = await realDeps(async () => { throw new GmailSendError("reauth_required", "x"); });
  for (let i = 0; i < 3; i++) await dispatchScheduledEmails(deps, { dryRun: false });
  const { tasks, acts } = await tasksFor(p.id);
  assert.equal(tasks.length, 2, "one per failed row, not per run");
  assert.ok(tasks.every((t) => t.assignedToBdId === b.id && t.actorBdId === b.id && t.status === "open"));
  assert.ok(tasks.every((t) => t.title.startsWith("Revisar envío programado fallido a taskp")));
  assert.equal(acts.length, 2);
  assert.ok(acts.every((a) => a.actorBdId === b.id));
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  assert.equal((await db.select().from(auditLog).where(eq(auditLog.actorBdId, b.id))).length, 0, "no audit_log row");
});

test("a failed row of a merged contact puts its task on the live survivor", async () => {
  const { markFailed } = await import("@/lib/scheduledEmail/queries");
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const b = await mkBd("MergeTask");
  const old = await mkPerson("mold");
  const live = await mkPerson("mlive");
  const id = await schedule(b.id, old.id);
  await db.update(person).set({ mergedIntoId: live.id }).where(eq(person.id, old.id));
  await setRow(id, `status = 'sending'`);
  await markFailed(id, "outcome_unknown");
  assert.equal((await tasksFor(live.id)).tasks.length, 1);
  assert.equal((await tasksFor(old.id)).tasks.length, 0);
});

test("a suppressed recipient is cancelled at dispatch time and Gmail is never called (address and domain rules)", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const { insertSuppression } = await import("@/lib/sequences/suppressionQueries");
  const { db } = await import("@/db");
  const { emailSuppression } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const b = await mkBd("Supp");
  const p = await mkPerson("supp");
  const byAddress = await schedule(b.id, p.id, 10 * MIN);
  const byDomain = await schedule(b.id, p.id, 11 * MIN);
  await setRow(byAddress, `send_at = now() - interval '1 minute', to_address = 'Opted-${run}@prospect.test'`);
  await setRow(byDomain, `send_at = now() - interval '1 minute', to_address = 'x@dom-${run}.test'`);
  await insertSuppression({ kind: "address", rawValue: `opted-${run}@prospect.test`, source: "manual" });
  await insertSuppression({ kind: "domain", rawValue: `dom-${run}.test`, source: "manual" });
  let calls = 0;
  const summary = await dispatchScheduledEmails(await realDeps(async () => (calls++, { messageId: "m" })), { dryRun: false });
  assert.equal(calls, 0);
  assert.equal(summary.cancelled, 2);
  for (const id of [byAddress, byDomain]) {
    const row = await getRow(id);
    assert.equal(row.status, "cancelled");
    assert.equal(row.error, "recipient_suppressed");
  }
  assert.equal((await tasksFor(p.id)).tasks.length, 0, "a suppression is not a failure: no task");
  await db.delete(emailSuppression).where(eq(emailSuppression.value, `opted-${run}@prospect.test`));
  await db.delete(emailSuppression).where(eq(emailSuppression.value, `dom-${run}.test`));
});

test("recording an opt-out cancels the pending scheduled rows to that address, and leaves sent and other rows alone", async () => {
  const { cancelPendingForAddress } = await import("@/lib/scheduledEmail/queries");
  const { db } = await import("@/db");
  const b = await mkBd("Hook");
  const p = await mkPerson("hook");
  const addr = `hook-${run}@prospect.test`;
  const pending = await schedule(b.id, p.id, 10 * MIN);
  const held = await schedule(b.id, p.id, 11 * MIN);
  const sent = await schedule(b.id, p.id, 12 * MIN);
  const other = await schedule(b.id, p.id, 13 * MIN);
  await setRow(pending, `to_address = ' ${addr.toUpperCase()} '`);
  await setRow(held, `status = 'on_hold', to_address = '${addr}'`);
  await setRow(sent, `status = 'sent', to_address = '${addr}'`);
  const n = await db.transaction((tx) => cancelPendingForAddress(tx, addr));
  assert.equal(n, 2);
  assert.deepEqual([(await getRow(pending)).status, (await getRow(held)).status, (await getRow(sent)).status, (await getRow(other)).status], ["cancelled", "cancelled", "sent", "scheduled"]);
  assert.equal((await getRow(pending)).error, "recipient_suppressed");
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

async function inboundTo(bdId: string, personId: string) {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const [m] = await db.insert(emailMessage).values({
    bdId, gmailMessageId: `g-${randomUUID()}`, gmailThreadId: "t", direction: "inbound", personId, fromAddress: "x@prospect.test",
    sentAt: new Date(Date.now() + MIN), matchedEmail: "x@prospect.test", matchConfidence: "exact",
  }).returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId, matchedEmail: "x@prospect.test", matchConfidence: "exact" });
}

test("a merge does not blind the reply check: scheduled to A, A merged into B, B replies -> on hold", async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { holdReplied } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Merge");
  const a = await mkPerson("mergea");
  const survivor = await mkPerson("mergeb");
  const grand = await mkPerson("mergec");
  const id = await schedule(b.id, a.id);
  await setRow(id, `send_at = now() - interval '1 minute'`);
  await db.update(person).set({ mergedIntoId: survivor.id }).where(eq(person.id, a.id)); // soft merge A -> B
  await db.update(person).set({ mergedIntoId: grand.id }).where(eq(person.id, survivor.id)); // and B -> C (two hops)
  await inboundTo(b.id, grand.id); // the repointed link lives on the final survivor
  assert.ok((await holdReplied()) >= 1);
  assert.equal((await getRow(id)).status, "on_hold");
});

test("the recipient must be header-safe and one of the Contact's own addresses (the survivor's after a merge)", async () => {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { checkRecipient } = await import("@/lib/scheduledEmail/recipient");
  const a = await mkPerson("rcpta");
  const s = await mkPerson("rcptb");
  assert.equal(await checkRecipient(a.id, a.email!), "ok");
  assert.equal(await checkRecipient(a.id, ` ${a.email!.toUpperCase()} `), "ok");
  assert.equal(await checkRecipient(a.id, "someone.else@prospect.test"), "schedule_recipient_invalid");
  assert.equal(await checkRecipient(a.id, `${a.email}\r\nBcc: evil@x.test`), "invalid_email");
  await db.update(person).set({ mergedIntoId: s.id }).where(eq(person.id, a.id));
  assert.equal(await checkRecipient(a.id, s.email!), "ok");
  assert.equal(await checkRecipient(a.id, a.email!), "schedule_recipient_invalid");
});

test("markSent heals a row the sweep already called outcome_unknown, but never a plain failed or cancelled one", async () => {
  const { markSent } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Heal");
  const p = await mkPerson("heal");
  const swept = await schedule(b.id, p.id);
  const failed = await schedule(b.id, p.id);
  await setRow(swept, `status = 'failed', error = 'outcome_unknown'`);
  await setRow(failed, `status = 'failed', error = 'gmail_not_connected'`);
  await markSent(swept, "gm-late");
  await markSent(failed, "gm-nope");
  const row = await getRow(swept);
  assert.deepEqual([row.status, row.error, row.gmailMessageId], ["sent", null, "gm-late"]);
  assert.equal((await getRow(failed)).status, "failed");
});

test("the 50 cap also holds when failed rows are rescheduled, even concurrently", async () => {
  const { editScheduled } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Recap");
  const p = await mkPerson("recap");
  for (let i = 0; i < 49; i++) await schedule(b.id, p.id, (10 + i) * MIN);
  const f1 = await schedule(b.id, p.id, 200 * MIN); // 50 pending
  await setRow(f1, `status = 'failed', error = 'x'`); // 49 pending
  const f2 = await schedule(b.id, p.id, 201 * MIN); // 50 pending
  await setRow(f2, `status = 'failed', error = 'x'`); // 49 pending, two failed rows, one free slot
  const edit = (id: string) => editScheduled({ id, bdId: b.id, subject: "s", body: "b", sendAt: new Date(Date.now() + 30 * MIN) });
  const results = await Promise.all([edit(f1), edit(f2)]);
  assert.equal(results.filter((r) => r.ok).length, 1, "one free slot: exactly one failed row may return to scheduled");
  assert.ok(results.some((r) => !r.ok && r.reason === "schedule_cap_reached"));
});

test("the REAL sender: exactly one email_sent activity when it goes out, none when held or failed", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const { sendScheduledEmail } = await import("@/lib/scheduledEmail/send");
  const { encryptToken } = await import("@/lib/gmail/crypto");
  const { db } = await import("@/db");
  const { emailAccount, activity } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");
  Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "sec", GOOGLE_OAUTH_REDIRECT_URI: "http://localhost/cb", GMAIL_TOKEN_ENCRYPTION_KEY: "test-key" });
  const good = await mkBd("RealOk");
  const noAccount = await mkBd("RealFail");
  await db.insert(emailAccount).values({ bdId: good.id, emailAddress: good.email, refreshTokenEncrypted: encryptToken("rt"), status: "connected" });
  const sentP = await mkPerson("realsent");
  const heldP = await mkPerson("realheld");
  const failP = await mkPerson("realfail");
  const sentId = await schedule(good.id, sentP.id);
  const heldId = await schedule(good.id, heldP.id);
  const failId = await schedule(noAccount.id, failP.id);
  for (const id of [sentId, heldId, failId]) await setRow(id, `send_at = now() - interval '1 minute'`);
  await inboundTo(good.id, heldP.id);

  const cache = require("next/cache") as { revalidatePath: (p: string) => void };
  const realRevalidate = cache.revalidatePath;
  cache.revalidatePath = () => {}; // outside a request there is no Next store to revalidate
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
    if (url.endsWith("/messages/send")) return Response.json({ id: "gm-real", threadId: "th-real" });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const q = await import("@/lib/scheduledEmail/queries");
    const { listSuppressionRules } = await import("@/lib/sequences/suppressionQueries");
    await dispatchScheduledEmails({ ...q, loadSuppression: listSuppressionRules, send: sendScheduledEmail }, { dryRun: false });
  } finally {
    globalThis.fetch = realFetch;
    cache.revalidatePath = realRevalidate;
  }
  assert.equal(urls.filter((u) => u.endsWith("/messages/send")).length, 1, "Gmail was called once, for the one row that could go");
  const emailSent = (personId: string) => db.select({ id: activity.id }).from(activity).where(and(eq(activity.personId, personId), eq(activity.type, "email_sent")));
  assert.equal((await emailSent(sentP.id)).length, 1);
  assert.equal((await emailSent(heldP.id)).length, 0);
  assert.equal((await emailSent(failP.id)).length, 0);
  assert.deepEqual([(await getRow(sentId)).status, (await getRow(heldId)).status, (await getRow(failId)).status], ["sent", "on_hold", "failed"]);
});

test("the listings show only the caller's open rows, with the reply that paused a held row", async () => {
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const { holdReplied, listOwnScheduled, listScheduledForPerson, cancelScheduled } = await import("@/lib/scheduledEmail/queries");
  const mine = await mkBd("List");
  const other = await mkBd("ListOther");
  const p = await mkPerson("listed");
  const heldId = await schedule(mine.id, p.id, 60 * MIN, "En pausa");
  const plainId = await schedule(mine.id, p.id, 120 * MIN, "Normal");
  const cancelledId = await schedule(mine.id, p.id, 180 * MIN, "Cancelado");
  await schedule(other.id, p.id, 60 * MIN, "De otro BD");
  assert.equal((await cancelScheduled({ id: cancelledId, bdId: mine.id })).ok, true);
  const [m] = await db.insert(emailMessage).values({
    bdId: mine.id, gmailMessageId: `g-${randomUUID()}`, gmailThreadId: "t", direction: "inbound", personId: p.id, fromAddress: "x@prospect.test",
    bodyText: "Gracias, lo vemos.\n\nEl lun escribió:\n> hola", sentAt: new Date(Date.now() + MIN), matchedEmail: "x@prospect.test", matchConfidence: "exact",
  }).returning();
  await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId: p.id, matchedEmail: "x@prospect.test", matchConfidence: "exact" });
  await setRow(heldId, `send_at = now() - interval '1 minute'`);
  await holdReplied();

  const own = await listOwnScheduled(mine.id);
  assert.deepEqual(own.map((r) => r.subject).sort(), ["En pausa", "Normal"], "cancelled and other BDs' rows are not listed");
  const held = own.find((r) => r.id === heldId)!;
  assert.equal(held.status, "on_hold");
  assert.equal(held.replyText, "Gracias, lo vemos.");
  assert.ok(held.replyAt instanceof Date && held.sendAt instanceof Date && held.createdAt instanceof Date);
  assert.equal(own.find((r) => r.id === plainId)!.replyText, null);

  const forPerson = await listScheduledForPerson(p.id, mine.id);
  assert.deepEqual(forPerson.map((r) => r.status).sort(), ["cancelled", "on_hold", "scheduled"]);
  assert.ok(forPerson.find((r) => r.status === "cancelled")!.cancelledAt instanceof Date);
});

test("send now makes the row due immediately, restarts its reply baseline, and respects ownership, the lock and the cap", async () => {
  const { sendScheduledNow } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("Now");
  const other = await mkBd("NowOther");
  const p = await mkPerson("now");
  const id = await schedule(b.id, p.id, 60 * MIN);
  assert.deepEqual(await sendScheduledNow({ id, bdId: other.id }), { ok: false, reason: "not_found" }, "someone else's row looks like none");
  assert.deepEqual(await sendScheduledNow({ id, bdId: b.id }), { ok: true });
  const row = await getRow(id);
  assert.equal(row.status, "scheduled");
  assert.ok(row.sendAt.getTime() <= Date.now() + 1000, "due now");

  const held = await schedule(b.id, p.id, 60 * MIN);
  await setRow(held, `status = 'on_hold', send_at = now() - interval '1 hour'`);
  assert.deepEqual(await sendScheduledNow({ id: held, bdId: b.id }), { ok: true });
  assert.equal((await getRow(held)).status, "scheduled");

  const failed = await schedule(b.id, p.id, 60 * MIN);
  await setRow(failed, `status = 'failed', error = 'gmail_not_connected'`);
  assert.deepEqual(await sendScheduledNow({ id: failed, bdId: b.id }), { ok: true });
  const back = await getRow(failed);
  assert.deepEqual([back.status, back.error], ["scheduled", null]);

  const locked = await schedule(b.id, p.id, 60 * MIN);
  await setRow(locked, `send_at = now() + interval '1 minute'`);
  assert.deepEqual(await sendScheduledNow({ id: locked, bdId: b.id }), { ok: false, reason: "schedule_locked" });
});

test("send now keeps a scheduled row's reply baseline (holdReplied still guards it) but restarts a held row's", async () => {
  const { sendScheduledNow, holdReplied } = await import("@/lib/scheduledEmail/queries");
  const { db } = await import("@/db");
  const { emailMessage, emailMessagePerson } = await import("@/db/schema");
  const b = await mkBd("Base");
  const p = await mkPerson("base");
  const reply = async () => {
    const [m] = await db.insert(emailMessage).values({
      bdId: b.id, gmailMessageId: `g-${randomUUID()}`, gmailThreadId: "t", direction: "inbound", personId: p.id, fromAddress: "x@prospect.test",
      sentAt: new Date(Date.now() + 150), matchedEmail: "x@prospect.test", matchConfidence: "exact",
    }).returning();
    await db.insert(emailMessagePerson).values({ emailMessageId: m!.id, personId: p.id, matchedEmail: "x@prospect.test", matchConfidence: "exact" });
    await new Promise((resolve) => setTimeout(resolve, 400)); // the release below lands after the reply
  };
  const plain = await schedule(b.id, p.id, 60 * MIN);
  const before = (await getRow(plain)).replyBaselineAt.getTime();
  assert.deepEqual(await sendScheduledNow({ id: plain, bdId: b.id }), { ok: true });
  assert.equal((await getRow(plain)).replyBaselineAt.getTime(), before, "a scheduled row keeps its baseline");
  await reply();
  await holdReplied();
  assert.equal((await getRow(plain)).status, "on_hold", "the reply that arrived after the click still pauses it");

  assert.deepEqual(await sendScheduledNow({ id: plain, bdId: b.id }), { ok: true }); // "Enviar igual" on the held row
  const released = await getRow(plain);
  assert.ok(released.replyBaselineAt.getTime() > before, "a held row's baseline restarts");
  await holdReplied();
  assert.equal((await getRow(plain)).status, "scheduled", "the reply that paused it cannot pause it again");
});

test("send now and edit of a failed row both stop at the 50 cap", async () => {
  const { sendScheduledNow, editScheduled } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("CapFailed");
  const p = await mkPerson("capfailed");
  for (let i = 0; i < 50; i++) await schedule(b.id, p.id, (10 + i) * MIN); // 50 pending
  const { db } = await import("@/db");
  const { scheduledEmail } = await import("@/db/schema");
  const [f] = await db.insert(scheduledEmail).values({ bdId: b.id, personId: p.id, toAddress: "x@prospect.test", subject: "f", body: "b", sendAt: new Date(Date.now() - MIN), status: "failed", error: "gmail_not_connected" }).returning();
  assert.deepEqual(await sendScheduledNow({ id: f!.id, bdId: b.id }), { ok: false, reason: "schedule_cap_reached" });
  assert.deepEqual(await editScheduled({ id: f!.id, bdId: b.id, subject: "s", body: "b", sendAt: new Date(Date.now() + 30 * MIN) }), { ok: false, reason: "schedule_cap_reached" });
  assert.equal((await getRow(f!.id)).status, "failed", "refused rows stay failed");
});

test("send now re-validates like an edit: a changed contact address, someone else's row and a dead mailbox are refused", async () => {
  const { sendScheduledNowChecked } = await import("@/lib/scheduledEmail/sendNow");
  const { db } = await import("@/db");
  const { emailAccount, person } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const b = await mkBd("Guard");
  const other = await mkBd("GuardOther");
  const p = await mkPerson("guard");
  await db.insert(emailAccount).values({ bdId: b.id, emailAddress: `guard-${run}@sender.test`, status: "connected" });
  const id = await schedule(b.id, p.id, 60 * MIN);
  await setRow(id, `to_address = '${p.email}'`);
  assert.deepEqual(await sendScheduledNowChecked({ id, bdId: other.id }), { ok: false, reason: "not_found" });

  await db.update(person).set({ email: `changed-${run}@prospect.test`, emailNormalized: `changed-${run}@prospect.test` }).where(eq(person.id, p.id));
  assert.deepEqual(await sendScheduledNowChecked({ id, bdId: b.id }), { ok: false, reason: "schedule_recipient_invalid" });
  assert.equal((await getRow(id)).status, "scheduled");
  assert.ok((await getRow(id)).sendAt.getTime() > Date.now() + 30 * MIN, "refused: the time did not move");

  await db.update(person).set({ email: p.email, emailNormalized: p.email }).where(eq(person.id, p.id));
  await db.update(emailAccount).set({ status: "revoked" }).where(eq(emailAccount.bdId, b.id));
  assert.deepEqual(await sendScheduledNowChecked({ id, bdId: b.id }), { ok: false, reason: "gmail_not_connected" });
  await db.update(emailAccount).set({ status: "connected" }).where(eq(emailAccount.bdId, b.id));
  assert.deepEqual(await sendScheduledNowChecked({ id, bdId: b.id }), { ok: true });
});

test("a task insert that fails still leaves the row failed, and the dispatcher stays healthy (savepoint)", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const { GmailSendError } = await import("@/lib/gmail/errors");
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const b = await mkBd("Poison");
  const p = await mkPerson("poison");
  const swept = await schedule(b.id, p.id, 10 * MIN);
  const dead = await schedule(b.id, p.id, 11 * MIN);
  const ok = await schedule(b.id, p.id, 12 * MIN);
  await setRow(swept, `status = 'sending', send_at = now() - interval '30 minutes', updated_at = now() - interval '20 minutes'`);
  await setRow(dead, `send_at = now() - interval '1 minute'`);
  await setRow(ok, `send_at = now() - interval '1 minute'`);
  await db.execute(sql.raw(`create or replace function pg_temp_poison_${run}() returns trigger language plpgsql as $$ begin raise exception 'poisoned'; end $$`));
  await db.execute(sql.raw(`create trigger poison_${run} before insert on task for each row execute function pg_temp_poison_${run}()`));
  try {
    const summary = await dispatchScheduledEmails(await realDeps(async (r) => { if (r.id === dead) throw new GmailSendError("reauth_required", "x"); return { messageId: "m" }; }), { dryRun: false });
    assert.equal(summary.swept, 1);
    assert.equal((await getRow(swept)).status, "failed");
    assert.equal((await getRow(dead)).status, "failed");
    assert.equal((await getRow(ok)).status, "sent", "the rest of the batch still goes out");
    assert.equal((await tasksFor(p.id)).tasks.length, 0);
  } finally {
    await db.execute(sql.raw(`drop trigger poison_${run} on task`));
    await db.execute(sql.raw(`drop function pg_temp_poison_${run}()`));
  }
});

test("a suppression read failure puts the claimed rows back to scheduled: no failure, no task, retried next run", async () => {
  const { dispatchScheduledEmails } = await import("@/lib/scheduledEmail/dispatch");
  const b = await mkBd("Blip");
  const p = await mkPerson("blip");
  const id = await schedule(b.id, p.id, 10 * MIN);
  await setRow(id, `send_at = now() - interval '1 minute'`);
  let sends = 0;
  const deps = { ...(await realDeps(async () => (sends++, { messageId: "m" }))), loadSuppression: async () => { throw new Error("blip"); } };
  await dispatchScheduledEmails(deps, { dryRun: false });
  assert.equal(sends, 0);
  assert.equal((await getRow(id)).status, "scheduled");
  assert.equal((await tasksFor(p.id)).tasks.length, 0);
  await dispatchScheduledEmails(await realDeps(async () => (sends++, { messageId: "m2" })), { dryRun: false });
  assert.equal((await getRow(id)).status, "sent");
  assert.equal(sends, 1);
});

test("markSent healing an outcome_unknown row closes its failure task with a task_completed activity", async () => {
  const { markFailed, markSent } = await import("@/lib/scheduledEmail/queries");
  const b = await mkBd("HealTask");
  const p = await mkPerson("healtask");
  const id = await schedule(b.id, p.id);
  const other = await schedule(b.id, p.id, 70 * MIN);
  await setRow(id, `status = 'sending'`);
  await setRow(other, `status = 'sending'`);
  await markFailed(id, "outcome_unknown");
  await markFailed(other, "outcome_unknown");
  await markSent(id, "gm-1");
  const { tasks, acts } = await tasksFor(p.id);
  assert.equal(tasks.filter((t) => t.status === "done").length, 1, "only the healed row's task");
  assert.equal(tasks.filter((t) => t.status === "open").length, 1);
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  assert.equal((await db.select().from(activity).where(eq(activity.personId, p.id))).filter((a) => a.type === "task_completed").length, 1);
  assert.equal(acts.length, 2);
});

test("a real opt-out (recordOptOutForMember -> suppressAddressInTx) cancels the pending scheduled rows to that address", async () => {
  const { recordOptOutForMember } = await import("@/lib/sequences/optOutQueries");
  const { db } = await import("@/db");
  const { sequence, sequenceMember, emailSuppression } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const b = await mkBd("OptOut");
  const p = await mkPerson("optout");
  const { emailAccount } = await import("@/db/schema");
  const [acc] = await db.insert(emailAccount).values({ bdId: b.id, emailAddress: `zz-sch-oo-@example.test` }).returning();
  const [seq] = await db.insert(sequence).values({ name: `seq `, ownerBdId: b.id, emailAccountId: acc!.id, schedule: {} }).returning();
  const [member] = await db.insert(sequenceMember).values({ sequenceId: seq!.id, personId: p.id, state: "drafted" }).returning();
  const addr = `optout-${run}@prospect.test`;
  const pending = await schedule(b.id, p.id, 10 * MIN);
  const held = await schedule(b.id, p.id, 11 * MIN);
  await setRow(pending, `to_address = '${addr}'`);
  await setRow(held, `status = 'on_hold', to_address = '${addr.toUpperCase()}'`);
  try {
    const r = await recordOptOutForMember(b.id, member!.id);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([(await getRow(pending)).status, (await getRow(held)).status], ["cancelled", "cancelled"]);
    assert.equal((await getRow(pending)).error, "recipient_suppressed");
  } finally {
    await db.delete(emailSuppression).where(eq(emailSuppression.value, addr));
    await db.delete(sequence).where(eq(sequence.id, seq!.id));
  }
});
