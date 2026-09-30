/**
 * DB layer for /admin/reports — touches `@/db`, so (like
 * src/lib/followUp/queueQueries.ts vs. queueSelection.ts) this needs a live
 * DATABASE_URL and is not unit-tested directly; the query builders it calls
 * (queries.ts) are schema-only and carry the PgDialect render tests instead.
 */
import { db } from "@/db";
import {
  buildReportAggregatesQuery,
  buildReportPerBdQuery,
  type ReportAggregatesParams,
  type ReportAggregatesResult,
  type ReportPerBdParams,
  type ReportPerBdRow,
} from "@/lib/reports/queries";

export async function getReportAggregates(params: ReportAggregatesParams): Promise<ReportAggregatesResult> {
  const [row] = await db.execute<{
    funnel: ReportAggregatesResult["funnel"];
    source_status: { sourceKey: string; status: string; count: number }[];
    discard_reasons: { reason: string; count: number }[];
    pipeline: { stage: string | null; count: number }[];
  }>(buildReportAggregatesQuery(params));
  return {
    funnel: row!.funnel,
    sourceStatus: row!.source_status,
    discardReasons: row!.discard_reasons,
    pipeline: row!.pipeline,
  };
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
