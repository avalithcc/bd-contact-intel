import assert from "node:assert/strict";
import { test } from "node:test";
import { planSequenceMerge, type MergeMembership } from "@/lib/sequences/mergePlan";

const S = "survivor";
const M = "merged";
const m = (memberId: string, personId: string, state: string, sequenceId = "seq1"): MergeMembership => ({
  memberId,
  personId,
  state,
  sequenceId,
  sequenceName: `name-${sequenceId}`,
});

test("no memberships: nothing to warn about", () => {
  const p = planSequenceMerge(S, M, []);
  assert.deepEqual(p, { affected: [], blockers: [], repoint: [], discard: [], deleteMembers: [], survivingMembers: [] });
});

test("a drafted merged-side member is repointed and the merge needs acknowledgement (affected is non-empty)", () => {
  const p = planSequenceMerge(S, M, [m("m1", M, "drafted")]);
  assert.deepEqual(p.repoint, ["m1"]);
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.affected, [
    { memberId: "m1", sequenceId: "seq1", sequenceName: "name-seq1", side: "merged", state: "drafted", scheduledSend: false },
  ]);
});

test("an approved member means a send is scheduled: blocked until cancelled, on either side", () => {
  for (const personId of [S, M]) {
    const p = planSequenceMerge(S, M, [m("m1", personId, "approved")]);
    assert.deepEqual(p.blockers, ["scheduled_send"]);
    assert.equal(p.affected[0].scheduledSend, true);
  }
});

test("a sent or replied member on the merged side is repointed, never deleted or discarded", () => {
  for (const state of ["sent", "replied", "no_reply"]) {
    const p = planSequenceMerge(S, M, [m("m1", M, state)]);
    assert.deepEqual(p.repoint, ["m1"]);
    assert.deepEqual(p.deleteMembers, []);
    assert.deepEqual(p.discard, []);
    assert.deepEqual(p.blockers, []);
  }
});

test("same-sequence collision with send history on either side is refused, nothing deleted", () => {
  for (const [sState, mState] of [["sent", "drafted"], ["drafted", "sent"], ["replied", "discarded"], ["sent", "sent"]]) {
    const p = planSequenceMerge(S, M, [m("s1", S, sState), m("m1", M, mState)]);
    assert.deepEqual(p.blockers, ["send_history_collision"]);
    assert.deepEqual(p.deleteMembers, []);
    assert.deepEqual(p.discard, []);
    assert.deepEqual(p.repoint, []);
  }
});

test("same-sequence collision, both drafted: survivor's membership is kept, merged-side one is discarded in place", () => {
  const p = planSequenceMerge(S, M, [m("s1", S, "drafted"), m("m1", M, "drafted")]);
  assert.deepEqual(p.survivingMembers, [{ sequenceId: "seq1", sequenceName: "name-seq1", keep: "survivor" }]);
  assert.deepEqual(p.discard, ["m1"]);
  assert.deepEqual(p.repoint, []);
  assert.deepEqual(p.deleteMembers, []);
});

test("collision where the survivor's membership is discarded and the merged one is live: the live one survives", () => {
  const p = planSequenceMerge(S, M, [m("s1", S, "discarded"), m("m1", M, "drafted")]);
  assert.deepEqual(p.survivingMembers, [{ sequenceId: "seq1", sequenceName: "name-seq1", keep: "merged" }]);
  assert.deepEqual(p.deleteMembers, ["s1"]);
  assert.deepEqual(p.repoint, ["m1"]);
});

test("collision where the merged one is already discarded: nothing to discard again", () => {
  const p = planSequenceMerge(S, M, [m("s1", S, "drafted"), m("m1", M, "discarded")]);
  assert.deepEqual(p.discard, []);
  assert.deepEqual(p.survivingMembers[0].keep, "survivor");
});

test("a member is deleted only if it is drafted or discarded: never any state that has send history", () => {
  const states = ["drafted", "approved", "sent", "replied", "no_reply", "discarded"];
  for (const a of states) {
    for (const b of states) {
      const p = planSequenceMerge(S, M, [m("s1", S, a), m("m1", M, b)]);
      for (const id of p.deleteMembers) {
        const state = id === "s1" ? a : b;
        assert.ok(state === "drafted" || state === "discarded", `${a}/${b} deletes a ${state} member`);
      }
    }
  }
});

test("collisions are per sequence: a member in another sequence is simply repointed", () => {
  const p = planSequenceMerge(S, M, [m("s1", S, "drafted", "seq1"), m("m2", M, "drafted", "seq2")]);
  assert.deepEqual(p.repoint, ["m2"]);
  assert.deepEqual(p.survivingMembers, []);
});
