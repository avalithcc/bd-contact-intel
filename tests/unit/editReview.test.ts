/** What saving an edit does to review and approval (owner rule: the editor's own review survives, someone else's does not). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewAfterEdit, type ReviewState } from "@/lib/sequences/editReview";

const ME = "bd-me";
const OTHER = "bd-other";
const NOW = new Date("2026-10-23T16:41:00Z");
const EARLIER = new Date("2026-10-22T21:50:00Z");
const CLEARED = { approvedAt: null, approvedByBdId: null, scheduledFor: null };

test("nobody had reviewed it: the editor becomes the reviewer, now", () => {
  assert.deepEqual(reviewAfterEdit({ reviewedAt: null, reviewedByBdId: null }, ME, NOW), { reviewedAt: NOW, reviewedByBdId: ME, ...CLEARED });
});

test("the same BD had reviewed it: kept, refreshed to now, same reviewer", () => {
  assert.deepEqual(reviewAfterEdit({ reviewedAt: EARLIER, reviewedByBdId: ME }, ME, NOW), { reviewedAt: NOW, reviewedByBdId: ME, ...CLEARED });
});

test("a different BD had reviewed it: the review is cleared", () => {
  assert.deepEqual(reviewAfterEdit({ reviewedAt: EARLIER, reviewedByBdId: OTHER }, ME, NOW), { reviewedAt: null, reviewedByBdId: null, ...CLEARED });
});

test("a review by an unknown reviewer is not the editor's: cleared", () => {
  assert.deepEqual(reviewAfterEdit({ reviewedAt: EARLIER, reviewedByBdId: null }, ME, NOW), { reviewedAt: null, reviewedByBdId: null, ...CLEARED });
});

test("approval and schedule are cleared in every case", () => {
  const states: ReviewState[] = [{ reviewedAt: null, reviewedByBdId: null }, { reviewedAt: EARLIER, reviewedByBdId: ME }, { reviewedAt: EARLIER, reviewedByBdId: OTHER }];
  for (const s of states) {
    const r = reviewAfterEdit(s, ME, NOW);
    assert.deepEqual([r.approvedAt, r.approvedByBdId, r.scheduledFor], [null, null, null]);
  }
});

test("pure: the same input twice gives the same result, and neither input nor clock is mutated", () => {
  const state: ReviewState = { reviewedAt: new Date(EARLIER), reviewedByBdId: ME };
  const now = new Date(NOW);
  const a = reviewAfterEdit(state, ME, now);
  const b = reviewAfterEdit(state, ME, now);
  assert.deepEqual(a, b);
  assert.equal(state.reviewedAt!.getTime(), EARLIER.getTime());
  assert.equal(now.getTime(), NOW.getTime());
  (a.reviewedAt as Date).setFullYear(1999);
  assert.equal(now.getTime(), NOW.getTime());
});

// saveDraftEdit and draftMember run SQL in a transaction, and the scratch database is not runnable here, so these two are
// source guards, not behaviour tests: they pin the wiring that the pure decision above cannot see.
import { readFileSync } from "node:fs";
const source = readFileSync("src/lib/sequences/draftQueries.ts", "utf8");

test("regenerate still clears the review unconditionally (new text nobody has read)", () => {
  const regenerate = source.slice(source.indexOf("onConflictDoUpdate"), source.indexOf("sequenceAuditRow(\"regenerate\""));
  assert.match(regenerate, /editedAt: null, editedByBdId: null, reviewedAt: null, reviewedByBdId: null, approvedAt: null, approvedByBdId: null, scheduledFor: null/);
});

test("saveDraftEdit decides from the reviewer read inside its transaction, after the member lock", () => {
  const save = source.slice(source.indexOf("export async function saveDraftEdit"));
  const lock = save.indexOf('.for("update")');
  const read = save.indexOf("reviewedByBdId: sequenceDraft.reviewedByBdId");
  const decide = save.indexOf("reviewAfterEdit(current");
  assert.ok(lock > 0 && read > lock && decide > read, "member lock, then reviewer read, then the decision");
  assert.ok(save.indexOf("db.transaction") < lock);
});
