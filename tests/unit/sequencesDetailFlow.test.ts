import assert from "node:assert/strict";
import { test } from "node:test";
import { approveStep, cardStep, gateRows, readyMemberIds, runReviewIntent, sameContent, summarizeRefusals } from "@/lib/sequences/detailFlow";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";

const NOW = new Date("2026-10-15T15:00:00Z");
const draft = (over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "Subject", body: "Body", edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });
const member = (id: string, over: Partial<DetailMember> = {}): DetailMember => ({
  memberId: id, personId: `p-${id}`, state: "drafted", holdReason: null, firstName: "A", lastName: "B", jobTitle: null, company: "Acme", companyKey: "acme",
  email: "a@acme.test", emailVerified: true, openIt: 1, florida: false, leadership: false, lastContactAt: null, repliedAt: null, sentAt: null,
  reminderDueAt: null, discardedAt: null, discardReason: null, discardedByBdId: null, draft: draft(), reminderDraft: null, ...over,
});

// --- never approve after a failed save --------------------------------------------------------------------------

function ports(over: { save?: () => Promise<unknown>; approve?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      save: async () => (calls.push("save"), (await over.save?.()) ?? { ok: true, footerWarning: false }),
      approve: async () => (calls.push("approve"), (await over.approve?.()) ?? { ok: true, approved: ["m"] }),
    } as Parameters<typeof runReviewIntent>[2],
  };
}
const edited = { subject: "New", body: "New body" };
const stored = { subject: "Subject", body: "Body" };

test("approve saves first, and approves only after the save succeeded", async () => {
  const p = ports();
  const result = await runReviewIntent("approve", { stored, text: edited }, p.ports);
  assert.deepEqual(p.calls, ["save", "approve"]);
  assert.deepEqual(result, { ok: true, persisted: true });
});

test("a FAILED save blocks the approval: approve is never called", async () => {
  for (const error of ["empty", "not_found", "not_editable"] as const) {
    const p = ports({ save: async () => ({ ok: false, error }) });
    const result = await runReviewIntent("approve", { stored, text: edited }, p.ports);
    assert.deepEqual(p.calls, ["save"], error);
    assert.deepEqual(result, { ok: false, error, persisted: false });
  }
});

test("a save that THROWS also blocks the approval", async () => {
  const p = ports({ save: async () => { throw new Error("network"); } });
  const result = await runReviewIntent("approve", { stored, text: edited }, p.ports);
  assert.deepEqual(p.calls, ["save"]);
  assert.deepEqual(result, { ok: false, error: "failed", persisted: false });
});

test("whitespace-only content is the 'empty' error the dialog must show, not a silent no-op", async () => {
  const p = ports({ save: async () => ({ ok: false, error: "empty" }) });
  const result = await runReviewIntent("save", { stored, text: { subject: "   ", body: "\n" } }, p.ports);
  assert.deepEqual(result, { ok: false, error: "empty", persisted: false });
});

test("approving unchanged content does not save (a save would clear the review for nothing)", async () => {
  const p = ports();
  const result = await runReviewIntent("approve", { stored, text: { ...stored } }, p.ports);
  assert.deepEqual(p.calls, ["approve"]);
  assert.deepEqual(result, { ok: true, persisted: false });
});

test("a refused approval after a good save reports the reason AND that the text was persisted (so the page refreshes)", async () => {
  const p = ports({ approve: async () => ({ ok: false, error: "rejected", rejected: [{ memberId: "m", reason: "reply_prefix_subject" }] }) });
  const result = await runReviewIntent("approve", { stored, text: edited }, p.ports);
  assert.deepEqual(result, { ok: false, error: "reply_prefix_subject", persisted: true });
});

test("an approval that throws is a generic failure, after the save", async () => {
  const p = ports({ approve: async () => { throw new Error("boom"); } });
  assert.deepEqual(await runReviewIntent("approve", { stored, text: edited }, p.ports), { ok: false, error: "failed", persisted: true });
});

test("'save' never approves, and saving unchanged content still goes to the server (it may have changed there)", async () => {
  const p = ports();
  assert.deepEqual(await runReviewIntent("save", { stored, text: { ...stored } }, p.ports), { ok: true, persisted: true });
  assert.deepEqual(p.calls, ["save"]);
});

test("sameContent compares the exact text, not a trimmed or normalized version", () => {
  assert.equal(sameContent(stored, { ...stored }), true);
  assert.equal(sameContent(stored, { subject: "Subject ", body: "Body" }), false);
  assert.equal(sameContent(stored, { subject: "Subject", body: "Body\n" }), false);
});

// --- bulk selection ---------------------------------------------------------------------------------------------

test("'Aprobar los N listos' selects exactly the drafted members that have a draft", () => {
  const members = [
    member("ready1"), member("ready2"),
    member("nodraft", { draft: null }),
    member("approved", { state: "approved" }), member("sent", { state: "sent" }), member("gone", { state: "discarded" }),
  ];
  assert.deepEqual(readyMemberIds(members), ["ready1", "ready2"]);
});

test("the gate counts a member as reviewed only when its draft was opened, and drops ids that left the roster or the state", () => {
  const members = [member("a", { draft: draft({ reviewedAt: NOW }) }), member("b"), member("c", { state: "approved" })];
  assert.deepEqual(gateRows(members, ["a", "b", "c", "stale"]), [{ id: "a", reviewed: true }, { id: "b", reviewed: false }]);
});

test("after a member is refreshed as reviewed, the counter follows (the stale-counter obligation)", () => {
  const before = gateRows([member("a"), member("b")], ["a", "b"]);
  const after = gateRows([member("a", { draft: draft({ reviewedAt: NOW }) }), member("b")], ["a", "b"]);
  assert.equal(before.filter((r) => r.reviewed).length, 0);
  assert.equal(after.filter((r) => r.reviewed).length, 1);
});

// --- which step an action means ---------------------------------------------------------------------------------

test("the reminder actions mean step 2; everything else on a card means step 1", () => {
  assert.equal(cardStep("reviewReminder"), 2);
  for (const id of ["reviewDraft", "viewEmail", "viewSent", "cancel", "regenerate"] as const) assert.equal(cardStep(id), 1, id);
});

test("'Aprobar' on a card approves the reminder only when the card is the reminder-due-today card", () => {
  const due = member("r", { state: "sent", reminderDueAt: new Date("2026-10-15T13:00:00Z") });
  const notYet = member("s", { state: "sent", reminderDueAt: new Date("2026-10-20T13:00:00Z") });
  assert.equal(approveStep(due, NOW), 2);
  assert.equal(approveStep(member("d"), NOW), 1);
  assert.equal(approveStep(notYet, NOW), 1);
});

// --- a bulk refusal names the members it refused ----------------------------------------------------------------

test("refusal groups: one group per reason, in first-seen order, naming at most 3 and counting the rest", () => {
  const members = ["1", "2", "3", "4", "5", "6"].map((id) => member(id, { firstName: `N${id}`, lastName: "Z" }));
  const groups = summarizeRefusals(
    [
      { memberId: "1", reason: "unreviewed" },
      { memberId: "2", reason: "missing_footer" },
      { memberId: "3", reason: "unreviewed" },
      { memberId: "4", reason: "unreviewed" },
      { memberId: "5", reason: "unreviewed" },
      { memberId: "6", reason: "missing_footer" },
    ],
    members,
  );
  assert.deepEqual(groups, [
    { reason: "unreviewed", names: ["N1 Z", "N3 Z", "N4 Z"], more: 1 },
    { reason: "missing_footer", names: ["N2 Z", "N6 Z"], more: 0 },
  ]);
});

test("refusal names fall back to the email, and a nameless or unknown member counts as unnamed", () => {
  const members = [
    member("1", { firstName: null, lastName: null, email: "only@acme.test" }),
    member("2", { firstName: "Ana", lastName: null }),
    member("3", { firstName: null, lastName: null, email: null }),
  ];
  const groups = summarizeRefusals(
    [
      { memberId: "1", reason: "no_draft" },
      { memberId: "2", reason: "no_draft" },
      { memberId: "3", reason: "no_draft" },
      { memberId: "ghost", reason: "no_draft" },
    ],
    members,
  );
  assert.deepEqual(groups, [{ reason: "no_draft", names: ["only@acme.test", "Ana"], more: 2 }]);
});

test("summarizing refusals is pure: the same input twice gives the same answer and mutates nothing", () => {
  const members = [member("1"), member("2")];
  const rejected = [{ memberId: "1", reason: "unreviewed" as const }, { memberId: "2", reason: "unreviewed" as const }];
  const snapshot = JSON.stringify({ members, rejected });
  assert.deepEqual(summarizeRefusals(rejected, members), summarizeRefusals(rejected, members));
  assert.equal(JSON.stringify({ members, rejected }), snapshot);
});

test("an oversized bulk request reports its own reason to the review dialog, not a generic failure", async () => {
  const p = ports({ approve: async () => ({ ok: false, error: "too_many", limit: 200 }) });
  const r = await runReviewIntent("approve", { stored, text: stored }, p.ports);
  assert.deepEqual(r, { ok: false, error: "too_many", persisted: false });
});
