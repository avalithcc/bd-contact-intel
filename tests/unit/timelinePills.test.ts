/**
 * Unit tests for src/lib/activity/timelinePills.ts (mockup-port fix:
 * contact-record.html:97-106's 8 timeline filter pills — the DB's raw
 * `activity.type` enum must never leak into the pill row; the four
 * migration/internal types (`hunter_lookup`, `status_change`, `discarded`,
 * `status_backfill`) group behind one "Sistema" pill).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TIMELINE_PILL_KEYS,
  TIMELINE_PILL_GROUPS,
  isTimelinePillKey,
  resolveTimelinePillKey,
  sumPillCount,
  filterEntriesForPill,
  isPillSelectionComplete,
  resolveScopeEntries,
} from "@/lib/activity/timelinePills";

test("TIMELINE_PILL_KEYS has no LinkedIn or Tareas pill and groups the 4 internal types under system", () => {
  assert.deepEqual([...TIMELINE_PILL_KEYS], ["note", "call", "email_sent", "meeting_logged", "system"]);
  assert.deepEqual(
    [...TIMELINE_PILL_GROUPS.system].sort(),
    ["discarded", "hunter_lookup", "status_backfill", "status_change"].sort(),
  );
});

test("TIMELINE_PILL_GROUPS.email_sent includes reply_received (synced Gmail reply), grouped with email_sent not its own pill", () => {
  assert.deepEqual([...TIMELINE_PILL_GROUPS.email_sent], ["email_sent", "reply_received"]);
  assert.equal(isTimelinePillKey("reply_received"), false);
});

test("resolveTimelinePillKey maps the raw reply_received type to the email_sent pill", () => {
  assert.equal(resolveTimelinePillKey("reply_received"), "email_sent");
});

test("sumPillCount for email_sent includes reply_received's count, added to email_sent's own", () => {
  const countsByType = { email_sent: 2, reply_received: 3, note: 1 };
  assert.equal(sumPillCount(countsByType, "email_sent"), 5);
});

test("filterEntriesForPill('email_sent') keeps both email_sent and reply_received entries", () => {
  const entries = [
    { id: "1", type: "email_sent" },
    { id: "2", type: "reply_received" },
    { id: "3", type: "note" },
  ];
  assert.deepEqual(
    filterEntriesForPill(entries, "email_sent").map((e) => e.id),
    ["1", "2"],
  );
});

test("resolveTimelinePillKey accepts a pill key directly", () => {
  assert.equal(resolveTimelinePillKey("note"), "note");
  assert.equal(resolveTimelinePillKey("system"), "system");
});

test("resolveTimelinePillKey maps a legacy raw activity type to its group (deep-link continuity)", () => {
  assert.equal(resolveTimelinePillKey("status_backfill"), "system");
  assert.equal(resolveTimelinePillKey("hunter_lookup"), "system");
  assert.equal(resolveTimelinePillKey("status_change"), "system");
  assert.equal(resolveTimelinePillKey("discarded"), "system");
});

test("resolveTimelinePillKey returns undefined for unknown/empty values", () => {
  assert.equal(resolveTimelinePillKey(undefined), undefined);
  assert.equal(resolveTimelinePillKey(""), undefined);
  assert.equal(resolveTimelinePillKey("bogus"), undefined);
});

test("isTimelinePillKey narrows only the 5 known pill keys", () => {
  assert.equal(isTimelinePillKey("system"), true);
  assert.equal(isTimelinePillKey("status_backfill"), false);
});

test("sumPillCount sums the counts of every type a pill groups", () => {
  const countsByType = { note: 3, hunter_lookup: 2, status_change: 1, discarded: 0, status_backfill: 4 };
  assert.equal(sumPillCount(countsByType, "system"), 7);
  assert.equal(sumPillCount(countsByType, "note"), 3);
  assert.equal(sumPillCount(countsByType, "call"), 0);
});

test("filterEntriesForPill keeps only entries matching the pill's grouped types", () => {
  const entries = [
    { id: "1", type: "note" },
    { id: "2", type: "status_backfill" },
    { id: "3", type: "call" },
    { id: "4", type: "hunter_lookup" },
  ];
  assert.deepEqual(
    filterEntriesForPill(entries, "system").map((e) => e.id),
    ["2", "4"],
  );
  assert.deepEqual(
    filterEntriesForPill(entries, "note").map((e) => e.id),
    ["1"],
  );
});

test("filterEntriesForPill returns every entry unchanged when pill is undefined (the 'Todo' scope)", () => {
  const entries = [{ id: "1", type: "note" }, { id: "2", type: "call" }];
  assert.deepEqual(filterEntriesForPill(entries, undefined), entries);
});

test("isPillSelectionComplete: a single-pill fetch that already covers the true count is complete", () => {
  const countsByType = { note: 3 };
  const loaded = [{ type: "note" }, { type: "note" }, { type: "note" }];
  assert.equal(isPillSelectionComplete(loaded, countsByType, "note"), true);
});

test("isPillSelectionComplete: 'Todo' scope is complete only when every loaded row across all types equals the grand total", () => {
  const countsByType = { note: 2, call: 1 };
  assert.equal(isPillSelectionComplete([{ type: "note" }, { type: "note" }, { type: "call" }], countsByType, undefined), true);
  assert.equal(isPillSelectionComplete([{ type: "note" }, { type: "call" }], countsByType, undefined), false);
});

test("isPillSelectionComplete: busy-contact case — a top-N 'Todo' page can under-represent one pill", () => {
  // Mirrors the production shape called out in the fix: the busiest contact
  // has 335 activities but the server-side 'Todo' page is capped well below
  // that, so its top rows can be dominated by other, more recent types.
  const countsByType = { note: 40, status_backfill: 295 };
  // Only 8 of the 100 most-recent rows happen to be notes — the rest are
  // status_backfill entries pushed to the front by recency.
  const loadedTodoPage = [
    ...Array.from({ length: 8 }, () => ({ type: "note" })),
    ...Array.from({ length: 92 }, () => ({ type: "status_backfill" })),
  ];
  assert.equal(isPillSelectionComplete(loadedTodoPage, countsByType, "note"), false);
  assert.equal(isPillSelectionComplete(loadedTodoPage, countsByType, "system"), false);
});

// Regression coverage for the CRITICAL fix (fresh review): a `router.refresh()`
// after a mutation (e.g. adding a note) delivers a brand new entry pool while
// the user still has a pill selected. `resolveScopeEntries` is the pure
// decision Timeline.tsx's reset effect (and `selectPill`) both reuse to
// re-derive that pill's view from the fresh pool WITHOUT losing the
// selection: filter locally when the fresh pool already proves complete for
// it, otherwise signal that a scoped fetch is required.
test("resolveScopeEntries: complete pool -> ready with the pill's own entries, filtered from the fresh pool", () => {
  const countsByType = { note: 2, call: 1 };
  const freshPool = [{ id: "n1", type: "note" }, { id: "n2", type: "note" }, { id: "c1", type: "call" }];
  assert.deepEqual(resolveScopeEntries(freshPool, countsByType, "note"), {
    kind: "ready",
    entries: [{ id: "n1", type: "note" }, { id: "n2", type: "note" }],
  });
});

test("resolveScopeEntries: incomplete pool -> fetch (never silently drops back to 'Todo')", () => {
  const countsByType = { note: 40, status_backfill: 295 };
  const freshTodoPage = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, type: "note" })),
    ...Array.from({ length: 92 }, (_, i) => ({ id: `b${i}`, type: "status_backfill" })),
  ];
  assert.deepEqual(resolveScopeEntries(freshTodoPage, countsByType, "note"), { kind: "fetch" });
});

test("resolveScopeEntries: a newly added note that belongs to the active pill shows up locally", () => {
  // Mirrors the exact regression scenario: BD is on the "Notas" pill (true
  // count 1), adds a note (now 2), router.refresh() delivers a fresh
  // (small, complete) 'Todo' pool including the new note.
  const countsByType = { note: 2, call: 3 };
  const freshPool = [
    { id: "new-note", type: "note" },
    { id: "old-note", type: "note" },
    { id: "c1", type: "call" },
    { id: "c2", type: "call" },
    { id: "c3", type: "call" },
  ];
  const resolved = resolveScopeEntries(freshPool, countsByType, "note");
  assert.equal(resolved.kind, "ready");
  assert.deepEqual(
    resolved.kind === "ready" ? resolved.entries.map((e) => e.id) : [],
    ["new-note", "old-note"],
  );
});
