/**
 * The per-BD report's "call attempts" (dials) column. Effort next to outcome: "dialled 40, spoke to 8".
 * Rendered-SQL assertions only (no live DB), same convention as reportsQueries.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { NON_TOUCH_ACTIVITY_TYPES } from "@/lib/contacts/effectiveActivityTime";
import { buildReportPerBdQuery } from "@/lib/reports/queries";
import { OCCURRED_AT_ACTIVITY_TYPES } from "@/lib/status/deriveStatus";

const dialect = new PgDialect();
const rendered = dialect.sqlToQuery(
  buildReportPerBdQuery({
    fromIso: "2026-10-01T03:00:00.000Z",
    toIso: "2026-10-19T14:00:00.000Z",
    fromDate: "2026-10-01",
    toDateExclusive: "2026-11-01",
    bdId: null,
  }),
);

test("the activity pivot counts call_attempt rows and exposes them as call_attempts", () => {
  assert.match(rendered.sql, /count\(\*\) filter \(where activity\.type = 'call_attempt'\)::int as pbc_call_attempts/i);
  assert.match(rendered.sql, /coalesce\(rpt_activity_pivot\.pbc_call_attempts, 0\) as call_attempts/i);
  assert.ok(rendered.params.includes("call_attempt"), "call_attempt must be in the pivot's type filter");
});

test("a dial that later became a call (attempt folded by metadata.callActivityId) is still counted as a dial", () => {
  // notFoldedAttemptSql() hides a settled attempt from the contact timeline. The report must NOT reuse it: the attempt
  // that became a call is still a dial that happened, and dropping it would shrink the denominator of dials-to-calls.
  // Prod 2026-10-21: 3 dials, 2 became calls -> the column reads 3 beside 2 calls.
  assert.doesNotMatch(rendered.sql, /callActivityId/i);
  assert.doesNotMatch(rendered.sql, /outcome/i);
});

test("the dials column sits beside, and does not change, the calls count", () => {
  assert.match(rendered.sql, /count\(\*\) filter \(where activity\.type = 'call'\)::int as pbc_calls/i);
  assert.match(rendered.sql, /coalesce\(rpt_activity_pivot\.pbc_calls, 0\) as calls/i);
});

test("a dial is dated by activity.created_at: call_attempt is neither an occurredAt type nor a non-touch type", () => {
  // recordCallAttempt writes the row at click time, so created_at IS the dial time (callAttempt.ts). Pinned here so a
  // change to either list is noticed instead of silently re-dating or nulling dials.
  assert.ok(!(OCCURRED_AT_ACTIVITY_TYPES as readonly string[]).includes("call_attempt"));
  assert.ok(!(NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes("call_attempt"));
});
