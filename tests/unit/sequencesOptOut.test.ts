import assert from "node:assert/strict";
import { test } from "node:test";
import { planOptOutDiscards } from "@/lib/sequences/optOut";

test("every non-terminal membership of the address is planned for discard", () => {
  const plan = planOptOutDiscards([
    { id: "a", state: "drafted" },
    { id: "b", state: "approved" },
    { id: "c", state: "sent" },
    { id: "d", state: "no_reply" },
    { id: "e", state: "replied" },
  ]);
  assert.deepEqual(plan, ["a", "b", "c", "d", "e"]);
});

test("an already discarded membership is left alone", () => {
  assert.deepEqual(planOptOutDiscards([{ id: "a", state: "discarded" }]), []);
});

test("an unknown state is never discarded blindly", () => {
  assert.deepEqual(planOptOutDiscards([{ id: "a", state: "weird" }]), []);
});

test("an address in two Sequences discards both memberships", () => {
  assert.deepEqual(
    planOptOutDiscards([
      { id: "s1", state: "approved" },
      { id: "s2", state: "sent" },
    ]),
    ["s1", "s2"],
  );
});
