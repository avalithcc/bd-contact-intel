import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMergePanel } from "@/lib/sequences/mergePanel";
import { planSequenceMerge, type MergeMembership } from "@/lib/sequences/mergePlan";

const S = { id: "p-s", name: "Brian Casteel" };
const M = { id: "p-m", name: "Brian C. Casteel" };
const mem = (memberId: string, personId: string, state: string, extra: Partial<MergeMembership> = {}): MergeMembership => ({
  memberId,
  personId,
  state,
  sequenceId: "seq1",
  sequenceName: "Florida + US · octubre",
  ...extra,
});
const panel = (rows: MergeMembership[], justCancelled = false) =>
  buildMergePanel({ plan: planSequenceMerge(S.id, M.id, rows), survivor: S, merged: M, justCancelled });

test("neither person in a sequence: no panel, merge proceeds as before", () => {
  assert.equal(panel([]), null);
});

test("scheduled send: blocked, Fusionar disabled, only the approved row can be cancelled", () => {
  const at = new Date("2026-10-15T12:00:00Z");
  const p = panel([mem("m1", S.id, "approved", { scheduledFor: at })])!;
  assert.equal(p.status, "blocked");
  assert.equal(p.canMerge, false);
  assert.deepEqual(p.alerts, ["scheduledSend"]);
  const approved = p.rows.find((r) => r.memberId === "m1")!;
  assert.equal(approved.cancelMemberId, "m1");
  assert.deepEqual(approved.note, { kind: "sendsAt", at });
  assert.equal(approved.personName, S.name);
  // the person without memberships is still listed, like the mockup
  const none = p.rows.find((r) => r.role === "none")!;
  assert.equal(none.personName, M.name);
  assert.equal(p.rows.filter((r) => r.cancelMemberId).length, 1);
  assert.equal(p.footerNote, "blockedUntilCancelled");
});

test("after cancelling: success alert, drafted member repointed, merge enabled", () => {
  const p = panel([mem("m1", M.id, "drafted")], true)!;
  assert.equal(p.status, "ready");
  assert.equal(p.canMerge, true);
  assert.deepEqual(p.alerts, ["sendCancelled"]);
  assert.deepEqual(p.rows[0].note, { kind: "repointed" });
  assert.equal(p.rows[0].cancelMemberId, null);
  assert.equal(p.mergeLabel, "merge");
});

test("a sent member is repointed and the info alert carries the never-delete reason", () => {
  const sentAt = new Date("2026-10-10T12:00:00Z");
  const p = panel([mem("m1", M.id, "replied", { sentAt })])!;
  assert.equal(p.status, "repoints");
  assert.equal(p.canMerge, true);
  assert.deepEqual(p.alerts, ["sentKept"]);
  assert.deepEqual(p.rows[0].note, { kind: "sentKept", sentAt });
  assert.equal(p.footerNote, "nothingScheduled");
});

test("both in the same sequence: names who survives before confirming, hand-edited wins", () => {
  const p = panel([mem("s1", S.id, "drafted"), mem("m1", M.id, "drafted", { handEdited: true })])!;
  assert.equal(p.status, "needsConfirmation");
  assert.equal(p.canMerge, true);
  assert.deepEqual(p.alerts, ["sameSequence"]);
  assert.equal(p.mergeLabel, "mergeAndDiscard");
  const winner = p.rows.find((r) => r.role === "survives")!;
  const loser = p.rows.find((r) => r.role === "discarded")!;
  assert.equal(winner.memberId, "m1");
  assert.deepEqual(winner.note, { kind: "handEdited" });
  assert.equal(loser.memberId, "s1");
  // survivor-side loser can only be removed (the unique constraint forbids keeping both rows)
  assert.deepEqual(loser.note, { kind: "removedUnsent" });
  assert.equal(p.footerNote, "survivorChosen");
  assert.equal(p.help, "keepHandEdited");
});

test("collision where the merged duplicate loses: it is discarded with reason merge_duplicate", () => {
  const p = panel([mem("s1", S.id, "drafted", { handEdited: true }), mem("m1", M.id, "drafted")])!;
  const loser = p.rows.find((r) => r.role === "discarded")!;
  assert.equal(loser.memberId, "m1");
  assert.deepEqual(loser.note, { kind: "discardReason", reason: "merge_duplicate" });
});

test("collision with no hand-edited draft keeps the survivor and says so", () => {
  const p = panel([mem("s1", S.id, "drafted"), mem("m1", M.id, "drafted")])!;
  assert.equal(p.help, "keepSurvivor");
});

test("send-history collision is refused: blocked with its own alert and no merge", () => {
  const p = panel([mem("s1", S.id, "sent"), mem("m1", M.id, "drafted")])!;
  assert.equal(p.status, "blocked");
  assert.equal(p.canMerge, false);
  assert.deepEqual(p.alerts, ["sendHistoryCollision"]);
  assert.equal(p.footerNote, "blockedHistory");
});
