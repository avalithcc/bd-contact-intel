/**
 * PgDialect render tests for src/lib/reports/queries.ts — the owner-reports
 * page's two round trips (PERFORMANCE.md: "round trips are the budget").
 * Schema-only assertions on the rendered SQL text/params, no live DB — same
 * convention as tests/unit/appShellBadgeCountsQuery.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildMeetingsDrilldownQuery,
  buildReportAggregatesQuery,
  buildReportPerBdQuery,
  buildWonCompaniesDrilldownQuery,
  type MeetingsDrilldownParams,
  type ReportAggregatesParams,
  type ReportPerBdParams,
  type WonCompaniesDrilldownParams,
} from "@/lib/reports/queries";

const dialect = new PgDialect();

const AGG_PARAMS: ReportAggregatesParams = { fromIso: "2026-09-01T03:00:00.000Z", toIso: "2026-09-30T14:00:00.000Z", bdId: null };
const PER_BD_PARAMS: ReportPerBdParams = {
  fromIso: "2026-09-01T03:00:00.000Z",
  toIso: "2026-09-30T14:00:00.000Z",
  fromDate: "2026-09-01",
  toDateExclusive: "2026-10-01",
  bdId: null,
};

function renderAgg(params: ReportAggregatesParams = AGG_PARAMS) {
  return dialect.sqlToQuery(buildReportAggregatesQuery(params));
}
function renderPerBd(params: ReportPerBdParams = PER_BD_PARAMS) {
  return dialect.sqlToQuery(buildReportPerBdQuery(params));
}

test("buildReportAggregatesQuery: person scope excludes merged persons and filters the period", () => {
  const { sql } = renderAgg();
  assert.match(sql, /person\.merged_into_id is null/i);
  assert.match(sql, /person\.created_at >= \$\d+::timestamptz/i);
  assert.match(sql, /person\.created_at < \$\d+::timestamptz/i);
});

test("buildReportAggregatesQuery: nullable bd filter uses the same '::uuid is null or column = ::uuid' shape for person and company", () => {
  const { sql } = renderAgg();
  assert.match(sql, /\$\d+::uuid is null or person\.owner_bd_id = \$\d+::uuid/i);
  assert.match(sql, /\$\d+::uuid is null or company\.owner_bd_id = \$\d+::uuid/i);
});

test("buildReportAggregatesQuery: selects the 4 expected json columns", () => {
  const { sql } = renderAgg();
  assert.match(sql, /as funnel/i);
  assert.match(sql, /as source_status/i);
  assert.match(sql, /as discard_reasons/i);
  assert.match(sql, /as pipeline/i);
});

test("buildReportAggregatesQuery: discard reasons filter type='discarded', join person, and use effectiveActivityAtSql (status_backfill honored)", () => {
  const { sql } = renderAgg();
  assert.match(sql, /activity\.type = 'discarded'/i);
  assert.match(sql, /join person on person\.id = activity\.person_id/i);
  assert.match(sql, /when "activity"\."type" = .status_backfill./i);
});

test("buildReportAggregatesQuery: pipeline groups by relationship_stage and does NOT filter by period (decision 7)", () => {
  const { sql } = renderAgg();
  const pipelineSection = sql.slice(sql.indexOf("rpt_pipeline"), sql.indexOf("rpt_pipeline") + 600);
  assert.match(pipelineSection, /group by company\.relationship_stage/i);
  assert.doesNotMatch(pipelineSection, /created_at/i);
});

test("buildReportAggregatesQuery: pipeline's BD filter rolls up through owned people too (prod bug: real won companies have no company.owner_bd_id)", () => {
  const { sql } = renderAgg({ ...AGG_PARAMS, bdId: "00000000-0000-0000-0000-000000000001" });
  const pipelineSection = sql.slice(sql.indexOf("rpt_pipeline"), sql.indexOf("rpt_pipeline") + 600);
  assert.match(pipelineSection, /\$\d+::uuid is null or company\.owner_bd_id = \$\d+::uuid or exists \(/i);
  assert.match(pipelineSection, /person\.company_key = company\.company_key/i);
  assert.match(pipelineSection, /person\.merged_into_id is null/i);
  assert.match(pipelineSection, /person\.owner_bd_id = \$\d+::uuid/i);
});

test("buildReportAggregatesQuery: source_status groups by source_key and status (bucketing stays in JS, decision 8)", () => {
  const { sql } = renderAgg();
  assert.match(sql, /group by rpt_person_scope\.source_key, rpt_person_scope\.status/i);
});

test('"activity" is never aliased where referenced fully-qualified by its real name (rule 4)', () => {
  const { sql } = renderAgg();
  assert.match(sql, /from "activity"\s*\n/i);
});

test("buildReportPerBdQuery: base is the small bd table, left-joined to each pre-aggregated pivot", () => {
  const { sql } = renderPerBd();
  assert.match(sql, /from "bd"\s*\n/i);
  assert.match(sql, /left join rpt_activity_pivot/i);
  assert.match(sql, /left join rpt_tasks_pivot/i);
  assert.match(sql, /left join rpt_queue_pivot/i);
});

test("buildReportPerBdQuery: activity pivot uses effectiveActivityAtSql and the 5 named activity types", () => {
  const { sql, params } = renderPerBd();
  assert.match(sql, /when "activity"\."type" = .status_backfill./i);
  for (const t of ["note", "call", "meeting_logged", "email_sent", "reply_received"]) {
    assert.ok(params.includes(t), `expected activity type "${t}" among bound params`);
  }
});

test("buildReportPerBdQuery: 'Tareas completadas' sources the task_completed activity's raw created_at, never task.updated_at nor effectiveActivityAtSql (coordinator fix)", () => {
  const { sql } = renderPerBd();
  assert.doesNotMatch(sql, /task\.updated_at/i, "task.updated_at is bumped by any edit, not just completion");
  assert.match(sql, /join "activity" on activity\.type = 'task_completed' and \(activity\.metadata->>'taskId'\)::uuid = task\.id/i);
  assert.match(sql, /pbc_completed_at >= \$\d+::timestamptz/i);
  assert.match(sql, /pbc_completed_at < \$\d+::timestamptz/i);
});

test("buildReportPerBdQuery: 'Tareas completadas' keeps only the LATEST task_completed per task, only while the task is currently 'done'", () => {
  const { sql } = renderPerBd();
  assert.match(sql, /distinct on \(task\.id\)/i);
  assert.match(sql, /order by task\.id, activity\.created_at desc/i);
  assert.match(sql, /rpt_task_completions[\s\S]*?where task\.status = 'done'/i);
});

test("buildReportPerBdQuery: queue pivot scopes queue_date by the ART calendar range (date columns, not timestamptz)", () => {
  const { sql } = renderPerBd();
  assert.match(sql, /follow_up_queue_item\.queue_date >= \$\d+::date/i);
  assert.match(sql, /follow_up_queue_item\.queue_date < \$\d+::date/i);
});

test("buildReportPerBdQuery: queue pivot's worked-check is a correlated EXISTS against activity, keyed off queue_date (not a fixed 'today')", () => {
  const { sql } = renderPerBd();
  assert.match(sql, /exists\s*\(\s*select 1 from "activity"/i);
  assert.match(sql, /activity\.person_id = follow_up_queue_item\.person_id/i);
  assert.match(sql, /follow_up_queue_item\.queue_date::timestamptz \+ interval '3 hours'/i);
});

test("buildReportPerBdQuery: nullable bd filter applies to actor_bd_id, assigned_to_bd_id, and follow_up_queue_item.bd_id independently", () => {
  const { sql } = renderPerBd();
  assert.match(sql, /\$\d+::uuid is null or activity\.actor_bd_id = \$\d+::uuid/i);
  assert.match(sql, /\$\d+::uuid is null or task\.assigned_to_bd_id = \$\d+::uuid/i);
  assert.match(sql, /\$\d+::uuid is null or follow_up_queue_item\.bd_id = \$\d+::uuid/i);
});

test("buildReportPerBdQuery params round-trip with a real bd id (not always null)", () => {
  const { params } = renderPerBd({ ...PER_BD_PARAMS, bdId: "00000000-0000-0000-0000-000000000001" });
  assert.ok(params.includes("00000000-0000-0000-0000-000000000001"));
});

test("buildReportAggregatesQuery: bd_options is an UNFILTERED json_agg of every bd (bug fix — the dropdown must never lose the other BDs once one is selected)", () => {
  const { sql } = renderAgg({ ...AGG_PARAMS, bdId: "00000000-0000-0000-0000-000000000001" });
  const optionsSection = sql.slice(sql.indexOf("rpt_bd_options"), sql.indexOf("rpt_bd_options") + 200);
  assert.match(optionsSection, /select bd\.id as pbc_id, bd\.name as pbc_name/i);
  assert.doesNotMatch(optionsSection, /\$\d+::uuid/i, "bd_options must not filter by bdId");
  assert.match(sql, /as bd_options/i);
});

function renderWon(params: WonCompaniesDrilldownParams) {
  return dialect.sqlToQuery(buildWonCompaniesDrilldownQuery(params));
}

test("buildWonCompaniesDrilldownQuery: filters relationship_stage='won' and the nullable bd filter applies to company.owner_bd_id", () => {
  const { sql } = renderWon({ bdId: null });
  assert.match(sql, /company\.relationship_stage = 'won'/i);
  assert.match(sql, /\$\d+::uuid is null or company\.owner_bd_id = \$\d+::uuid/i);
});

test("buildWonCompaniesDrilldownQuery: never filters by period (decision 7 consistency — see wonCompaniesDrilldown.ts)", () => {
  const { sql } = renderWon({ bdId: null });
  assert.doesNotMatch(sql, /created_at >= /i);
});

test("buildWonCompaniesDrilldownQuery: the won_at activity scan is a correlated EXISTS against rpt_won_companies, not an unbounded activity scan", () => {
  const { sql } = renderWon({ bdId: null });
  assert.match(sql, /exists \(select 1 from rpt_won_companies where rpt_won_companies\.pbc_company_key = activity\.company_key\)/i);
  assert.match(sql, /activity\.type = 'status_change'/i);
  assert.match(sql, /activity\.metadata->>'status' = 'won'/i);
});

test("buildWonCompaniesDrilldownQuery: bounded with a LIMIT", () => {
  const { sql } = renderWon({ bdId: null });
  assert.match(sql, /limit \$\d+/i);
});

test("buildWonCompaniesDrilldownQuery: the BD filter rolls up through owned people too (prod bug: Almería Sports Destination / Datapar S.A. have no company.owner_bd_id)", () => {
  const { sql } = renderWon({ bdId: "00000000-0000-0000-0000-000000000001" });
  assert.match(sql, /\$\d+::uuid is null or company\.owner_bd_id = \$\d+::uuid or exists \(/i);
  assert.match(sql, /person\.company_key = company\.company_key/i);
  assert.match(sql, /person\.merged_into_id is null/i);
});

test("buildWonCompaniesDrilldownQuery: owner_bd_id/owner_bd_name fall back to the company's most-recently-updated owned person (Datapar case)", () => {
  const { sql } = renderWon({ bdId: null });
  assert.match(sql, /distinct on \(person\.company_key\)/i);
  assert.match(sql, /person\.owner_bd_id is not null/i);
  assert.match(sql, /order by person\.company_key, person\.updated_at desc, person\.id/i);
  assert.match(sql, /coalesce\(rpt_won_companies\.pbc_owner_bd_id, rpt_won_company_person_owner\.pbc_owner_bd_id\) as owner_bd_id/i);
});

function renderMeetings(params: MeetingsDrilldownParams) {
  return dialect.sqlToQuery(buildMeetingsDrilldownQuery(params));
}

const MEETINGS_PARAMS: MeetingsDrilldownParams = {
  fromIso: "2026-09-01T03:00:00.000Z",
  toIso: "2026-09-30T14:00:00.000Z",
  bdId: null,
};

test("buildMeetingsDrilldownQuery: filters type='meeting_logged', excludes merged persons, and the nullable bd filter applies to activity.actor_bd_id", () => {
  const { sql } = renderMeetings(MEETINGS_PARAMS);
  assert.match(sql, /activity\.type = 'meeting_logged'/i);
  assert.match(sql, /person\.merged_into_id is null/i);
  assert.match(sql, /\$\d+::uuid is null or activity\.actor_bd_id = \$\d+::uuid/i);
});

test("buildMeetingsDrilldownQuery: scopes by effectiveActivityAtSql (status_backfill honored) for the period bounds", () => {
  const { sql } = renderMeetings(MEETINGS_PARAMS);
  assert.match(sql, /when "activity"\."type" = .status_backfill./i);
  assert.match(sql, /end\) >= \$\d+::timestamptz/i);
  assert.match(sql, /end\) < \$\d+::timestamptz/i);
});

test("buildMeetingsDrilldownQuery: bounded with a LIMIT", () => {
  const { sql } = renderMeetings(MEETINGS_PARAMS);
  assert.match(sql, /limit \$\d+/i);
});
