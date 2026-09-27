/**
 * Unit tests for src/lib/contacts/listQueries.ts#idsFromContactListPage —
 * "Seleccionar los N" filter-wide bulk mode (contacts.html:104). Pure
 * mapping only — no DB. `getContactIdsForFilters` (the DB-touching half,
 * not unit-tested per this file's convention) calls
 * `getContactListPage(filters, meBdId, q, 1, cap, ...)` — the EXACT same
 * function the table itself renders from — and passes its result straight
 * through this mapper, so "the filter-derived id set equals what the list
 * shows" is guaranteed by reuse, not by two independent implementations
 * that could drift. This test pins the one part that reuse doesn't
 * automatically prove: the mapping itself never re-sorts, drops, or dedups
 * rows independently of what the page-generating query already decided.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { idsFromContactListPage, type ContactListPageLike } from "@/lib/contacts/bulkTargetIds";

function row(id: string): ContactListPageLike["rows"][number] {
  return { id };
}

test("idsFromContactListPage returns the ids in the SAME order as page.rows — the same order the list itself would render", () => {
  const result = idsFromContactListPage({ rows: [row("p3"), row("p1"), row("p2")], total: 3 });
  assert.deepEqual(result.ids, ["p3", "p1", "p2"]);
});

test("idsFromContactListPage passes through the FULL matching total, not just rows.length — so a capped caller can tell it was truncated", () => {
  const result = idsFromContactListPage({ rows: [row("p1"), row("p2")], total: 9812 });
  assert.equal(result.total, 9812);
  assert.equal(result.ids.length, 2);
});

test("idsFromContactListPage returns an empty id list for a filter matching nothing", () => {
  assert.deepEqual(idsFromContactListPage({ rows: [], total: 0 }), { ids: [], total: 0 });
});
