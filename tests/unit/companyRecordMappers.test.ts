/**
 * Unit tests for src/lib/companies/recordMappers.ts — pure logic for the
 * `/companies/[key]` record rebuild (mockups/company-record.html):
 * per-market posting breakdown (Vacantes card), the Activity tab's filter
 * pills, and the Startup property's "—" seam.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterTimelineRows, marketBreakdown, startupLabel } from "@/lib/companies/recordMappers";

test("marketBreakdown: tallies postings by market bucket", () => {
  const postings = [
    { market: "latam" },
    { market: "latam" },
    { market: "us" },
    { market: "other" },
  ];
  assert.deepEqual(marketBreakdown(postings), { latam: 2, us: 1, other: 1, total: 4 });
});

test("marketBreakdown: zero postings", () => {
  assert.deepEqual(marketBreakdown([]), { latam: 0, us: 0, other: 0, total: 0 });
});

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
