import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_MS, MAX_FUTURE_MS, checkJournalWhen, nextJournalWhen } from "../../src/lib/migration/journalWhen";

const NOW = 1_790_870_000_000;
const e = (idx: number, when: number) => ({ idx, tag: `000${idx}_x`, when });

test("accepts a strictly increasing chain, including a future-dated one", () => {
  const entries = [e(0, NOW - DAY_MS), e(1, NOW + 5 * DAY_MS), e(2, NOW + 6 * DAY_MS)];
  assert.deepEqual(checkJournalWhen(entries, NOW), []);
});

test("flags an entry whose when is not greater than the previous one, with the fix", () => {
  const entries = [e(0, NOW + 10 * DAY_MS), e(1, NOW)];
  const problems = checkJournalWhen(entries, NOW);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /0001_x/);
  assert.match(problems[0], new RegExp(String(NOW + 11 * DAY_MS)));
  assert.match(problems[0], /db:generate/);
});

test("flags a newest when absurdly far in the future (typo guard)", () => {
  const problems = checkJournalWhen([e(0, NOW + MAX_FUTURE_MS + 1)], NOW);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /future/);
});

test("nextJournalWhen is previous max + one day, or now when the chain is in the past", () => {
  assert.equal(nextJournalWhen([e(0, NOW + 3 * DAY_MS)], NOW), NOW + 4 * DAY_MS);
  assert.equal(nextJournalWhen([e(0, NOW - 3 * DAY_MS)], NOW), NOW);
  assert.equal(nextJournalWhen([], NOW), NOW);
});

test("checkJournalWhen does not mutate its input and is repeatable", () => {
  const entries = [e(0, NOW + 10 * DAY_MS), e(1, NOW)];
  const snapshot = JSON.stringify(entries);
  assert.deepEqual(checkJournalWhen(entries, NOW), checkJournalWhen(entries, NOW));
  assert.equal(JSON.stringify(entries), snapshot);
});
