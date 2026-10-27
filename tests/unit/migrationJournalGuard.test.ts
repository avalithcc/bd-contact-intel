/**
 * Fixture tests for the pure journal guard in src/lib/migration/journalGuard.ts.
 * The real-files check lives in tests/unit/migrationJournal.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMigrationJournal, LEDGER_MAX_WHEN, LAST_APPLIED_IDX, type GuardEntry } from "../../src/lib/migration/journalGuard";

const DAY = 86_400_000;

/** A healthy journal: idx 0..LAST_APPLIED_IDX, the last one sitting exactly on the ledger max, plus the SQL files. */
function healthy(extra: GuardEntry[] = []): { entries: GuardEntry[]; sqlFiles: string[] } {
  const entries: GuardEntry[] = [];
  for (let i = 0; i <= LAST_APPLIED_IDX; i++) {
    entries.push({ idx: i, tag: `${String(i).padStart(4, "0")}_m${i}`, when: LEDGER_MAX_WHEN - (LAST_APPLIED_IDX - i) * DAY });
  }
  entries.push(...extra);
  const sqlFiles = entries.flatMap((e) => [`${e.tag}.sql`, `${e.tag}_rollback.sql`]);
  return { entries, sqlFiles };
}

const entry = (idx: number, when: number, tag = `${String(idx).padStart(4, "0")}_new`): GuardEntry => ({ idx, tag, when });

test("a healthy journal has no problems", () => {
  const { entries, sqlFiles } = healthy([entry(LAST_APPLIED_IDX + 1, LEDGER_MAX_WHEN + DAY)]);
  assert.deepEqual(checkMigrationJournal(entries, sqlFiles), []);
});

test("a new entry stamped with the real clock (below the ledger max) is caught, with the exact fix", () => {
  const realClock = LEDGER_MAX_WHEN - 20 * DAY;
  const { entries, sqlFiles } = healthy([entry(LAST_APPLIED_IDX + 1, realClock)]);
  const problems = checkMigrationJournal(entries, sqlFiles);
  assert.ok(problems.length >= 1);
  const msg = problems.join("\n");
  assert.match(msg, /silently skip/);
  assert.match(msg, new RegExp(String(LEDGER_MAX_WHEN + DAY)), "names the value to set");
  assert.match(msg, /drizzle\/meta\/_journal\.json/);
  assert.doesNotMatch(msg, /db:push/, "never points at push");
});

test("a new entry exactly equal to the ledger max is still skipped by the migrator", () => {
  const { entries, sqlFiles } = healthy([entry(LAST_APPLIED_IDX + 1, LEDGER_MAX_WHEN)]);
  assert.ok(checkMigrationJournal(entries, sqlFiles).some((p) => /silently skip/.test(p)));
});

test("`when` must be strictly increasing by idx", () => {
  const { entries, sqlFiles } = healthy([entry(LAST_APPLIED_IDX + 1, LEDGER_MAX_WHEN + 5 * DAY), entry(LAST_APPLIED_IDX + 2, LEDGER_MAX_WHEN + 5 * DAY)]);
  assert.ok(checkMigrationJournal(entries, sqlFiles).some((p) => /strictly later/.test(p)));
});

test("an idx gap or duplicate is caught", () => {
  const gap = healthy([entry(LAST_APPLIED_IDX + 2, LEDGER_MAX_WHEN + DAY, `${String(LAST_APPLIED_IDX + 2).padStart(4, "0")}_gap`)]);
  assert.ok(checkMigrationJournal(gap.entries, gap.sqlFiles).some((p) => /idx/.test(p)));
  const dup = healthy([entry(LAST_APPLIED_IDX, LEDGER_MAX_WHEN + DAY, "9999_dup")]);
  assert.ok(checkMigrationJournal(dup.entries, dup.sqlFiles).some((p) => /idx/.test(p)));
});

test("a journal tag without its .sql file is caught", () => {
  const { entries, sqlFiles } = healthy([entry(LAST_APPLIED_IDX + 1, LEDGER_MAX_WHEN + DAY)]);
  const tag = entries.at(-1)!.tag;
  const problems = checkMigrationJournal(entries, sqlFiles.filter((f) => f !== `${tag}.sql`));
  assert.ok(problems.some((p) => p.includes(`${tag}.sql`) && /no such file|missing/i.test(p)));
});

test("a .sql file with no journal entry is caught; rollback files and non-migration files are ignored", () => {
  const { entries, sqlFiles } = healthy();
  const orphan = `${String(LAST_APPLIED_IDX + 1).padStart(4, "0")}_orphan.sql`;
  const problems = checkMigrationJournal(entries, [...sqlFiles, orphan, "9998_orphan_rollback.sql", "notes.sql"]);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes(orphan));
});

test("the grandfathered boundary entry cannot be edited quietly", () => {
  const { entries, sqlFiles } = healthy();
  const edited = entries.map((e) => (e.idx === LAST_APPLIED_IDX ? { ...e, when: e.when - DAY } : e));
  assert.ok(checkMigrationJournal(edited, sqlFiles).some((p) => /applied/.test(p)));
});

test("old entries are grandfathered: a low `when` at or below the last applied idx is not flagged by the floor rule", () => {
  const { entries, sqlFiles } = healthy();
  assert.ok(entries[0].when < LEDGER_MAX_WHEN);
  assert.deepEqual(checkMigrationJournal(entries, sqlFiles), []);
});

test("the checker never mutates its inputs and is repeatable", () => {
  const { entries, sqlFiles } = healthy([entry(LAST_APPLIED_IDX + 1, LEDGER_MAX_WHEN - DAY)]);
  const e0 = JSON.stringify(entries);
  const f0 = JSON.stringify(sqlFiles);
  const first = checkMigrationJournal(entries, sqlFiles);
  const second = checkMigrationJournal(entries, sqlFiles);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(entries), e0);
  assert.equal(JSON.stringify(sqlFiles), f0);
});
