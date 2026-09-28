/**
 * Unit tests for src/lib/companies/recordMappers.ts — pure logic for the
 * `/companies/[key]` record rebuild (mockups/company-record.html):
 * per-market posting breakdown (Vacantes card), the Activity tab's filter
 * pills, the Startup property's "—" seam, and (mockup-port c05) reducing
 * `company_property_history` rows into a last-edit-per-property map.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterTimelineRows,
  isCompanyActivityFilter,
  isCompanyFilterSelectionComplete,
  latestEditByProperty,
  resolveCompanyScopeRows,
  startupLabel,
  type CompanyTimelineFilterCounts,
} from "@/lib/companies/recordMappers";



test("filterTimelineRows: 'all' returns every row unchanged", () => {
  const rows = [
    { type: "note", scope: "company" as const },
    { type: "status_change", scope: "contact" as const },
  ];
  assert.equal(filterTimelineRows(rows, "all").length, 2);
});

test("filterTimelineRows: 'note' keeps only company-scoped notes", () => {
  const rows = [
    { type: "note", scope: "company" as const, id: "a" },
    { type: "note", scope: "contact" as const, id: "b" },
    { type: "status_change", scope: "company" as const, id: "c" },
  ];
  const result = filterTimelineRows(rows, "note");
  assert.deepEqual(result.map((r) => r.id), ["a"]);
});

test("filterTimelineRows: 'stage_change' keeps only company-scoped status_change rows", () => {
  const rows = [
    { type: "status_change", scope: "company" as const, id: "a" },
    { type: "status_change", scope: "contact" as const, id: "b" },
  ];
  assert.deepEqual(filterTimelineRows(rows, "stage_change").map((r) => r.id), ["a"]);
});

test("filterTimelineRows: 'contact_activity' keeps only contact-scoped rows regardless of type", () => {
  const rows = [
    { type: "email_sent", scope: "contact" as const, id: "a" },
    { type: "note", scope: "company" as const, id: "b" },
    { type: "meeting_logged", scope: "contact" as const, id: "c" },
  ];
  assert.deepEqual(filterTimelineRows(rows, "contact_activity").map((r) => r.id), ["a", "c"]);
});

test("startupLabel: '—' when there's no hiring-index entry or isStartup is unclassified", () => {
  assert.equal(startupLabel(null, "Sí", "No"), "—");
  assert.equal(startupLabel({ isStartup: null, startupReason: null }, "Sí", "No"), "—");
});

test("startupLabel: renders yes/no plus the reason when classified", () => {
  assert.equal(startupLabel({ isStartup: true, startupReason: "Series B, 2025" }, "Sí", "No"), "Sí · Series B, 2025");
  assert.equal(startupLabel({ isStartup: false, startupReason: "Empresa pública" }, "Sí", "No"), "No · Empresa pública");
});

test("startupLabel: renders yes/no with no reason suffix when startupReason is absent", () => {
  assert.equal(startupLabel({ isStartup: true, startupReason: null }, "Sí", "No"), "Sí");
});

test("latestEditByProperty: keeps the first (newest, per caller's ordering) row per property", () => {
  const rows = [
    { property: "industry", bdName: "Ana Pereyra", at: new Date("2026-09-20") },
    { property: "industry", bdName: "Cristian Civita", at: new Date("2026-09-01") },
    { property: "city", bdName: null, at: new Date("2026-09-15") },
  ];
  const map = latestEditByProperty(rows);
  assert.deepEqual(map.get("industry"), { bdName: "Ana Pereyra", at: new Date("2026-09-20") });
  assert.deepEqual(map.get("city"), { bdName: null, at: new Date("2026-09-15") });
  assert.equal(map.get("ownerBdId"), undefined);
});

test("latestEditByProperty: empty input yields an empty map", () => {
  assert.equal(latestEditByProperty([]).size, 0);
});

// fix/company-timeline-filter-no-reload: the client-side counterpart of
// Contact record's isPillSelectionComplete/resolveScopeEntries
// (@/lib/activity/timelinePills), applied to the company timeline's own
// filter vocabulary (all/note/stage_change/contact_activity) instead of
// activity-type pills.
const FULL_COUNTS: CompanyTimelineFilterCounts = { all: 4, note: 1, stage_change: 1, contact_activity: 2 };

test("isCompanyFilterSelectionComplete: true when the loaded pool already has every row for the filter", () => {
  const rows = [
    { type: "note", scope: "company" as const },
    { type: "status_change", scope: "company" as const },
    { type: "email_sent", scope: "contact" as const },
    { type: "meeting_logged", scope: "contact" as const },
  ];
  assert.equal(isCompanyFilterSelectionComplete(rows, FULL_COUNTS, "all"), true);
  assert.equal(isCompanyFilterSelectionComplete(rows, FULL_COUNTS, "contact_activity"), true);
});

test("isCompanyFilterSelectionComplete: false when the loaded (capped) pool is missing rows for the filter", () => {
  // Only 1 of the true 2 "contact_activity" rows made it into this capped pool.
  const rows = [
    { type: "note", scope: "company" as const },
    { type: "email_sent", scope: "contact" as const },
  ];
  assert.equal(isCompanyFilterSelectionComplete(rows, FULL_COUNTS, "contact_activity"), false);
  // "all" is also incomplete: true total is 4, pool only has 2.
  assert.equal(isCompanyFilterSelectionComplete(rows, FULL_COUNTS, "all"), false);
});

test("resolveCompanyScopeRows: 'ready' with the locally filtered rows when the pool is provably complete", () => {
  const rows = [
    { type: "note", scope: "company" as const, id: "a" },
    { type: "status_change", scope: "company" as const, id: "b" },
    { type: "email_sent", scope: "contact" as const, id: "c" },
    { type: "meeting_logged", scope: "contact" as const, id: "d" },
  ];
  const result = resolveCompanyScopeRows(rows, FULL_COUNTS, "note");
  assert.deepEqual(result, { kind: "ready", rows: [rows[0]] });
});

test("resolveCompanyScopeRows: 'fetch' when the pool can't be trusted for that filter", () => {
  const rows = [{ type: "email_sent", scope: "contact" as const, id: "c" }];
  const result = resolveCompanyScopeRows(rows, FULL_COUNTS, "contact_activity");
  assert.deepEqual(result, { kind: "fetch" });
});

test("isCompanyActivityFilter: accepts the 4 known filter keys, rejects everything else", () => {
  assert.equal(isCompanyActivityFilter("all"), true);
  assert.equal(isCompanyActivityFilter("note"), true);
  assert.equal(isCompanyActivityFilter("stage_change"), true);
  assert.equal(isCompanyActivityFilter("contact_activity"), true);
  assert.equal(isCompanyActivityFilter("status_backfill"), false);
  assert.equal(isCompanyActivityFilter(undefined), false);
  assert.equal(isCompanyActivityFilter(""), false);
});
