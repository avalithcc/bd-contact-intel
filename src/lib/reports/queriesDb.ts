/**
 * DB layer for /admin/reports — touches `@/db`, so (like
 * src/lib/followUp/queueQueries.ts vs. queueSelection.ts) this needs a live
 * DATABASE_URL and is not unit-tested directly; the query builders it calls
 * (queries.ts) are schema-only and carry the PgDialect render tests instead.
 */
import { db } from "@/db";
import {
  buildMeetingsDrilldownQuery,
  buildReportAggregatesQuery,
  buildReportPerBdQuery,
  buildWonCompaniesDrilldownQuery,
  type MeetingDrilldownRawResultRow,
  type MeetingsDrilldownParams,
  type ReportAggregatesParams,
  type ReportAggregatesResult,
  type ReportPerBdParams,
  type ReportPerBdRow,
  type WonCompaniesDrilldownParams,
  type WonCompanyDrilldownRawResultRow,
} from "@/lib/reports/queries";
import { buildMeetingDrilldownRows, type MeetingDrilldownRow } from "@/lib/reports/meetingsDrilldown";
import { buildWonCompanyDrilldownRows, type WonCompanyDrilldownRow } from "@/lib/reports/wonCompaniesDrilldown";

export async function getReportAggregates(params: ReportAggregatesParams): Promise<ReportAggregatesResult> {
  const [row] = await db.execute<{
    funnel: ReportAggregatesResult["funnel"];
    source_status: { sourceKey: string; status: string; count: number }[];
    discard_reasons: { reason: string; count: number }[];
    pipeline: { stage: string | null; count: number }[];
    bd_options: { id: string; name: string }[];
  }>(buildReportAggregatesQuery(params));
  return {
    funnel: row!.funnel,
    sourceStatus: row!.source_status,
    discardReasons: row!.discard_reasons,
    pipeline: row!.pipeline,
    bdOptions: row!.bd_options,
  };
}

/** "Empresas ganadas" KPI drilldown — see queries.ts#buildWonCompaniesDrilldownQuery. */
export async function getWonCompaniesDrilldown(params: WonCompaniesDrilldownParams): Promise<WonCompanyDrilldownRow[]> {
  const rows = await db.execute<WonCompanyDrilldownRawResultRow>(buildWonCompaniesDrilldownQuery(params));
  return buildWonCompanyDrilldownRows(
    rows.map((r) => ({
      companyKey: r.company_key,
      displayName: r.display_name,
      ownerBdId: r.owner_bd_id,
      ownerBdName: r.owner_bd_name,
      wonAt: r.won_at,
      wonAtExact: r.won_at_exact,
    })),
  );
}

/** "Reuniones agendadas" KPI drilldown — see queries.ts#buildMeetingsDrilldownQuery. */
export async function getMeetingsDrilldown(params: MeetingsDrilldownParams): Promise<MeetingDrilldownRow[]> {
  const rows = await db.execute<MeetingDrilldownRawResultRow>(buildMeetingsDrilldownQuery(params));
  return buildMeetingDrilldownRows(
    rows.map((r) => ({
      activityId: r.activity_id,
      personId: r.person_id,
      personFirstName: r.person_first_name,
      personLastName: r.person_last_name,
      companyKey: r.company_key,
      companyName: r.company_name,
      bdId: r.bd_id,
      bdName: r.bd_name,
      meetingAt: r.meeting_at,
    })),
  );
}

export async function getReportPerBd(params: ReportPerBdParams): Promise<ReportPerBdRow[]> {
  const rows = await db.execute<{
    bd_id: string;
    bd_name: string;
    notes: number;
    calls: number;
    meetings: number;
    emails_sent: number;
    replies_received: number;
    tasks_completed: number;
    queue_worked: number;
    queue_postponed: number;
    queue_skipped: number;
    queue_still_pending: number;
  }>(buildReportPerBdQuery(params));
  return rows.map((r) => ({
    bdId: r.bd_id,
    bdName: r.bd_name,
    notes: Number(r.notes),
    calls: Number(r.calls),
    meetings: Number(r.meetings),
    emailsSent: Number(r.emails_sent),
    repliesReceived: Number(r.replies_received),
    tasksCompleted: Number(r.tasks_completed),
    queueWorked: Number(r.queue_worked),
    queuePostponed: Number(r.queue_postponed),
    queueSkipped: Number(r.queue_skipped),
    queueStillPending: Number(r.queue_still_pending),
  }));
}
