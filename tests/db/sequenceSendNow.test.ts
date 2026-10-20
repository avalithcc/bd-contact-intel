/**
 * DB-backed tests for "Enviar ahora" / "Programar" in Sequences (send-now-or-schedule), against the local scratch
 * database only. Owner rules: an explicit choice is respected (a chosen time before 9:00 Miami goes out at that time);
 * the 9:00 Miami floor stays on the cadence option; the daily cap and the claim apply to every send; a second "send now"
 * for the same member sends nothing. Gmail is a counting fake: nothing here can send an email.
 * `DATABASE_URL=postgres://localhost:5432/bd_contact_intel_e2e npx tsx --test --test-concurrency=1 tests/db/sequenceSendNow.test.ts`
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const accountIds: string[] = [];
const personIds: string[] = [];

async function footedBody() {
  const { appendFooter } = await import("@/lib/sequences/complianceFooter");
  const { COMPLIANCE_CONFIG } = await import("@/lib/sequences/config");
  const { buildUnsubscribeUrl, generateUnsubscribeToken } = await import("@/lib/sequences/unsubscribeToken");
  const r = appendFooter("Hello there", COMPLIANCE_CONFIG, "miami", buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken()));
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
}

async function mkAccount(label: string, cap = 5) {
  const { db } = await import("@/db");
  const { bd, emailAccount, sequence } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `ZZ Now ${label}`, email: `zz-now-${label}-${run}@example.test` }).returning();
  bdIds.push(b.id);
  const [acc] = await db.insert(emailAccount).values({ bdId: b.id, emailAddress: `zz-now-sender-${label}-${run}@example.test`, lastSyncedAt: new Date() }).returning();
  accountIds.push(acc.id);
  const [s] = await db.insert(sequence).values({ name: `zz-now-${run}-${label}`, ownerBdId: b.id, emailAccountId: acc.id, dailySendCap: cap, schedule: {} }).returning();
  return { bdId: b.id, accountId: acc.id, sequenceId: s.id };
}
type Acct = Awaited<ReturnType<typeof mkAccount>>;

/** A reviewed, unapproved step-1 draft: the state the BD approves from. */
async function mkDrafted(a: Acct, name: string) {
  const { db } = await import("@/db");
  const { person, sequenceDraft, sequenceMember } = await import("@/db/schema");
  const email = `zz-now-${name}-${run}@example.test`;
  const [p] = await db.insert(person).values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: "United States" }).returning();
  personIds.push(p.id);
  const [m] = await db.insert(sequenceMember).values({ sequenceId: a.sequenceId, personId: p.id, state: "drafted" }).returning();
  await db.insert(sequenceDraft).values({ sequenceMemberId: m.id, step: 1, subject: `Hi ${name}`, body: await footedBody(), reviewedAt: new Date() });
  return m.id;
}

async function memberState(id: string) {
  const { db } = await import("@/db");
  const { sequenceMember } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceMember).where(eq(sequenceMember.id, id)))[0]!.state;
}
async function scheduledFor(id: string) {
  const { db } = await import("@/db");
  const { sequenceDraft } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return (await db.select().from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, id), eq(sequenceDraft.step, 1))))[0]!.scheduledFor;
}

/** The real release path with a counting fake instead of Gmail. */
async function fakeSend() {
  const sends: string[] = [];
  const send = async (_c: unknown, m: { to: string }) => {
    sends.push(m.to);
    await new Promise((r) => setTimeout(r, 25));
    return { messageId: `g-${run}-${sends.length}`, threadId: `t-${run}-${sends.length}` };
  };
  return { sends, send };
}

before(async () => {
  await import("@/db");
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(sequence).where(inArray(sequence.ownerBdId, bdIds));
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (accountIds.length) await db.delete(emailAccount).where(inArray(emailAccount.id, accountIds));
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds));
});

test("an explicit time before 9:00 Miami is stored as chosen and the runner releases it at that time", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { liveRunnerPorts } = await import("@/lib/sequences/releaseQueries");
  const { slotOf } = await import("@/lib/sendSchedule/time");
  const a = await mkAccount("early");
  const id = await mkDrafted(a, "early");
  // 07:00 Miami (EDT/EST either way before 9:00), two days out, expressed as the Argentina wall clock the BD would pick.
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const target = new Date(`${day}T11:00:00Z`); // 07:00 EDT / 06:00 EST: always before 09:00 Miami
  const slot = slotOf(target);
  const r = await approveMember(a.bdId, id, 1, { kind: "at", ...slot });
  assert.deepEqual(r, { ok: true, approved: [id] });
  assert.equal((await scheduledFor(id))!.toISOString(), target.toISOString());

  const { sends, send } = await fakeSend();
  const ports = { ...liveRunnerPorts, now: () => new Date(target.getTime() + 60_000), send, draftReminder: async () => undefined };
  const onlyMine = { ...ports, load: async (n: Date) => ({ ...(await liveRunnerPorts.load(n)), candidates: (await liveRunnerPorts.load(n)).candidates.filter((c) => c.accountId === a.accountId) }) };
  const summary = await runSequenceRelease(onlyMine);
  assert.equal(summary.released, 1);
  assert.equal(sends.length, 1);
  assert.equal(await memberState(id), "sent");
});

test("the cadence option keeps the 9:00 Miami floor: nothing goes out before it, it goes out at it", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const { liveRunnerPorts } = await import("@/lib/sequences/releaseQueries");
  const { releaseFloorFor } = await import("@/lib/sequences/releasePlan");
  const a = await mkAccount("cadence");
  const id = await mkDrafted(a, "cadence");
  assert.deepEqual(await approveMember(a.bdId, id, 1, { kind: "cadence" }), { ok: true, approved: [id] });
  const due = (await scheduledFor(id))!;
  assert.equal(due.getTime(), releaseFloorFor(due).getTime(), "stored exactly at 9:00 Miami");

  const { sends, send } = await fakeSend();
  const mk = (now: Date) => ({
    ...liveRunnerPorts,
    now: () => now,
    send,
    draftReminder: async () => undefined,
    load: async (n: Date) => {
      const loaded = await liveRunnerPorts.load(n);
      return { ...loaded, candidates: loaded.candidates.filter((c) => c.accountId === a.accountId) };
    },
  });
  assert.equal((await runSequenceRelease(mk(new Date(due.getTime() - 60_000)))).released, 0);
  assert.equal(sends.length, 0);
  assert.equal((await runSequenceRelease(mk(due))).released, 1);
});

test("send now respects the daily cap: the extra member stays approved, nothing is dropped", async () => {
  const { approveBulk } = await import("@/lib/sequences/approvalQueries");
  const { releaseMembersNow } = await import("@/lib/sequences/releaseNow");
  const a = await mkAccount("cap", 2);
  const ids = [await mkDrafted(a, "cap1"), await mkDrafted(a, "cap2"), await mkDrafted(a, "cap3")];
  assert.equal((await approveBulk(a.bdId, ids, 1, { kind: "now" })).ok, true);
  const { sends, send } = await fakeSend();
  const summary = await releaseMembersNow(a.bdId, ids, { send, draftReminder: async () => undefined });
  assert.equal(summary.released, 2);
  assert.equal(summary.deferred, 1);
  assert.equal(sends.length, 2);
  const states = await Promise.all(ids.map(memberState));
  assert.deepEqual(states.filter((s) => s === "sent").length, 2);
  assert.deepEqual(states.filter((s) => s === "approved").length, 1);
  // The detail read reports what the cap has used, so the bulk bar can say how many leave now before the BD confirms.
  const { getSequenceDetail } = await import("@/lib/sequences/detailQueries");
  const detail = await getSequenceDetail({ id: a.bdId, role: "bd" }, a.sequenceId);
  assert.equal(detail?.sentToday, 2);
  assert.equal(detail?.dailySendCap, 2);
});

test("two simultaneous send-now calls for one member send exactly one email (the claim arbitrates)", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { releaseMembersNow } = await import("@/lib/sequences/releaseNow");
  const a = await mkAccount("double");
  const id = await mkDrafted(a, "double");
  await approveMember(a.bdId, id, 1, { kind: "now" });
  const { sends, send } = await fakeSend();
  const [r1, r2] = await Promise.all([
    releaseMembersNow(a.bdId, [id], { send, draftReminder: async () => undefined }),
    releaseMembersNow(a.bdId, [id], { send, draftReminder: async () => undefined }),
  ]);
  assert.equal(sends.length, 1);
  assert.equal(r1.released + r2.released, 1);
});

test("releaseMembersNow only touches the given members of the given owner", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { releaseMembersNow } = await import("@/lib/sequences/releaseNow");
  const a = await mkAccount("scope");
  const mine = await mkDrafted(a, "scopeA");
  const other = await mkDrafted(a, "scopeB");
  await approveMember(a.bdId, mine, 1, { kind: "now" });
  await approveMember(a.bdId, other, 1, { kind: "now" });
  const { sends, send } = await fakeSend();
  await releaseMembersNow(a.bdId, [mine], { send, draftReminder: async () => undefined });
  assert.equal(sends.length, 1);
  assert.equal(await memberState(other), "approved", "the other approved member waits for the cron");
  const stranger = await mkAccount("stranger");
  assert.equal((await releaseMembersNow(stranger.bdId, [other], { send, draftReminder: async () => undefined })).released, 0);
});

test("a chosen time under 5 minutes ahead is refused as too_soon and approves nothing", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { slotOf } = await import("@/lib/sendSchedule/time");
  const a = await mkAccount("soon");
  const id = await mkDrafted(a, "soon");
  const slot = slotOf(new Date(Date.now() + 2 * 60_000));
  const r = await approveMember(a.bdId, id, 1, { kind: "at", ...slot });
  assert.deepEqual(r, { ok: false, error: "rejected", rejected: [{ memberId: id, reason: "too_soon" }] });
  assert.equal(await memberState(id), "drafted");
});

test("Cambiar moves an approved member, is refused inside the 2-minute lock, and a stale claim cannot send the old time", async () => {
  const { approveMember, rescheduleApproved } = await import("@/lib/sequences/approvalQueries");
  const { claimStep, listReleaseCandidates } = await import("@/lib/sequences/releaseQueries");
  const { slotOf } = await import("@/lib/sendSchedule/time");
  const a = await mkAccount("move");
  const id = await mkDrafted(a, "move");
  const soon = new Date(Date.now() + 6 * 60_000);
  await approveMember(a.bdId, id, 1, { kind: "at", ...slotOf(soon) });

  const later = new Date(Date.now() + 3 * 86_400_000);
  const laterSlot = slotOf(later);
  const laterInstant = new Date(`${laterSlot.date}T${laterSlot.time}:00-03:00`);
  const moved = await rescheduleApproved(a.bdId, id, { kind: "at", ...laterSlot });
  assert.deepEqual(moved, { ok: true, scheduledFor: laterInstant });
  assert.equal((await scheduledFor(id))!.getTime(), laterInstant.getTime());

  // The runner read the member while it was due, then the BD moved it later: the claim must refuse the old read.
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const setMoment = (at: Date) => db.execute(sql`update sequence_draft set scheduled_for = ${at.toISOString()}::timestamptz where sequence_member_id = ${id}::uuid and step = 1`);
  await setMoment(new Date(Date.now() - 60_000));
  const candidate = (await listReleaseCandidates(new Date())).find((c) => c.id === id);
  assert.ok(candidate, "read as due");
  await setMoment(laterInstant);
  assert.equal(await claimStep(candidate), null);

  // Inside the lock (due in under 2 minutes): Cambiar is refused.
  await db.execute(sql`update sequence_draft set scheduled_for = ${new Date(Date.now() + 60_000).toISOString()}::timestamptz where sequence_member_id = ${id}::uuid and step = 1`);
  assert.deepEqual(await rescheduleApproved(a.bdId, id, { kind: "at", ...slotOf(later) }), { ok: false, error: "locked" });
});

/** Another Sequence on the SAME sending account, with its own cap. */
async function mkSequenceOn(a: Acct, label: string, cap: number) {
  const { db } = await import("@/db");
  const { sequence } = await import("@/db/schema");
  const [s] = await db.insert(sequence).values({ name: `zz-now-${run}-${label}`, ownerBdId: a.bdId, emailAccountId: a.accountId, dailySendCap: cap, schedule: {} }).returning();
  return { ...a, sequenceId: s.id };
}

/** `n` sends already recorded today from the account (the Miami day of the real clock, which is what releaseMembersNow runs on). */
async function seedSentToday(a: Acct, n: number) {
  const { db } = await import("@/db");
  const { person, sequenceMember, sequenceSendClaim } = await import("@/db/schema");
  const { miamiCalendarDate } = await import("@/lib/sequences/miamiTime");
  for (let i = 0; i < n; i++) {
    const email = `zz-now-hist${i}-${a.accountId.slice(0, 6)}-${run}@example.test`;
    const [p] = await db.insert(person).values({ firstName: `hist${i}`, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: "United States" }).returning();
    personIds.push(p.id);
    const [m] = await db.insert(sequenceMember).values({ sequenceId: a.sequenceId, personId: p.id, state: "sent", sentAt: new Date() }).returning();
    await db.insert(sequenceSendClaim).values({ sequenceMemberId: m.id, step: 1, sendingAccountId: a.accountId, outcome: "sent", sentAt: new Date(), miamiSendDate: miamiCalendarDate(new Date()) });
  }
}

test("daily cap at claim time: two CONCURRENT runs at 14 of 15 send exactly one more", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { scopedRunnerPorts } = await import("@/lib/sequences/releaseQueries");
  const { runSequenceRelease } = await import("@/lib/sequences/runSequenceRelease");
  const a = await mkAccount("race15", 15);
  await seedSentToday(a, 14);
  const m1 = await mkDrafted(a, "race15a");
  const m2 = await mkDrafted(a, "race15b");
  await approveMember(a.bdId, m1, 1, { kind: "now" });
  await approveMember(a.bdId, m2, 1, { kind: "now" });
  const { sends, send } = await fakeSend();
  // Barrier: neither run may plan-and-claim until BOTH have read 14 sent, so each plans one more and only the claim can stop the second.
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const runFor = (id: string) => {
    const base = scopedRunnerPorts({ memberIds: [id], ownerBdId: a.bdId });
    return runSequenceRelease({
      ...base,
      send,
      draftReminder: async () => undefined,
      load: async (now) => {
        const loaded = await base.load(now);
        if (++arrived >= 2) open();
        await gate;
        return loaded;
      },
    });
  };
  const [r1, r2] = await Promise.all([runFor(m1), runFor(m2)]);
  assert.equal(sends.length, 1, "15 is the cap: one more, not two");
  assert.equal(r1.released + r2.released, 1);
  const states = [await memberState(m1), await memberState(m2)].sort();
  assert.deepEqual(states, ["approved", "sent"], "the other member stays approved");
});

test("the effective cap is the lowest among ALL the account's Sequences with due members, not only the scoped ones", async () => {
  const { approveMember } = await import("@/lib/sequences/approvalQueries");
  const { releaseMembersNow } = await import("@/lib/sequences/releaseNow");
  const a = await mkAccount("lowcap", 15); // Sequence A, cap 15
  const b = await mkSequenceOn(a, "lowcap-b", 5); // Sequence B, cap 5, same sending account
  await seedSentToday(a, 5);
  const inA = await mkDrafted(a, "lowA");
  const inB = await mkDrafted(b, "lowB");
  await approveMember(a.bdId, inA, 1, { kind: "now" });
  await approveMember(b.bdId, inB, 1, { kind: "now" });
  const { sends, send } = await fakeSend();
  // Only A's member is in scope, but B has a due member on the same account: 5 already sent against the lowest cap (5) leaves 0.
  const summary = await releaseMembersNow(a.bdId, [inA], { send, draftReminder: async () => undefined });
  assert.equal(sends.length, 0);
  assert.equal(summary.released, 0);
  assert.equal(summary.deferred, 1);
  assert.equal(await memberState(inA), "approved");
});
