/**
 * Prod case 2026-10-19: a meeting logged on 2026-09-30 (activity.created_at) but HELD on 2026-10-02
 * (metadata.at) was bucketed into Q3 by the reports. A meeting counts when it happened, falling back to
 * created_at only when metadata.at is absent or unparseable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { happenedAtSql, resolveHappenedAt } from "@/lib/contacts/effectiveActivityTime";
import { buildMeetingsDrilldownQuery, buildReportPerBdQuery } from "@/lib/reports/queries";

const dialect = new PgDialect();
const LOGGED = new Date("2026-09-30T18:43:00Z");

test("a meeting_logged row happened at metadata.at, not when it was logged", () => {
  const at = resolveHappenedAt({ id: "a", type: "meeting_logged", createdAt: LOGGED, metadata: { at: "2026-10-02T13:00:00.000Z" } });
  assert.equal(at?.toISOString(), "2026-10-02T13:00:00.000Z");
});

test("a meeting_logged row without a usable metadata.at falls back to created_at", () => {
  for (const metadata of [{}, { at: "garbage" }, null, { at: 5 }]) {
    assert.equal(resolveHappenedAt({ id: "a", type: "meeting_logged", createdAt: LOGGED, metadata })?.toISOString(), LOGGED.toISOString());
  }
});

test("other types keep the shared effective-time rule (calls use occurredAt, notes use created_at)", () => {
  assert.equal(resolveHappenedAt({ id: "c", type: "call", createdAt: LOGGED, metadata: { occurredAt: "2026-09-01T10:00:00.000Z" } })?.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal(resolveHappenedAt({ id: "n", type: "note", createdAt: LOGGED, metadata: { at: "2026-10-02T13:00:00.000Z" } })?.toISOString(), LOGGED.toISOString());
  assert.equal(resolveHappenedAt({ id: "t", type: "task_created", createdAt: LOGGED, metadata: {} }), null);
});

test("happenedAtSql reads metadata.at for meeting_logged with the same ISO guard as the other casts", () => {
  const { sql } = dialect.sqlToQuery(happenedAtSql());
  assert.match(sql, /"type" = 'meeting_logged'/i);
  assert.match(sql, /"metadata"->>'at'\) ~ /i);
});

test("the per-BD meetings count and the meetings drill-down both bucket by when the meeting happened", () => {
  const perBd = dialect.sqlToQuery(
    buildReportPerBdQuery({ fromIso: "2026-10-01T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z", fromDate: "2026-10-01", toDateExclusive: "2026-11-01", bdId: null }),
  ).sql;
  const drill = dialect.sqlToQuery(buildMeetingsDrilldownQuery({ fromIso: "2026-10-01T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z", bdId: null })).sql;
  assert.match(perBd, /meeting_logged' and \("activity"\."metadata"->>'at'\)|"type" = 'meeting_logged'/i);
  assert.match(drill, /"type" = 'meeting_logged' and \("activity"\."metadata"->>'at'\)/i);
});
