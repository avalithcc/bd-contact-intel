import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REVIEW_CODES,
  blockerDetail,
  confirmationMatches,
  decideApply,
  keptSide,
  keptStage,
  outcomeTone,
  parseOutcome,
  type ResolutionFacts,
} from "../../src/lib/companies/absorptionReview";

const facts = (over: Partial<ResolutionFacts> = {}): ResolutionFacts => ({
  status: "open",
  absorbedKey: "old name",
  survivorKey: "new name",
  absorbedName: "Old Name, Inc.",
  ...over,
});

test("the typed confirmation is the absorbed name, ignoring surrounding whitespace and nothing else", () => {
  assert.ok(confirmationMatches("Old Name, Inc.", "Old Name, Inc."));
  assert.ok(confirmationMatches("  Old Name, Inc.  ", "Old Name, Inc."));
  assert.ok(!confirmationMatches("old name, inc.", "Old Name, Inc."));
  assert.ok(!confirmationMatches("", "Old Name, Inc."));
  assert.ok(!confirmationMatches(undefined, "Old Name, Inc."));
  assert.ok(!confirmationMatches(null, ""), "an empty expected name never matches");
  assert.ok(!confirmationMatches(42, "42"));
});

test("apply builds the merge group from the proposal as it is now, never from posted keys", () => {
  const d = decideApply(facts(), "Old Name, Inc.");
  assert.deepEqual(d, { ok: true, group: { survivorKey: "new name", deadKeys: ["old name"] } });
});

test("apply refuses a missing, resolved or orphaned proposal before looking at the typed name", () => {
  assert.deepEqual(decideApply(null, "x"), { ok: false, code: "not_open" });
  for (const status of ["applied", "rejected", "withdrawn", "weird"]) {
    assert.deepEqual(decideApply(facts({ status }), "Old Name, Inc."), { ok: false, code: "not_open" }, status);
  }
  assert.deepEqual(decideApply(facts({ absorbedKey: null, absorbedName: null }), "x"), { ok: false, code: "not_open" });
});

test("apply refuses when the typed name does not match the live name", () => {
  assert.deepEqual(decideApply(facts(), "Old Name"), { ok: false, code: "name_mismatch" });
  assert.deepEqual(decideApply(facts(), undefined), { ok: false, code: "name_mismatch" });
});

test("executeMerge blockers are parsed from the thrown message; other errors are not blockers", () => {
  const err = new Error("Refusing to execute:\n- a posting collides\n- 30000 rows would move");
  assert.equal(blockerDetail(err), "a posting collides · 30000 rows would move");
  assert.equal(blockerDetail(new Error("No company row with company_key \"x\".")), null);
  assert.equal(blockerDetail("Refusing to execute:\n- x"), null);
  assert.equal(blockerDetail(new Error(`Refusing to execute:\n- ${"y".repeat(2000)}`))?.length, 600);
});

test("outcomes: only known codes parse, blockers keep a bounded detail, and tone is never green for a refusal", () => {
  assert.equal(parseOutcome({}), null);
  assert.equal(parseOutcome({ result: "<script>" }), null);
  assert.deepEqual(parseOutcome({ result: "applied" }), { code: "applied" });
  assert.deepEqual(parseOutcome({ result: "blocked", detail: "why" }), { code: "blocked", detail: "why" });
  assert.deepEqual(parseOutcome({ result: "applied", detail: "ignored" }), { code: "applied" });
  assert.equal(parseOutcome({ result: "blocked", detail: "z".repeat(900) })?.detail?.length, 600);
  for (const code of REVIEW_CODES) {
    const tone = outcomeTone(code);
    if (code === "applied" || code === "rejected") assert.equal(tone, "success", code);
    else assert.notEqual(tone, "success", code);
  }
  assert.equal(outcomeTone("blocked"), "danger");
  assert.equal(outcomeTone("name_mismatch"), "warn");
});

test("what survives the merge: the survivor's value when it has one, else the absorbed one, else nothing", () => {
  assert.equal(keptSide("a", "s"), "survivor");
  assert.equal(keptSide("a", null), "absorbed");
  assert.equal(keptSide("a", "  "), "absorbed");
  assert.equal(keptSide(null, null), null);
  assert.equal(keptSide(null, "s"), "survivor");
});

test("the stronger stage survives, a tie keeps the survivor, and no stage keeps nothing", () => {
  assert.equal(keptStage("won", "prospect"), "absorbed");
  assert.equal(keptStage("prospect", "won"), "survivor");
  assert.equal(keptStage("prospect", "prospect"), "survivor");
  assert.equal(keptStage("lost", "qualified"), "survivor");
  assert.equal(keptStage(null, null), null);
  assert.equal(keptStage("qualified", null), "absorbed");
});
