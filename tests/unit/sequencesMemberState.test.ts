import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMBER_STATES,
  assertTransition,
  canTransition,
  type MemberState,
  type MemberTrigger,
} from "../../src/lib/sequences/memberState";

const LEGAL: [MemberState, MemberState, MemberTrigger][] = [
  ["drafted", "approved", "approve"],
  ["approved", "drafted", "cancel"],
  ["approved", "drafted", "edit"],
  ["approved", "drafted", "regenerate"],
  ["approved", "sent", "release_step1"],
  ["sent", "replied", "genuine_reply"],
  ["sent", "no_reply", "release_step2"],
  ["no_reply", "replied", "genuine_reply"],
  ["drafted", "discarded", "discard"],
  ["approved", "discarded", "discard"],
  ["discarded", "drafted", "readmit"],
  ["drafted", "discarded", "opt_out"],
  ["approved", "discarded", "opt_out"],
  ["sent", "discarded", "opt_out"],
  ["no_reply", "discarded", "opt_out"],
  ["replied", "discarded", "opt_out"],
];

test("every transition in the sequence-approval table is allowed", () => {
  for (const [from, to, trigger] of LEGAL) {
    assert.equal(canTransition(from, to, trigger), true, `${from} -> ${to} via ${trigger}`);
  }
});

test("every transition outside the table is rejected for every trigger", () => {
  const triggers: MemberTrigger[] = [
    "approve", "cancel", "edit", "regenerate", "release_step1", "release_step2",
    "genuine_reply", "discard", "readmit", "opt_out", "auto_reply",
  ];
  const legal = new Set(LEGAL.map(([f, t, g]) => `${f}|${t}|${g}`));
  for (const from of MEMBER_STATES) {
    for (const to of MEMBER_STATES) {
      for (const trigger of triggers) {
        if (legal.has(`${from}|${to}|${trigger}`)) continue;
        assert.equal(canTransition(from, to, trigger), false, `${from} -> ${to} via ${trigger}`);
      }
    }
  }
});

test("the spec's named impossibilities", () => {
  assert.equal(canTransition("sent", "approved", "approve"), false);
  assert.equal(canTransition("replied", "sent", "release_step1"), false);
  assert.equal(canTransition("replied", "sent", "release_step2"), false);
});

test("an auto-reply can never move a member out of sent", () => {
  for (const to of MEMBER_STATES) {
    assert.equal(canTransition("sent", to, "auto_reply"), false, `sent -> ${to}`);
  }
});

test("a trigger only drives the transition it belongs to", () => {
  assert.equal(canTransition("drafted", "approved", "release_step1"), false);
  assert.equal(canTransition("approved", "sent", "approve"), false);
  assert.equal(canTransition("sent", "replied", "release_step2"), false);
});

test("re-admitting an opt_out discard is rejected", () => {
  assert.equal(canTransition("discarded", "drafted", "readmit", { discardReason: "opt_out" }), false);
});

test("re-admitting a BD discard is allowed", () => {
  assert.equal(canTransition("discarded", "drafted", "readmit", { discardReason: "bd_removed" }), true);
  assert.equal(canTransition("discarded", "drafted", "readmit", { discardReason: null }), true);
});

test("assertTransition throws on an illegal transition instead of ignoring it", () => {
  assert.throws(() => assertTransition("sent", "approved", "approve"), /sent -> approved/);
  assert.doesNotThrow(() => assertTransition("drafted", "approved", "approve"));
});

test("opt_out reaches a replied member so a warm lead cannot be emailed by hand after an unsubscribe", () => {
  assert.equal(canTransition("replied", "discarded", "opt_out"), true);
});

test("opt_out is rejected from discarded and cannot target any other state", () => {
  assert.equal(canTransition("discarded", "discarded", "opt_out"), false);
  for (const to of MEMBER_STATES) {
    if (to === "discarded") continue;
    assert.equal(canTransition("replied", to, "opt_out"), false, `replied -> ${to}`);
  }
});
