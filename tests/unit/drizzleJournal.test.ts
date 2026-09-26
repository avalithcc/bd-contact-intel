/**
 * Guards the drizzle-kit journal ordering rule from README.md: `drizzle-kit
 * migrate` compares each entry's `when` with the latest applied `created_at`
 * and silently skips any entry whose `when` is earlier. That skipped 0012 and
 * 0013 in production once; this test makes the mistake fail CI instead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: JournalEntry[];
};

test("drizzle journal entries have strictly increasing `when` timestamps", () => {
  for (let i = 1; i < journal.entries.length; i++) {
    const prev = journal.entries[i - 1];
    const cur = journal.entries[i];
    assert.ok(
      cur.when > prev.when,
      `${cur.tag} (when=${cur.when}) must be later than ${prev.tag} (when=${prev.when}); bump it or drizzle-kit migrate will skip it`,
    );
  }
});

test("drizzle journal idx values are sequential", () => {
  journal.entries.forEach((entry, i) => assert.equal(entry.idx, i, `${entry.tag} has idx ${entry.idx}, expected ${i}`));
});
