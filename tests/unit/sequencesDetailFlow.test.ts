import assert from "node:assert/strict";
import { test } from "node:test";
import { prunedSelection, approveStep, cardStep, gateRows, isSelectableReminder, readyMemberIds, reminderGateRows, selectionBlocked, selectionStep, runReviewIntent, sameContent, summarizeRefusals } from "@/lib/sequences/detailFlow";
import { bulkApprovalGate } from "@/lib/sequences/bulkApprovalGate";
import type { DetailDraft, DetailMember } from "@/lib/sequences/detailQueries";

const NOW = new Date("2026-10-15T15:00:00Z");
const draft = (over: Partial<DetailDraft> = {}): DetailDraft => ({ subject: "Subject", body: "Body", language: null, edited: false, generatedAt: new Date("2026-10-10T09:00:00Z"), editedAt: null, reviewedAt: null, approvedAt: null, scheduledFor: null, ...over });
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
  assert.deepEqual(gateRows(members, ["a", "b", "c", "stale"]), [{ id: "a", reviewed: true, wrongLanguage: false }, { id: "b", reviewed: false, wrongLanguage: false }]);
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
  const due = member("r", { state: "sent", reminderDueAt: new Date("2026-10-15T13:00:00Z"), reminderDraft: draft() });
  const notYet = member("s", { state: "sent", reminderDueAt: new Date("2026-10-20T13:00:00Z"), reminderDraft: draft() });
  // Due, but the reminder was never written. There is nothing to approve, so this must NOT resolve to step 2 — the
  // card offers to generate it instead. A member in exactly this state had both buttons and neither did anything.
  const neverWritten = member("n", { state: "sent", reminderDueAt: new Date("2026-10-15T13:00:00Z"), reminderDraft: null });
  assert.equal(approveStep(due, NOW), 2);
  assert.equal(approveStep(member("d"), NOW), 1);
  assert.equal(approveStep(notYet, NOW), 1);
  assert.equal(approveStep(neverWritten, NOW), 1, "a reminder that does not exist is never the thing being approved");
});

// --- bulk approve for step-2 reminders --------------------------------------------------------------------------

const DUE = new Date("2026-10-15T13:00:00Z");
const reminder = (id: string, over: Partial<DetailMember> = {}): DetailMember => member(id, { state: "sent", draft: draft(), reminderDueAt: DUE, reminderDraft: draft(), ...over });

test("a due reminder with an unapproved draft is selectable; not-yet-due, already approved and no-draft are not", () => {
  assert.equal(isSelectableReminder(reminder("due"), NOW), true);
  assert.equal(isSelectableReminder(reminder("later", { reminderDueAt: new Date("2026-10-20T13:00:00Z") }), NOW), false);
  assert.equal(isSelectableReminder(reminder("done", { reminderDraft: draft({ approvedAt: NOW }) }), NOW), false);
  assert.equal(isSelectableReminder(reminder("none", { reminderDraft: null }), NOW), false);
  assert.equal(isSelectableReminder(member("step1"), NOW), false, "a step-1 draft is not a reminder");
});

test("reminder rows take reviewed from the STEP-2 draft, and drop ids that are not selectable reminders", () => {
  const members = [reminder("a", { reminderDraft: draft({ reviewedAt: NOW }), draft: draft() }), reminder("b"), reminder("c", { reminderDraft: null }), member("d")];
  assert.deepEqual(reminderGateRows(members, ["a", "b", "c", "d", "gone"], NOW), [{ id: "a", reviewed: true, wrongLanguage: false }, { id: "b", reviewed: false, wrongLanguage: false }]);
});

test("the gate still blocks a reminder selection when a selected reminder was never opened", () => {
  const members = [reminder("a", { reminderDraft: draft({ reviewedAt: NOW }) }), reminder("b")];
  assert.equal(bulkApprovalGate(reminderGateRows(members, ["a", "b"], NOW)).enabled, false);
  assert.equal(bulkApprovalGate(reminderGateRows(members, ["a"], NOW)).enabled, true);
  // The step-1 draft's review must not unlock the reminder.
  const m = reminder("x", { draft: draft({ reviewedAt: NOW }), reminderDraft: draft({ reviewedAt: null }) });
  assert.equal(bulkApprovalGate(reminderGateRows([m], ["x"], NOW)).enabled, false);
});

test("a reminder bulk approve resolves to step 2; a draft bulk approve still resolves to step 1", () => {
  const members = [reminder("r1"), reminder("r2"), member("d1"), member("d2")];
  assert.equal(selectionStep(members, ["r1", "r2"], NOW), 2);
  assert.equal(selectionStep(members, ["d1", "d2"], NOW), 1);
  assert.equal(selectionStep(members, [], NOW), null);
  assert.equal(selectionStep(members, ["gone"], NOW), null);
});

test("mixing is prevented: the other step's checkbox is disabled, but a ticked one can always be unticked", () => {
  assert.equal(selectionBlocked(1, 2, false), true);
  assert.equal(selectionBlocked(2, 1, false), true);
  assert.equal(selectionBlocked(2, 2, false), false);
  assert.equal(selectionBlocked(1, null, false), false, "nothing selected: both steps are open");
  assert.equal(selectionBlocked(1, 2, true), false);
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

// --- a ticked card that stops qualifying ------------------------------------------------------------------------

/**
 * The ghost tick. A selected draft is sent and its reminder falls due, so the selection holds both steps for a moment.
 * Step 1 wins and the reminder id leaves the gate rows, but its checkbox stayed ticked and did nothing — and came back
 * as a selection of one the instant the last draft was unticked. What is ticked must be what gets approved.
 */
test("a selected id the active step dropped is pruned out of the selection", () => {
  assert.deepEqual(prunedSelection([{ id: "a" }], ["a", "ghost"]), ["a"]);
  assert.deepEqual(prunedSelection([], ["ghost"]), [], "the last ghost leaves an empty selection, not a bar of one");
});

test("nothing to prune returns null, so the screen never loops setting the same selection", () => {
  assert.equal(prunedSelection([{ id: "a" }, { id: "b" }], ["a", "b"]), null);
  assert.equal(prunedSelection([{ id: "a" }], []), null);
});

test("pruning keeps the surviving ids and their order", () => {
  assert.deepEqual(prunedSelection([{ id: "c" }, { id: "a" }], ["a", "ghost", "c"]), ["a", "c"]);
});
