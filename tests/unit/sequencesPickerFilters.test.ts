import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PICKER_QUERY, PICKER_MAX_OFFSET, PICKER_SEARCH_MAX_TOKENS, appendPage, normalizePickerQuery, pickerQueryKey, searchTokens,
} from "@/lib/sequences/pickerFilters";

test("every filter is off by default and blocked contacts are hidden", () => {
  assert.deepEqual(DEFAULT_PICKER_QUERY, { search: "", florida: false, hiring: false, mine: false, showBlocked: false, industries: [], noIndustry: false, countries: [], noCountry: false, offset: 0 });
  assert.deepEqual(normalizePickerQuery(undefined), DEFAULT_PICKER_QUERY);
  assert.deepEqual(normalizePickerQuery("nope"), DEFAULT_PICKER_QUERY);
});

test("the server action input is coerced: only a literal true turns a filter on, the search is trimmed and capped", () => {
  const q = normalizePickerQuery({ search: `  ${"a".repeat(300)}  `, florida: true, hiring: "yes", mine: 1, showBlocked: true, offset: 100 });
  assert.equal(q.search.length, 100);
  assert.deepEqual([q.florida, q.hiring, q.mine, q.showBlocked, q.offset], [true, false, false, true, 100]);
});

test("the offset is a non-negative integer within the bound", () => {
  for (const bad of [-5, Number.NaN, "10", null, Infinity]) assert.equal(normalizePickerQuery({ offset: bad }).offset, 0, String(bad));
  assert.equal(normalizePickerQuery({ offset: 7.9 }).offset, 7);
  assert.equal(normalizePickerQuery({ offset: PICKER_MAX_OFFSET + 10 }).offset, PICKER_MAX_OFFSET);
});

test("the search splits into at most a few tokens, ignoring blanks", () => {
  assert.deepEqual(searchTokens("  jose   perez "), ["jose", "perez"]);
  assert.deepEqual(searchTokens("   "), []);
  assert.equal(searchTokens("a b c d e f g").length, PICKER_SEARCH_MAX_TOKENS);
});

test("two queries share a key exactly when they ask the server the same thing", () => {
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, search: "  x " }), pickerQueryKey({ ...DEFAULT_PICKER_QUERY, search: "x" }));
  assert.notEqual(pickerQueryKey(DEFAULT_PICKER_QUERY), pickerQueryKey({ ...DEFAULT_PICKER_QUERY, florida: true }));
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, offset: 50 }), pickerQueryKey(DEFAULT_PICKER_QUERY), "the offset is paging, not a filter");
});

test("appending a page never repeats a contact the BD already sees", () => {
  const c = (personId: string) => ({ personId }) as never;
  assert.deepEqual(appendPage([c("a"), c("b")], [c("b"), c("c")]).map((x: { personId: string }) => x.personId), ["a", "b", "c"]);
});
