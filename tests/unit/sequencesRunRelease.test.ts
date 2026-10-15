import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GmailSendError, type GmailSendErrorKind } from "@/lib/gmail/errors";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import {
  runSequenceRelease,
  type HoldChange,
  type ReleaseCandidate,
  type RunnerPorts,
} from "@/lib/sequences/runSequenceRelease";
import type { SuppressionRule } from "@/lib/sequences/suppression";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const NOW = new Date("2026-10-15T14:00:00Z"); // 10:00 Miami (EDT)
const NINE_AM = new Date("2026-10-15T13:00:00Z");

let n = 0;
function candidate(over: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  n += 1;
  const url = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
  const footed = appendFooter("Hello", COMPLIANCE_CONFIG, "us", url);
  return {
    id: `m-${String(n).padStart(3, "0")}`, accountId: "acc-1", sequenceId: "seq-1", dailyCap: 5, step: 1,
    dueAt: new Date(NINE_AM.getTime() + n * 1000), approvedAt: new Date("2026-10-14T20:00:00Z"),
    memberState: "approved", draftApproved: true, merged: false, email: `person${n}@acme.test`, hasClientStatus: false,
    market: "us", body: footed.status === "ok" ? footed.body : "", accountStatus: "connected", activeClaim: null,
    repliedAt: null, inboundReplyAt: null, lastSyncedAt: NOW, step1RfcMessageId: null, step1ThreadId: null, ownerBdId: "bd-1",
    personId: `p-${n}`, subject: "Hi", accountEmail: "sender@mailbox.test", holdReason: null, schedule: DEFAULT_SCHEDULE,
    ...over,
  };
}

type Script = { sendFor?: (c: ReleaseCandidate) => GmailSendErrorKind | "network" | "ok" | "send_failed_5xx" | "send_failed_nostatus" | "claim_throws" | "failclaim_throws" };

function fakes(candidates: ReleaseCandidate[], over: { sentToday?: Map<string, number>; now?: Date; claimNull?: Set<string>; suppression?: SuppressionRule[]; draftThrows?: boolean; failClaimThrows?: boolean; recordThrows?: boolean } & Script = {}) {
  const log: string[] = [];
  const sent: string[] = [];
  const failed: { claimId: string; error: string }[] = [];
  const holds: HoldChange[][] = [];
  const recorded: { id: string; step: number; sentAt: Date }[] = [];
  const messages: Record<string, unknown> = {};
  const ports: RunnerPorts = {
    now: () => over.now ?? NOW,
    load: async () => ({ candidates, sentToday: over.sentToday ?? new Map(), suppression: over.suppression ?? [] }),
    setHolds: async (changes) => void holds.push(changes),
    claim: async (c) => {
      log.push(`claim:${c.id}`);
      if (over.sendFor?.(c) === "claim_throws") throw new Error("db blip");
      return over.claimNull?.has(c.id) ? null : `claim-${c.id}`;
    },
    send: async (c, message) => {
      log.push(`send:${c.id}`);
      sent.push(c.id);
      messages[c.id] = message;
      const outcome = over.sendFor?.(c) ?? "ok";
      if (outcome === "network") throw new TypeError("fetch failed");
      if (outcome === "send_failed_5xx") throw new GmailSendError("send_failed", "Gmail send failed: 503", undefined, 503);
      if (outcome === "send_failed_nostatus") throw new GmailSendError("send_failed", "Gmail send failed");
      if (outcome === "failclaim_throws") throw new GmailSendError("send_failed", "Gmail send failed: 400", undefined, 400);
      if (outcome !== "ok" && outcome !== "claim_throws") throw new GmailSendError(outcome, `boom ${outcome}`, undefined, outcome === "send_failed" ? 400 : undefined);
      return { messageId: `g-${c.id}`, threadId: `t-${c.id}` };
    },
    failClaim: async (claimId, error) => {
      if (over.failClaimThrows) throw new Error("db blip in failClaim");
      failed.push({ claimId, error });
    },
    recordSent: async (c, claimId, _sent, sentAt) => {
      log.push(`record:${c.id}`);
      if (over.recordThrows) throw new Error("db down after send");
      recorded.push({ id: c.id, step: c.step, sentAt });
    },
    draftReminder: async (c) => {
      log.push(`remind:${c.id}`);
      if (over.draftThrows) throw new Error("generator down");
    },
  };
  return { ports, log, sent, failed, holds, recorded, messages };
}
const flat = (h: HoldChange[][]) => h.flat();

test("happy path: claim BEFORE send, then record, then the reminder draft; counts are returned", async () => {
  const c = candidate();
  const f = fakes([c]);
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 0 });
  assert.deepEqual(f.log, [`claim:${c.id}`, `send:${c.id}`, `record:${c.id}`, `remind:${c.id}`]);
  assert.equal(f.recorded[0].sentAt.getTime(), NOW.getTime());
});

test("a lost claim (another run got it, or the row changed since the read) sends nothing and is counted as `lost`, apart from deferred", async () => {
  const c = candidate();
  const other = candidate();
  const f = fakes([c, other], { claimNull: new Set([c.id]) });
  // NOT folded into `deferred`: that already means "over the daily cap" and "account halted". A third meaning would
  // make a member that never gets through look exactly like an ordinary busy day.
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 0, lost: 1 });
  assert.deepEqual(f.sent, [other.id]);
});

test("a load that hit the candidate cap says so in the summary; an uncapped load leaves the field absent", async () => {
  const f = fakes([candidate()]);
  const load = f.ports.load;
  assert.equal("capped" in (await runSequenceRelease(f.ports)), false);
  f.ports.load = async (now) => ({ ...(await load(now)), truncated: true });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 0, capped: true });
});

test("step 2 sends threaded, records the send, and does NOT draft another reminder", async () => {
  const c = candidate({ step: 2, memberState: "sent", step1RfcMessageId: "<a@m.test>", step1ThreadId: "t-1" });
  const f = fakes([c]);
  assert.equal((await runSequenceRelease(f.ports)).released, 1);
  assert.deepEqual((f.messages[c.id] as { reply: unknown }).reply, { inReplyTo: "<a@m.test>", references: "<a@m.test>", threadId: "t-1" });
  assert.deepEqual(f.log, [`claim:${c.id}`, `send:${c.id}`, `record:${c.id}`]);
});

test("a reminder draft failure never fails a send that already went out", async () => {
  const f = fakes([candidate()], { draftThrows: true });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 0 });
});

for (const kind of ["reauth_required", "not_connected"] as const) {
  test(`${kind} on the first of 4 halts that ACCOUNT: the other 3 are not attempted and stay approved`, async () => {
    const mine = [candidate(), candidate(), candidate(), candidate()];
    const f = fakes(mine, { sendFor: () => kind });
    assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 0, deferred: 3, failed: 1 });
    assert.deepEqual(f.sent, [mine[0].id]);
    assert.equal(f.failed.length, 1, "the attempted claim is marked failed (history), so a later run can claim again");
    assert.deepEqual(flat(f.holds).map((h) => [h.memberId, h.reason]), [[mine[0].id, "account_not_connected"]]);
    assert.deepEqual(f.recorded, []);
  });
}

test("halting one account does not stop another account's sends", async () => {
  const a = candidate({ accountId: "acc-A" });
  const b = candidate({ accountId: "acc-B" });
  const f = fakes([a, b], { sendFor: (c) => (c.accountId === "acc-A" ? "reauth_required" : "ok") });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 1 });
  assert.deepEqual(f.recorded.map((r) => r.id), [b.id]);
});

for (const kind of ["send_failed", "temporary"] as const) {
  test(`${kind} on the second of 4 affects only that member: the other 3 are sent, no tight retry`, async () => {
    const mine = [candidate(), candidate(), candidate(), candidate()];
    const f = fakes(mine, { sendFor: (c) => (c.id === mine[1].id ? kind : "ok") });
    assert.deepEqual(await runSequenceRelease(f.ports), { released: 3, held: 0, deferred: 0, failed: 1 });
    assert.deepEqual(f.sent, mine.map((m) => m.id), "each member is attempted exactly once");
    assert.equal(f.failed.length, 1);
    assert.deepEqual(flat(f.holds).map((h) => [h.memberId, h.reason]), [[mine[1].id, "send_failed"]]);
  });
}

test("an unknown error from the send (network drop: Gmail may have accepted it) leaves the claim pending and flags manual_check", async () => {
  const mine = [candidate(), candidate()];
  const f = fakes(mine, { sendFor: (c) => (c.id === mine[0].id ? "network" : "ok") });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 1 });
  assert.deepEqual(f.failed, [], "NOT marked failed: that would allow a second send of a message that may have gone out");
  assert.deepEqual(flat(f.holds).map((h) => [h.memberId, h.reason]), [[mine[0].id, "manual_check"]]);
});

test("a Gmail 5xx may have been accepted: claim stays pending, manual_check, and it is never offered for a re-send", async () => {
  const mine = [candidate(), candidate()];
  const f = fakes(mine, { sendFor: (c) => (c.id === mine[0].id ? "send_failed_5xx" : "ok") });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 1 });
  assert.deepEqual(f.failed, [], "5xx must NOT free the claim");
  assert.deepEqual(flat(f.holds).map((h) => [h.memberId, h.reason]), [[mine[0].id, "manual_check"]]);
});

test("a send_failed with no status is treated as ambiguous (fail safe)", async () => {
  const f = fakes([candidate()], { sendFor: () => "send_failed_nostatus" });
  await runSequenceRelease(f.ports);
  assert.deepEqual(f.failed, []);
  assert.equal(flat(f.holds)[0].reason, "manual_check");
});

test("a Gmail 4xx is a definitive refusal: claim failed (retryable), send_failed hold", async () => {
  const f = fakes([candidate()], { sendFor: () => "failclaim_throws" });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 0, deferred: 0, failed: 1 });
  assert.equal(f.failed.length, 1);
  assert.equal(flat(f.holds)[0].reason, "send_failed");
});

test("an unexpected error in one member (claim throws) becomes manual_check + failed and the loop continues; earlier holds survive", async () => {
  const suppressedOne = candidate({ email: "gone@optout.test" });
  const boom = candidate();
  const fine = candidate();
  const f = fakes([suppressedOne, boom, fine], { suppression: [{ ruleKind: "address", value: "gone@optout.test" }], sendFor: (c) => (c.id === boom.id ? "claim_throws" : "ok") });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 1, deferred: 0, failed: 1 });
  assert.deepEqual(f.recorded.map((r) => r.id), [fine.id]);
  const written = flat(f.holds).map((h) => [h.memberId, h.reason]);
  assert.deepEqual(written, [[suppressedOne.id, "suppressed"], [boom.id, "manual_check"]]);
});

test("if failClaim itself throws, the claim is left pending and the run goes on", async () => {
  const mine = [candidate(), candidate()];
  const f = fakes(mine, { failClaimThrows: true, sendFor: (c) => (c.id === mine[0].id ? "failclaim_throws" : "ok") });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 1, held: 0, deferred: 0, failed: 1 });
  assert.equal(flat(f.holds)[0].reason, "manual_check");
});

test("a failure recording the send (after Gmail accepted it) never frees the claim", async () => {
  const f = fakes([candidate()], { recordThrows: true });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 0, deferred: 0, failed: 1 });
  assert.deepEqual(f.failed, []);
  assert.equal(flat(f.holds)[0].reason, "manual_check");
});

test("held members are not sent, get their reason persisted, and do NOT use the cap", async () => {
  const suppressedOne = candidate({ email: "gone@optout.test" });
  const ok = [candidate({ dailyCap: 2 }), candidate({ dailyCap: 2 }), candidate({ dailyCap: 2 })];
  const f = fakes([suppressedOne, ...ok], { suppression: [{ ruleKind: "address", value: "gone@optout.test" }] });
  suppressedOne.dailyCap = 2;
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 2, held: 1, deferred: 1, failed: 0 });
  assert.ok(!f.sent.includes(suppressedOne.id));
  assert.deepEqual(flat(f.holds).map((h) => [h.memberId, h.reason]), [[suppressedOne.id, "suppressed"]]);
});

test("deferred members get NO hold row: 8 approved, cap 5 releases 5 and defers 3", async () => {
  const eight = Array.from({ length: 8 }, () => candidate());
  const f = fakes(eight);
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 5, held: 0, deferred: 3, failed: 0 });
  assert.deepEqual(flat(f.holds), []);
});

test("cap shared with what was already sent today", async () => {
  const f = fakes([candidate(), candidate()], { sentToday: new Map([["acc-1", 5]]) });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 0, deferred: 2, failed: 0 });
});

test("a run before 09:00 Miami releases nothing and writes nothing", async () => {
  const f = fakes([candidate({ dueAt: new Date("2026-10-14T13:00:00Z") })], { now: new Date("2026-10-15T12:00:00Z") });
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 0, deferred: 1, failed: 0 });
  assert.deepEqual(f.log, []);
});

test("an unmapped market is held with unmapped_market and never claimed or sent", async () => {
  const f = fakes([candidate({ market: "other" })]);
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 1, deferred: 0, failed: 0 });
  assert.deepEqual(f.log, []);
  assert.equal(flat(f.holds)[0].reason, "unmapped_market");
});

test("an existing pending claim is never re-sent and surfaces as manual_check", async () => {
  const f = fakes([candidate({ activeClaim: "pending" })]);
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 1, deferred: 0, failed: 0 });
  assert.deepEqual(f.log, []);
  assert.equal(flat(f.holds)[0].reason, "manual_check");
});

test("a hold is not rewritten when unchanged, and is cleared once the checks pass again", async () => {
  const same = candidate({ merged: true, holdReason: "merged_contact" });
  const cleared = candidate({ holdReason: "sync_stale" });
  const f = fakes([same, cleared]);
  await runSequenceRelease(f.ports);
  assert.deepEqual(flat(f.holds).map((h) => [h.memberId, h.reason]), [[cleared.id, null]]);
});

test("not_approved is counted as held but writes no hold (the card is not an approved card any more)", async () => {
  const f = fakes([candidate({ memberState: "drafted" })]);
  assert.deepEqual(await runSequenceRelease(f.ports), { released: 0, held: 1, deferred: 0, failed: 0 });
  assert.deepEqual(flat(f.holds), []);
});

test("not mutated: frozen candidates run twice with the same outcome", async () => {
  const frozen = [candidate(), candidate()].map((c) => Object.freeze(c));
  const first = await runSequenceRelease(fakes(frozen).ports);
  const second = await runSequenceRelease(fakes(frozen).ports);
  assert.deepEqual(second, first);
});

test("nothing in the runner sets a status: it never imports the status module nor writes a `status` column", () => {
  for (const file of ["runSequenceRelease.ts", "releaseQueries.ts"]) {
    const text = readFileSync(join(__dirname, "..", "..", "src", "lib", "sequences", file), "utf8");
    assert.doesNotMatch(text, /@\/lib\/status/, file);
    assert.doesNotMatch(text, /\.set\(\{[^}]*\bstatus\b/, file);
  }
});
