import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Scanned with node:fs, NOT by shelling out to `rg`.
 *
 * The first version of this test ran `spawnSync("rg", ...)`. It passed on the author's machine, where ripgrep is
 * installed, and broke CI on every push: the GitHub runner has no `rg`, so spawnSync returned a null stdout and
 * `.trim()` threw. A test that depends on a binary the test runner does not declare is not a test, it is a property of
 * one laptop - and it fails in the one place that is supposed to be the neutral check.
 */
const SOURCE_DIRS = ["src", "tests/unit", "tests/db"];
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
const SELF = "tenderQuestionsCell.test.ts";

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* sourceFiles(full);
    } else if (SOURCE_EXT.test(entry.name) && entry.name !== SELF) {
      yield full;
    }
  }
}

test("a removed dictionary key is referenced nowhere in src or tests", () => {
  const files = [...SOURCE_DIRS.flatMap((d) => [...sourceFiles(d)])];
  // A scan that silently walked nothing would pass while proving nothing.
  assert.ok(files.length > 100, `expected to scan the source tree, found only ${files.length} files`);

  for (const key of ["colBudget", "budgetBidderSets", "budgetReanalyse", "budgetNoPliego", "BudgetCellView", "budgetCellState"]) {
    const hits = files.filter((f) => new RegExp(`\\b${key}\\b`).test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, [], `${key} is still referenced in: ${hits.join(", ")}`);
  }
});
