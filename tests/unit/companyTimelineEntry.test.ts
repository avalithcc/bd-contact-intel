/**
 * Unit tests for src/lib/companies/companyTimelineEntry.ts —
 * getCompanyTimeline's pure per-row mapping, split out for testability
 * (same convention as tests/unit for src/lib/activity/timelineEntry.ts).
 *
 * Fresh-review fix: `getCompanyTimeline` had the same NULLS-ordering
 * exposure as the contacts list's "Última actividad" and the person
 * timeline — a NON_TOUCH_ACTIVITY_TYPES row (task_updated/task_completed/
 * task_reopened) has `at: null` (effectiveActivityAtSql's NULL branch).
 * These tests pin that such a row still renders with a real `createdAt`
 * (falls back to `rawCreatedAt`, never `new Date(null)` / epoch 1970) and
 * that a real touch's own effective time is preferred when present.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompanyTimelineEntry, type CompanyTimelineRawRow } from "@/lib/companies/companyTimelineEntry";

function rawRow(overrides: Partial<CompanyTimelineRawRow> = {}): CompanyTimelineRawRow {
  return {
    id: "a1",
    type: "email_sent",
    at: "2026-09-20T10:00:00+00:00",
    rawCreatedAt: "2026-09-20T10:00:00+00:00",
    metadata: {},
    actorBdId: null,
    personId: null,
    ...overrides,
  };
}

const noNames = new Map<string, string | null>();

test("buildCompanyTimelineEntry: a real touch uses its own effective time (`at`), not rawCreatedAt", () => {
  const entry = buildCompanyTimelineEntry(
    rawRow({ at: "2026-06-01T00:00:00+00:00", rawCreatedAt: "2026-09-26T00:00:00+00:00" }),
    noNames,
    noNames,
  );
  assert.equal(entry.createdAt.toISOString(), new Date("2026-06-01T00:00:00Z").toISOString());
});

test("buildCompanyTimelineEntry: a non-touch row (at: null) falls back to rawCreatedAt, never epoch 1970", () => {
  const entry = buildCompanyTimelineEntry(
    rawRow({ type: "task_updated", at: null, rawCreatedAt: "2026-09-29T12:00:00+00:00" }),
    noNames,
    noNames,
  );
  assert.equal(entry.createdAt.toISOString(), new Date("2026-09-29T12:00:00Z").toISOString());
  assert.notEqual(entry.createdAt.getTime(), 0, "must never be epoch 1970 (new Date(null))");
});

test("buildCompanyTimelineEntry: an offset-less rawCreatedAt fallback is still pinned to UTC, not the process's local timezone", () => {
  const entry = buildCompanyTimelineEntry(
    rawRow({ type: "task_completed", at: null, rawCreatedAt: "2026-09-29T00:00:00" }),
    noNames,
    noNames,
  );
  assert.equal(
    entry.createdAt.getTime(),
    Date.UTC(2026, 8, 29, 0, 0, 0),
    `expected UTC midnight regardless of TZ=${process.env.TZ ?? "(unset)"}`,
  );
});

test("buildCompanyTimelineEntry: resolves actorName/personName from the given maps, and scope from personId", () => {
  const actorNames = new Map<string, string | null>([["bd1", "Ana Pereyra"]]);
  const personNames = new Map<string, string | null>([["p1", "Juan Martínez"]]);
  const entry = buildCompanyTimelineEntry(
    rawRow({ actorBdId: "bd1", personId: "p1" }),
    personNames,
    actorNames,
  );
  assert.equal(entry.actorName, "Ana Pereyra");
  assert.equal(entry.personName, "Juan Martínez");
  assert.equal(entry.scope, "contact");
});

test("buildCompanyTimelineEntry: no personId -> scope 'company', no actor/person lookups attempted", () => {
  const entry = buildCompanyTimelineEntry(rawRow({ actorBdId: null, personId: null }), noNames, noNames);
  assert.equal(entry.scope, "company");
  assert.equal(entry.actorName, null);
  assert.equal(entry.personName, null);
});
