/**
 * Unit tests for src/lib/contacts/bulkSelection.ts — the bulk-selection bar
 * (BulkActionsBar.tsx) never appearing bug (owner report): the pure
 * decision of whether a checkbox change event is the header "select all
 * on this page" toggle, extracted so the fragile part (reading the DOM)
 * stays a thin, well-tested wrapper.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { endsFilterWideMode, resolveSelectAllChecked, SELECT_ALL_CHECKBOX_ID, SELECT_ALL_COMPANIES_CHECKBOX_ID } from "@/lib/contacts/bulkSelection";

test("resolveSelectAllChecked: the header select-all checkbox drives every row to its own checked value", () => {
  assert.equal(resolveSelectAllChecked(SELECT_ALL_CHECKBOX_ID, true), true);
  assert.equal(resolveSelectAllChecked(SELECT_ALL_CHECKBOX_ID, false), false);
});

test("resolveSelectAllChecked: any other checkbox (a per-row personId box) is not the select-all toggle", () => {
  assert.equal(resolveSelectAllChecked("some-other-id", true), null);
  assert.equal(resolveSelectAllChecked("", false), null);
});

test("resolveSelectAllChecked: the companies list passes its own header id, and the contacts id is then not the toggle", () => {
  assert.equal(resolveSelectAllChecked(SELECT_ALL_COMPANIES_CHECKBOX_ID, true, SELECT_ALL_COMPANIES_CHECKBOX_ID), true);
  assert.equal(resolveSelectAllChecked(SELECT_ALL_CHECKBOX_ID, true, SELECT_ALL_COMPANIES_CHECKBOX_ID), null);
});

test("endsFilterWideMode: a row toggle or the header select-all toggle both end filter-wide mode", () => {
  const all = SELECT_ALL_COMPANIES_CHECKBOX_ID;
  assert.equal(endsFilterWideMode(all, "", "companyKey", all), true);
  assert.equal(endsFilterWideMode("", "companyKey", "companyKey", all), true);
  assert.equal(endsFilterWideMode("bulk-status-active", "clientStatus", "companyKey", all), false);
  assert.equal(endsFilterWideMode("bulk-confirm-count", "confirmCount", "companyKey", all), false);
});
