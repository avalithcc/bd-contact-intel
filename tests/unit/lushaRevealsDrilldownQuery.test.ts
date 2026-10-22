process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

/**
 * The "Revelados" drill-down on /admin/lusha must list exactly the rows the KPI above it counts.
 * The KPI is ur_emails + ur_phones of getLushaUsageReport (its ur_spend CTE); the list is buildRevealsDrilldownQuery.
 *
 * Both queries are COMPILED with PgDialect and never executed (no database). The reference is the usage report:
 * every expectation about the drill-down is derived from the SQL ur_spend actually compiles to, not restated by hand,
 * so changing a filter in either query without the other fails here.
 *
 * What this does NOT catch: a change that keeps the SQL text equivalent but alters meaning (a trigger, a view, a changed
 * column default), a divergence in a different query that also feeds the number, or data drift between page load and click.
 * It compares predicates as text; it does not run them. The shared-data check is the prod smoke test on getRevealsDrilldown.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();
const WINDOW = { start: new Date("2026-10-01T03:00:00.000Z"), end: new Date("2026-11-01T03:00:00.000Z") };
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

async function compiled() {
  const { buildRevealsDrilldownQuery, buildUsageReportQuery } = await import("@/lib/lusha/adminDb");
  const usage = dialect.sqlToQuery(buildUsageReportQuery(WINDOW));
  const drill = dialect.sqlToQuery(buildRevealsDrilldownQuery(WINDOW));
  // ur_spend is the CTE that produces the KPI's numbers; cut it out of the full report.
  const spend = norm(usage.sql).match(/ur_spend as \((.*?)\), ur_rej as/)?.[1];
  assert.ok(spend, "ur_spend CTE not found in getLushaUsageReport's query");
  return { usage, drill, spend, drillSql: norm(drill.sql).replace(/\br\./g, "") };
}

const literals = (sql: string, column: string) => [...new Set([...sql.matchAll(new RegExp(`\\b${column} = '(\\w+)'`, "g"))].map((m) => m[1]))].sort();

test("drill-down counts the same state and outcome as the KPI", async () => {
  const { spend, drillSql } = await compiled();
  assert.deepEqual(literals(spend, "state"), ["settled"]);
  assert.deepEqual(literals(spend, "outcome"), ["revealed"]);
  assert.deepEqual(literals(drillSql, "state"), literals(spend, "state"));
  assert.deepEqual(literals(drillSql, "outcome"), literals(spend, "outcome"));
});

test("drill-down covers exactly the fields the KPI counts (emails + phones)", async () => {
  const { spend, drillSql } = await compiled();
  const kpiFields = literals(spend, "field");
  assert.deepEqual(kpiFields, ["emails", "phones"]);
  const inList = drillSql.match(/field in \(([^)]*)\)/)?.[1];
  assert.ok(inList, "drill-down has no `field in (...)` filter");
  assert.deepEqual([...inList.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(), kpiFields);
});

test("the KPI drops a null actor and the drill-down drops it too, structurally (inner join on bd, never left)", async () => {
  const { spend, drillSql } = await compiled();
  assert.match(spend, /actor_bd_id is not null/);
  assert.match(drillSql, /(?<!left |right |full |outer )join bd \w+ on \w+\.id = actor_bd_id/);
  assert.doesNotMatch(drillSql, /\b(left|right|full|outer)\s+join\s+bd\b/);
});

test("both use the same half-open window on `at`, bound to the same instants", async () => {
  const { usage, drill, spend, drillSql } = await compiled();
  const window = /\bat >= \$(\d+)::timestamptz and at < \$(\d+)::timestamptz/;
  const k = spend.match(window);
  const d = drillSql.match(window);
  assert.ok(k && d, "window predicate missing");
  assert.equal(usage.params[Number(k[1]) - 1], WINDOW.start.toISOString());
  assert.equal(usage.params[Number(k[2]) - 1], WINDOW.end.toISOString());
  assert.equal(drill.params[Number(d[1]) - 1], WINDOW.start.toISOString());
  assert.equal(drill.params[Number(d[2]) - 1], WINDOW.end.toISOString());
});

test("the drill-down is newest first with a deterministic tiebreak and the shared row cap", async () => {
  const { drill, drillSql } = await compiled();
  const { DRILLDOWN_ROW_LIMIT } = await import("@/lib/reports/drilldownLimit");
  assert.match(drillSql, /order by at desc, id limit \$\d+\s*$/);
  assert.ok(drill.params.includes(DRILLDOWN_ROW_LIMIT));
});

test("the drill-down names the person the way the repo does and aliases every column with rd_", async () => {
  const { drillSql } = await compiled();
  assert.match(drillSql, /trim\(concat_ws\(' ', p\.first_name, p\.last_name\)\) as rd_person_name/);
  const aliases = [...drillSql.matchAll(/ as (\w+)/g)].map((m) => m[1]);
  assert.ok(aliases.length >= 10);
  for (const a of aliases) assert.match(a, /^rd_/);
});

test("each KPI count (emails, phones) carries the full settled + revealed pair, so the per-column sets above are not a coincidence", async () => {
  const { spend } = await compiled();
  const counts = [...spend.matchAll(/count\(\*\) filter \(where (field = '\w+'[^)]*)\) as (ur_\w+)/g)];
  assert.deepEqual(counts.map((m) => m[2]).sort(), ["ur_emails", "ur_phones"]);
  for (const [, predicate, name] of counts) {
    assert.match(predicate, /state = 'settled'/, `${name} lost its state filter`);
    assert.match(predicate, /outcome = 'revealed'/, `${name} lost its outcome filter`);
  }
});
