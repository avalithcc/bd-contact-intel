/**
 * Guards the drizzle-kit journal ordering rule from README.md: `drizzle-kit
 * migrate` compares each entry's `when` with the latest applied `created_at`
 * and silently skips any entry whose `when` is earlier. That skipped 0012 and
 * 0013 in production once; this test makes the mistake fail CI instead.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const snapshotPath = (idx: number) => `drizzle/meta/${String(idx).padStart(4, "0")}_snapshot.json`;

test("every journal tag has a matching drizzle/<tag>.sql file", () => {
  for (const entry of journal.entries) {
    assert.ok(existsSync(`drizzle/${entry.tag}.sql`), `journal tag ${entry.tag} has no drizzle/${entry.tag}.sql on disk`);
  }
});

/**
 * Migrations 0002-0008 were hand-written and never had a snapshot; that
 * history is frozen. Every other idx, including all future ones, must have one.
 */
const KNOWN_MISSING_SNAPSHOT_IDX = new Set([2, 3, 4, 5, 6, 7, 8]);

test("every journal idx has a drizzle/meta/<NNNN>_snapshot.json", () => {
  for (const entry of journal.entries) {
    if (KNOWN_MISSING_SNAPSHOT_IDX.has(entry.idx)) continue;
    assert.ok(existsSync(snapshotPath(entry.idx)), `${entry.tag} (idx ${entry.idx}) has no ${snapshotPath(entry.idx)}`);
  }
});

test("snapshot chain is intact: each prevId equals the previous snapshot's id", () => {
  let prev: { id: string } | null = null;
  for (const entry of journal.entries) {
    const path = snapshotPath(entry.idx);
    if (!existsSync(path)) continue; // reported by the idx test above
    const snap = JSON.parse(readFileSync(path, "utf8")) as { id: string; prevId: string };
    if (prev) assert.equal(snap.prevId, prev.id, `${path}: prevId ${snap.prevId} != previous snapshot id ${prev.id}`);
    prev = snap;
  }
});
