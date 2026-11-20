import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { questionsCell } from "@/lib/tenders/questionsCell";

const now = new Date("2026-11-20T15:00:00Z"); // 12:00 ART, Fri

test("no portal row is 'not fetched', a row with a null date is 'not stated': different facts", () => {
  assert.deepEqual(questionsCell({ hasPortalRow: false, questionsUntil: null }, now), { state: "not_fetched" });
  assert.deepEqual(questionsCell({ hasPortalRow: true, questionsUntil: null }, now), { state: "not_stated" });
});

test("a deadline carries the instant, the Argentina day count and a tone", () => {
  const at = new Date("2026-11-25T20:00:00Z");
  assert.deepEqual(questionsCell({ hasPortalRow: true, questionsUntil: at }, now), { state: "deadline", at, daysLeft: 5, tone: "normal" });
});

test("tone boundaries: past is the instant, soon is 3 calendar days in Argentina", () => {
  const tone = (iso: string) => {
    const c = questionsCell({ hasPortalRow: true, questionsUntil: new Date(iso) }, now);
    return c.state === "deadline" ? c.tone : c.state;
  };
  assert.equal(tone("2026-11-20T14:59:59Z"), "past");
  assert.equal(tone("2026-11-20T15:00:00Z"), "soon"); // not past at the exact instant
  assert.equal(tone("2026-11-23T20:00:00Z"), "soon"); // 3 days
  assert.equal(tone("2026-11-24T20:00:00Z"), "normal"); // 4 days
  assert.equal(tone("2026-11-01T20:00:00Z"), "past");
});

test("a removed dictionary key is referenced nowhere in src or tests", () => {
  for (const key of ["colBudget", "budgetBidderSets", "budgetReanalyse", "budgetNoPliego", "BudgetCellView", "budgetCellState"]) {
    const out = spawnSync("rg", ["-l", "-w", key, "src", "tests/unit", "tests/db", "--glob", "!tenderQuestionsCell.test.ts"], { encoding: "utf8" }).stdout;
    assert.equal(out.trim(), "", `${key} still referenced in: ${out}`);
  }

});
