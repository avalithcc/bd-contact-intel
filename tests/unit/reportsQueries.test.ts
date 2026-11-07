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
  buildRateDrilldownQuery,
  buildReportAggregatesQuery,
  buildReportPerBdQuery,
  buildWonCompaniesDrilldownQuery,
  type MeetingsDrilldownParams,
  type RateDrilldownParams,
  type ReportAggregatesParams,
  type ReportPerBdParams,
  type WonCompaniesDrilldownParams,
} from "@/lib/reports/queries";
import { STATUS_NEUTRAL_ACTIVITY_TYPES } from "@/lib/status/deriveStatus";

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

/** Everything from the first rate CTE to the end of the rate counts — the dated reply-rate block. */
function rateSection(sql: string): string {
  const start = sql.indexOf("rpt_rate_events");
  assert.notEqual(start, -1, "the dated reply-rate CTEs are missing");
  const end = sql.indexOf("rpt_source_status");
  return sql.slice(start, end === -1 ? undefined : end);
}

test("buildReportAggregatesQuery: the reply rate is NOT the status cache over the created-in-period cohort any more", () => {
  const { sql } = renderAgg();
  assert.doesNotMatch(sql, /pbc_in_rate/, "the per-cohort-person client flag only existed to filter the snapshot rate");
  const section = rateSection(sql);
  assert.doesNotMatch(section, /rpt_person_scope/, "the rate must not read the created-in-period cohort at all");
  assert.doesNotMatch(section, /person\.status/, "the rate must not be derived from the person.status cache");
  assert.doesNotMatch(section, /person\.created_at/, "the denominator is 'contacted in the period', not 'created in the period'");
  assert.match(section, /min\(rpt_rate_events\.pbc_at\) filter \(where rpt_rate_events\.pbc_outreach\)/);
  assert.match(section, /max\(rpt_rate_events\.pbc_at\) filter \(where rpt_rate_events\.pbc_reply\)/);
  assert.match(section, /pbc_last_reply_at >= rpt_rate_person\.pbc_first_outreach_at/, "a reply before the period's first outreach never counts");
});

test("buildReportAggregatesQuery: the rate's activity evidence is dated by effectiveActivityAtSql and only the non-neutral types", () => {
  const section = rateSection(renderAgg().sql);
  assert.match(section, /when "activity"\."type" = .status_backfill./i, "a backfill must be dated by metadata.originalAt");
  assert.match(section, /activity\.type in \('email_sent', 'call', 'whatsapp', 'status_change', 'status_backfill', 'reply_received', 'meeting_logged'\)/);
  assert.match(section, /activity\.metadata->>'direction' = 'outbound'/);
  assert.match(section, /activity\.metadata->>'outcome' = 'connected'/);
  // Outreach is 'contacted' ALONE: a manual move to 'replied' would otherwise be its own outreach at the same
  // instant, and `max(reply) >= min(outreach)` would hold by equality — one click, a guaranteed 1/1.
  assert.match(section, /activity\.metadata->>'status' in \('contacted'\)/);
  assert.doesNotMatch(section, /activity\.metadata->>'status' in \('contacted', 'replied', 'meeting'\)/);
  assert.match(section, /activity\.metadata->>'status' in \('replied', 'meeting'\)/);
  for (const type of STATUS_NEUTRAL_ACTIVITY_TYPES) {
    assert.doesNotMatch(section, new RegExp(`'${type}'`), `${type} moves nothing and must not appear in the rate's evidence`);
  }
});

test("buildReportAggregatesQuery: LinkedIn conversation traffic is NOT evidence — `activity` is the only source", () => {
  // Owner decision 2026-11-06: 1044 of the 1259 persons in the metric arrived through imported chat traffic alone,
  // at a visibly different rate (55.8% vs 36.7%). The `message`/`conversation` union arm was deleted, not disabled.
  const { sql } = renderAgg({ ...AGG_PARAMS, bdId: "00000000-0000-0000-0000-000000000001" });
  const section = rateSection(sql);
  for (const forbidden of ["message", "conversation", "peer_profile_key", "is_draft", "sender_profile_key", "profile_key"]) {
    assert.doesNotMatch(section, new RegExp(forbidden), `the rate must not read ${forbidden}`);
  }
  assert.doesNotMatch(section, /union all/, "there is a single evidence source now");
  // The whole statement must not pull those tables in for the rate's sake either.
  assert.doesNotMatch(sql, /from "message"|join "conversation"/);
});

test("buildRateDrilldownQuery: the list reads the same single source, no LinkedIn arm", () => {
  const { sql } = dialect.sqlToQuery(buildRateDrilldownQuery(RATE_DRILLDOWN_PARAMS));
  assert.doesNotMatch(sql, /from "message"|join "conversation"|peer_profile_key/);
});

test("buildReportAggregatesQuery: the rate's person scope is non-merged, BD-scoped and still excludes current clients", () => {
  const section = rateSection(renderAgg({ ...AGG_PARAMS, bdId: "00000000-0000-0000-0000-000000000001" }).sql);
  const scope = section.slice(section.indexOf("rpt_rate_scope"));
  assert.match(scope, /person\.merged_into_id is null/);
  assert.match(scope, /\$\d+::uuid is null or person\.owner_bd_id = \$\d+::uuid/);
  assert.match(scope, /cc_client\.relationship_stage = 'won'[\s\S]*?cc_client\.client_status = 'active'/);
  assert.match(scope, /company_alias/, "the client check canonicalizes company_key through the aliases");
});

test('buildReportAggregatesQuery: "Embudo de contactos" stays a snapshot by current status over the created-in-period cohort', () => {
  const { sql } = renderAgg();
  const funnel = sql.slice(sql.indexOf("rpt_funnel"), sql.indexOf("rpt_source_status"));
  assert.match(funnel, /count\(\*\) filter \(where rpt_person_scope\.status in \('contacted','replied','meeting'\)\)::int as pbc_contacted_or_more/);
  assert.match(funnel, /count\(\*\) filter \(where rpt_person_scope\.status in \('replied','meeting'\)\)::int as pbc_replied_or_more/);
  assert.match(funnel, /count\(\*\) filter \(where rpt_person_scope\.status = 'meeting'\)::int as pbc_meeting/);
  assert.match(sql, /'rateContacted', pbc_rate_contacted/);
  assert.match(sql, /'rateReplied', pbc_rate_replied/);
});

const RATE_DRILLDOWN_PARAMS: RateDrilldownParams = { fromIso: AGG_PARAMS.fromIso, toIso: AGG_PARAMS.toIso, bdId: null };

test("buildRateDrilldownQuery: lists exactly the numerator's persons, with the FIRST qualifying reply as their reply date", () => {
  const { sql, params } = dialect.sqlToQuery(buildRateDrilldownQuery(RATE_DRILLDOWN_PARAMS));
  assert.match(sql, /rpt_rate_events/, "same evidence CTEs as the number it opens");
  assert.match(sql, /rpt_rate_scope/);
  assert.match(sql, /min\(rpt_rate_events\.pbc_at\) as pbc_reply_at/);
  assert.match(sql, /rpt_rate_events\.pbc_reply\s*\n\s*and rpt_rate_events\.pbc_at >= rpt_rate_scope\.pbc_first_outreach_at/);
  assert.doesNotMatch(sql, /person\.status in/, "the list is defined by dated events, never by the status cache");
  assert.doesNotMatch(sql, /sequence_member\.replied_at as reply_at/, "the shown date is the qualifying event, not sequence_member");
  assert.equal(params[params.length - 1], 500);
});

test("buildRateDrilldownQuery: the reply date comes from the qualifying activity row, which is why it is never null here", () => {
  const { sql } = dialect.sqlToQuery(buildRateDrilldownQuery(RATE_DRILLDOWN_PARAMS));
  const events = sql.slice(sql.indexOf("rpt_rate_events"), sql.indexOf("rpt_rate_person"));
  assert.match(events, /activity\.type in \('reply_received', 'meeting_logged'\)/);
  assert.match(events, /as pbc_reply/);
  // reply_at is selected from the events CTE, never left to a nullable side lookup.
  assert.match(sql, /rpt_rate_replied\.pbc_reply_at as reply_at/);
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
  assert.match(sql, /follow_up_queue_item\.queue_date::timestamp at time zone 'UTC'\) \+ interval '3 hours'/i);
});

test("buildReportPerBdQuery: queue-day window does not depend on the session TimeZone (no bare date::timestamptz cast)", () => {
  // `date::timestamptz` is midnight in the SESSION zone, so the ART window
  // [queue_date + 3h, queue_date + 1d 3h) silently moved with it. Naive
  // `::timestamp` + `AT TIME ZONE 'UTC'` pins midnight UTC explicitly.
  const { sql } = renderPerBd();
  assert.doesNotMatch(sql, /queue_date::timestamptz/i);
  assert.equal(sql.match(/queue_date::timestamp at time zone 'UTC'\) \+ interval '(?:1 day )?3 hours'/gi)?.length, 4);
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

const WON_PERIOD = { fromIso: "2026-09-01T03:00:00.000Z", toIso: "2026-09-30T14:00:00.000Z" };
function renderWon(params: WonCompaniesDrilldownParams) {
  return dialect.sqlToQuery(buildWonCompaniesDrilldownQuery(params));
}

test("buildWonCompaniesDrilldownQuery: filters relationship_stage='won' and the nullable bd filter applies to company.owner_bd_id", () => {
  const { sql } = renderWon({ ...WON_PERIOD, bdId: null });
  assert.match(sql, /company\.relationship_stage = 'won'/i);
  assert.match(sql, /\$\d+::uuid is null or company\.owner_bd_id = \$\d+::uuid/i);
});

test("buildWonCompaniesDrilldownQuery: follows the selected period via the date the company moved to 'won'", () => {
  const { sql, params } = renderWon({ fromIso: "2026-10-19T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z", bdId: null });
  assert.match(sql, /activity\.type = 'status_change'/i);
  assert.match(sql, /activity\.person_id is null/i);
  assert.match(sql, /activity\.metadata->>'status' = 'won'/i);
  assert.match(sql, /pbc_won_at >= \$\d+::timestamptz/i);
  assert.match(sql, /pbc_won_at < \$\d+::timestamptz/i);
  assert.ok(params.includes("2026-10-19T03:00:00.000Z"));
});

test("buildWonCompaniesDrilldownQuery: the won-at lookup is correlated to the company, never an unbounded activity scan", () => {
  const { sql } = renderWon({ ...WON_PERIOD, bdId: null });
  assert.match(sql, /activity\.company_key = company\.company_key/i);
});

test("buildReportAggregatesQuery: 'Empresas ganadas' counts won companies by their won date inside the period (won_in_period), plus the undated ones", () => {
  const { sql } = renderAgg();
  assert.match(sql, /as won_in_period/i);
  assert.match(sql, /as won_undated/i);
  const section = sql.slice(sql.indexOf("rpt_won_period"), sql.indexOf("rpt_won_period") + 5000);
  assert.match(section, /company\.relationship_stage = 'won'/i);
  assert.match(section, /activity\.metadata->>'status' = 'won'/i);
  assert.match(section, />= \$\d+::timestamptz/i);
});

test("buildWonCompaniesDrilldownQuery: bounded with a LIMIT", () => {
  const { sql } = renderWon({ ...WON_PERIOD, bdId: null });
  assert.match(sql, /limit \$\d+/i);
});

test("buildWonCompaniesDrilldownQuery: the BD filter rolls up through owned people too (prod bug: Almería Sports Destination / Datapar S.A. have no company.owner_bd_id)", () => {
  const { sql } = renderWon({ ...WON_PERIOD, bdId: "00000000-0000-0000-0000-000000000001" });
  assert.match(sql, /\$\d+::uuid is null or company\.owner_bd_id = \$\d+::uuid or exists \(/i);
  assert.match(sql, /person\.company_key = company\.company_key/i);
  assert.match(sql, /person\.merged_into_id is null/i);
});

test("buildWonCompaniesDrilldownQuery: owner_bd_id/owner_bd_name fall back to the company's most-recently-updated owned person (Datapar case)", () => {
  const { sql } = renderWon({ ...WON_PERIOD, bdId: null });
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

test("buildReportAggregatesQuery: 'Reuniones agendadas' is folded into the same statement, status scheduled, dated up to the full period end and BD-scoped", () => {
  const { sql, params } = renderAgg({ ...AGG_PARAMS, scheduledToIso: "2026-10-01T03:00:00.000Z", bdId: "00000000-0000-0000-0000-000000000001" });
  assert.match(sql, /meeting\.status = 'scheduled'/);
  assert.match(sql, /meeting\.scheduled_at >= \$\d+::timestamptz/);
  assert.match(sql, /meeting\.scheduled_at < \$\d+::timestamptz/);
  assert.match(sql, /meeting\.bd_id = \$\d+::uuid/);
  assert.match(sql, /as meetings_scheduled/);
  assert.ok(params.includes("2026-10-01T03:00:00.000Z"));
});

test("buildReportAggregatesQuery: without scheduledToIso the agendadas window ends at toIso", () => {
  const { params } = renderAgg(AGG_PARAMS);
  assert.ok(params.includes(AGG_PARAMS.toIso));
});

test("the held-meetings KPI and its per-BD column are labelled 'realizadas'; the new KPI is 'agendadas'", async () => {
  const { es } = await import("@/lib/i18n/dictionaries/es");
  const { en } = await import("@/lib/i18n/dictionaries/en");
  assert.equal(es.reports.kpiMeetings, "Reuniones realizadas");
  assert.equal(es.reports.meetingsDialogTitle, "Reuniones realizadas");
  assert.equal(es.reports.activityMeetings, "Reuniones realizadas");
  assert.equal(es.reports.kpiMeetingsScheduled, "Reuniones agendadas");
  assert.equal(en.reports.kpiMeetings, "Meetings held");
  assert.equal(en.reports.meetingsDialogTitle, "Meetings held");
  assert.equal(en.reports.kpiMeetingsScheduled, "Meetings scheduled");
});
