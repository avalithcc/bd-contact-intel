import assert from "node:assert/strict";
import { test } from "node:test";
import { matchProposalsToGroups, type OpenProposalRef } from "../../src/lib/companyMerge/proposals";

const p = (id: string, absorbedKey: string, survivorKey: string): OpenProposalRef => ({ id, absorbedKey, survivorKey });
const groups = [
  { survivorKey: "acme", deadKeys: ["acme old", "acme inc"] },
  { survivorKey: "globex", deadKeys: ["globex ltd"] },
];

test("a proposal matching a group's survivor and one of its dead keys is matched", () => {
  const r = matchProposalsToGroups(groups, [p("1", "acme old", "acme"), p("2", "globex ltd", "globex")]);
  assert.deepEqual(r.matched.map((m) => m.id), ["1", "2"]);
  assert.deepEqual(r.divergent, []);
});

test("an absorbed company merged into a DIFFERENT survivor than proposed is divergent, never matched", () => {
  const r = matchProposalsToGroups(groups, [p("1", "acme old", "globex")]);
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.divergent, [{ ...p("1", "acme old", "globex"), reason: "absorbed_into_other" }]);
});

test("a proposal whose survivor is itself merged away is divergent", () => {
  const r = matchProposalsToGroups(groups, [p("1", "somebody", "acme old")]);
  assert.deepEqual(r.divergent.map((d) => [d.id, d.reason]), [["1", "survivor_merged_away"]]);
});

test("a proposal that says the group's survivor is the absorbed one is divergent", () => {
  const r = matchProposalsToGroups(groups, [p("1", "acme", "somebody")]);
  assert.deepEqual(r.divergent.map((d) => [d.id, d.reason]), [["1", "absorbed_is_survivor"]]);
});

test("proposals that touch no planned key are ignored", () => {
  assert.deepEqual(matchProposalsToGroups(groups, [p("1", "x", "y")]), { matched: [], divergent: [] });
});

test("pure: same input twice gives the same answer and the input is untouched", () => {
  const open = [p("1", "acme old", "acme"), p("2", "acme inc", "globex")];
  const before = JSON.stringify([groups, open]);
  assert.deepEqual(matchProposalsToGroups(groups, open), matchProposalsToGroups(groups, open));
  assert.equal(JSON.stringify([groups, open]), before);
});
