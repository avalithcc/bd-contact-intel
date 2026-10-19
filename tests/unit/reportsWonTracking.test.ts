/**
 * Owner decision 2026-10-19: the 57 companies whose status_change to 'won' happened 2026-10-01..06 (ART) are the
 * initial data load, not October wins. Won tracking starts 2026-10-07 00:00 ART.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildReportAggregatesQuery, buildWonCompaniesDrilldownQuery } from "@/lib/reports/queries";
import { WON_TRACKING_STARTS_AT_ISO } from "@/lib/reports/wonTracking";

const dialect = new PgDialect();

test("won tracking starts at Argentina midnight of 2026-10-07", () => {
  assert.equal(WON_TRACKING_STARTS_AT_ISO, "2026-10-07T03:00:00.000Z");
});

test("both won reads cut at the tracking start and read the `status` metadata key", () => {
  const agg = dialect.sqlToQuery(buildReportAggregatesQuery({ fromIso: "2026-10-01T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z", bdId: null }));
  const drill = dialect.sqlToQuery(buildWonCompaniesDrilldownQuery({ fromIso: "2026-10-01T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z", bdId: null }));
  for (const q of [agg, drill]) {
    assert.ok(q.params.includes(WON_TRACKING_STARTS_AT_ISO));
    assert.match(q.sql, /activity\.metadata->>'status' = 'won'/);
    assert.doesNotMatch(q.sql, /metadata->>'to'/);
  }
});
