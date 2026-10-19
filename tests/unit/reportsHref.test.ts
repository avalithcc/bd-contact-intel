/**
 * Unit tests for src/lib/reports/reportsHref.ts — the "/admin/reports"
 * query-string builder shared by ReportsView.tsx (server) and
 * BdFilterSelect.tsx (client).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportsHref } from "@/lib/reports/reportsHref";

test("buildReportsHref omits period=month (the default) and bd=null", () => {
  assert.equal(buildReportsHref("month", null), "/admin/reports");
});

test("buildReportsHref includes a non-default period", () => {
  assert.equal(buildReportsHref("week", null), "/admin/reports?period=week");
});

test("buildReportsHref includes a selected bd id", () => {
  assert.equal(buildReportsHref("month", "bd-1"), "/admin/reports?bd=bd-1");
});

test("buildReportsHref includes both period and bd together", () => {
  assert.equal(buildReportsHref("last_month", "bd-1"), "/admin/reports?period=last_month&bd=bd-1");
});
