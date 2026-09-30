import Link from "next/link";
import { es } from "@/lib/i18n/dictionaries/es";
import type { ReportPeriod, ReportPeriodRange } from "@/lib/reports/period";
import { buildReportsHref } from "@/lib/reports/reportsHref";
import { buildFunnelBreakdown } from "@/lib/reports/funnel";
import { buildSourceConversionRows, type SourceBucket } from "@/lib/reports/sourceBucket";
import { buildDiscardReasonRows, discardReasonLabel, totalDiscardCount } from "@/lib/reports/discardReasons";
import { buildPipelineRows } from "@/lib/reports/pipeline";
import { buildQueueAdherenceRow } from "@/lib/reports/queueAdherence";
import type { ReportAggregatesResult, ReportPerBdRow } from "@/lib/reports/queries";
import { stageBadgeClass, stageLabelOf } from "@/lib/companies/listMappers";
import { InfoIcon } from "@/components/icons";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { BdFilterSelect } from "./BdFilterSelect";
import { WonCompaniesKpiCard } from "./WonCompaniesKpiCard";
import { MeetingsKpiCard } from "./MeetingsKpiCard";

const dict = es.reports;

const SOURCE_LABEL: Record<SourceBucket, string> = {
  hubspot: dict.sourceHubspot,
  linkedin: dict.sourceLinkedin,
  manual: dict.sourceManual,
  other: dict.sourceOther,
};

function pctOf(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

/**
 * Collapsed illustrative reference for the "Descartes por motivo" empty
 * state (mockup reports.html:89-93, decision 3) — a FIXED, hard-coded
 * example distribution, never real data (real data, when present, renders
 * the actual table below instead). Bar widths/colors and counts are copied
 * 1:1 from the approved mockup.
 */
const DISCARD_REFERENCE_BAR = [
  { reason: "wrong_profile" as const, count: 17, barClass: "bar-info", widthPct: 37 },
  { reason: "not_interested" as const, count: 11, barClass: "bar-warn", widthPct: 24 },
  { reason: "other_vendor" as const, count: 9, barClass: "bar-success", widthPct: 20 },
  { reason: "left_company" as const, count: 7, barClass: "bar-neutral", widthPct: 15 },
];
const DISCARD_REFERENCE_REMAINING = [
  { reason: "bad_data" as const, count: 4 },
  { reason: "other" as const, count: 2 },
];

/**
 * Pure presentation for /admin/reports (owner-reporting) — no auth gate, no
 * DB. `page.tsx` fetches the two round trips and renders this; a throwaway
 * screenshot probe (deleted after use) rendered it with a hard-coded stub
 * `ReportAggregatesResult`/`ReportPerBdRow[]` instead, so a mockup-parity
 * screenshot never touched production data.
 */
export function ReportsView({
  period,
  bdId,
  range,
  aggregates,
  perBd,
}: {
  period: ReportPeriod;
  bdId: string | null;
  range: ReportPeriodRange;
  aggregates: ReportAggregatesResult;
  perBd: ReportPerBdRow[];
}) {
  const funnel = buildFunnelBreakdown(aggregates.funnel);
  const sourceRows = buildSourceConversionRows(aggregates.sourceStatus);
  const sourceTotal = sourceRows.reduce(
    (acc, r) => ({
      newCount: acc.newCount + r.newCount,
      contactedCount: acc.contactedCount + r.contactedCount,
      repliedCount: acc.repliedCount + r.repliedCount,
      meetingCount: acc.meetingCount + r.meetingCount,
    }),
    { newCount: 0, contactedCount: 0, repliedCount: 0, meetingCount: 0 },
  );

  const discardRows = buildDiscardReasonRows(aggregates.discardReasons);
  const discardTotal = totalDiscardCount(discardRows);

  const pipelineRows = buildPipelineRows(aggregates.pipeline);
  const qualifiedCount = pipelineRows.find((r) => r.stage === "qualified")?.count ?? 0;

  const perBdRows = perBd.map((row) => ({
    ...row,
    queue: buildQueueAdherenceRow({
      worked: row.queueWorked,
      postponed: row.queuePostponed,
      skipped: row.queueSkipped,
      stillPending: row.queueStillPending,
    }),
  }));
  const activityTotal = perBdRows.reduce(
    (acc, r) => ({
      notes: acc.notes + r.notes,
      calls: acc.calls + r.calls,
      meetings: acc.meetings + r.meetings,
      emailsSent: acc.emailsSent + r.emailsSent,
      repliesReceived: acc.repliesReceived + r.repliesReceived,
      tasksCompleted: acc.tasksCompleted + r.tasksCompleted,
    }),
    { notes: 0, calls: 0, meetings: 0, emailsSent: 0, repliesReceived: 0, tasksCompleted: 0 },
  );
  const queueTotal = buildQueueAdherenceRow({
    worked: perBdRows.reduce((s, r) => s + r.queue.worked, 0),
    postponed: perBdRows.reduce((s, r) => s + r.queue.postponed, 0),
    skipped: perBdRows.reduce((s, r) => s + r.queue.skipped, 0),
    stillPending: perBdRows.reduce((s, r) => s + r.queue.stillPending, 0),
  });
  const hasQueueHistory = queueTotal.assigned > 0;

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{dict.eyebrow}</div>
          <h1 className="m-0">
            {dict.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{dict.subtitle}</p>
        </div>
        <div className="actions">
          <span className="badge badge-neutral no-dot">{dict.adminBadge}</span>
        </div>
      </div>

      <div className="row wrap between mb-lg" aria-label="Filtros del reporte">
        <div className="row wrap" style={{ gap: "var(--space-lg)" }}>
          <div className="segmented" role="group" aria-label={dict.periodFilterLabel}>
            <Link href={buildReportsHref("week", bdId)} className={period === "week" ? "on" : ""} aria-current={period === "week" ? "page" : undefined}>
              {dict.periodWeek}
            </Link>
            <Link href={buildReportsHref("month", bdId)} className={period === "month" ? "on" : ""} aria-current={period === "month" ? "page" : undefined}>
              {dict.periodMonth}
            </Link>
            <Link href={buildReportsHref("quarter", bdId)} className={period === "quarter" ? "on" : ""} aria-current={period === "quarter" ? "page" : undefined}>
              {dict.periodQuarter}
            </Link>
          </div>
          <form className="row wrap" style={{ gap: "var(--space-sm)" }}>
            <input type="hidden" name="period" value={period} />
            <label className="label sr-only" htmlFor="bd-filter">
              {dict.bdFilterLabel}
            </label>
            <BdFilterSelect period={period} bdId={bdId} options={aggregates.bdOptions} allLabel={dict.allBds} />
            {/* No-JS fallback only (bug fix: BdFilterSelect now applies on
                change for everyone else) — invisible whenever JS runs. */}
            <noscript>
              <button type="submit" className="btn btn-ghost btn-sm">
                {dict.applyFilter}
              </button>
            </noscript>
          </form>
        </div>
        <span className="meta">{dict.periodLabel(range.label)}</span>
      </div>

      <div className="grid-4 mb-lg">
        <div className="stat neutral">
          <div className="label">{dict.kpiNewContacts}</div>
          <div className="value">{funnel.newTotal}</div>
          <div className="foot">{dict.kpiNewContactsFoot}</div>
        </div>
        <div className="stat info">
          <div className="label">{dict.kpiReplyRate}</div>
          <div className="value">{funnel.replyRatePct}%</div>
          <div className="foot">{dict.kpiReplyRateFoot}</div>
        </div>
        {/* Bug fix: this KPI used to reuse `funnel.meeting` (persons whose
            CURRENT status is "meeting", scoped by person.owner_bd_id) —
            inconsistent with "Actividad por BD"'s own "Reuniones" column
            (activity.actor_bd_id), so filtering by a BD who logged meetings
            for OTHER BDs' contacts showed 0 here while the activity table
            showed a real count. Now sourced from `activityTotal.meetings`
            (same actor-scoped, period-scoped rpt_activity_pivot query as
            the activity table), so the two numbers can never disagree. The
            "Embudo de contactos" card's own "Reunión" row below keeps the
            owner-scoped `funnel.meeting` definition — a deliberately
            different question ("how far did MY contacts progress"). */}
        <MeetingsKpiCard
          value={activityTotal.meetings}
          foot={dict.kpiMeetingsFoot}
          fromIso={range.fromIso}
          toIso={range.toIso}
          bdId={bdId}
        />
        <WonCompaniesKpiCard
          value={pipelineRows.find((r) => r.stage === "won")?.count ?? 0}
          foot={dict.kpiCompaniesWonFoot(qualifiedCount)}
          bdId={bdId}
        />
      </div>

      <div className="card mb-lg">
        <div className="card-header">
          <h3>{dict.discardReasonsTitle}</h3>
        </div>
        <div className="card-body">
          {discardTotal === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <InfoIcon className="icon icon-lg" />
              </div>
              <p>{dict.discardReasonsEmpty}</p>
              <details className="mt-lg">
                <summary className="soft small">{dict.discardReferenceSummary}</summary>
                <div className="bar-track mt-md" role="img" aria-label={dict.discardReferenceAriaLabel}>
                  {DISCARD_REFERENCE_BAR.map((r) => (
                    <span key={r.reason} className={r.barClass} style={{ width: `${r.widthPct}%` }} />
                  ))}
                </div>
                <div className="legend">
                  {DISCARD_REFERENCE_BAR.map((r) => (
                    <span key={r.reason}>
                      <i className={r.barClass} />
                      {discardReasonLabel(r.reason, es)} {r.count}
                    </span>
                  ))}
                </div>
                <p className="meta mt-md">
                  {dict.discardReferenceRemainingPrefix}{" "}
                  {DISCARD_REFERENCE_REMAINING.map((r) => `${discardReasonLabel(r.reason, es)} ${r.count}`).join(" · ")}.
                </p>
              </details>
            </div>
          ) : (
            <table className="data compact">
              <thead>
                <tr>
                  <th>{dict.discardReasonsReason}</th>
                  <th className="right">{dict.discardReasonsCount}</th>
                </tr>
              </thead>
              <tbody>
                {discardRows
                  .filter((r) => r.count > 0)
                  .map((r) => (
                    <tr key={r.reason}>
                      <td>{discardReasonLabel(r.reason, es)}</td>
                      <td className="right num">{r.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid-2 mb-lg">
        <div className="card">
          <div className="card-header">
            <h3>{dict.funnelTitle}</h3>
            <span className="actions">
              <span className="meta">{dict.funnelSubtitle}</span>
            </span>
          </div>
          <div className="card-body">
            <div className="stack-sm">
              <div className="row between">
                <span>{dict.funnelNew}</span>
                <span className="num strong">{funnel.newTotal}</span>
              </div>
              <div className="bar-track">
                <span className="bar-neutral" style={{ width: "100%" }} />
              </div>
              <div className="row between mt-md">
                <span>{dict.funnelContacted}</span>
                <span className="num">
                  {funnel.contactedOrMore} <span className="soft small">({funnel.contactedPct}%)</span>
                </span>
              </div>
              <div className="bar-track">
                <span className="bar-info" style={{ width: `${funnel.contactedPct}%` }} />
              </div>
              <div className="row between mt-md">
                <span>{dict.funnelReplied}</span>
                <span className="num">
                  {funnel.repliedOrMore}{" "}
                  <span className="soft small">
                    ({funnel.repliedOfContactedPct}% {dict.funnelOfContacted})
                  </span>
                </span>
              </div>
              <div className="bar-track">
                <span className="bar-warn" style={{ width: `${funnel.repliedPct}%` }} />
              </div>
              <div className="row between mt-md">
                <span>{dict.funnelMeeting}</span>
                <span className="num">
                  {funnel.meeting}{" "}
                  <span className="soft small">
                    ({funnel.meetingOfRepliedPct}% {dict.funnelOfReplied})
                  </span>
                </span>
              </div>
              <div className="bar-track">
                <span className="bar-success" style={{ width: `${funnel.meetingPct}%` }} />
              </div>
            </div>
            <div className="card-footer meta">{dict.funnelDiscardedFoot(funnel.discarded, funnel.discardedPct)}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{dict.pipelineTitle}</h3>
            <span className="actions">
              <span className="meta">{dict.pipelineSubtitle}</span>
            </span>
          </div>
          <div className="card-body">
            <div className="stack-sm">
              {pipelineRows.map((r) => (
                <div key={r.stage} className="row between mt-md">
                  <span>
                    <span className={stageBadgeClass(r.stage === "unknown" ? null : r.stage)}>
                      {r.stage === "unknown" ? dict.stageUnknown : stageLabelOf(r.stage, es.companyList)}
                    </span>
                  </span>
                  <span className="num">
                    {r.count} <span className="soft small">({r.pct}%)</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="meta mt-md">{dict.pipelineFoot(pipelineRows.reduce((s, r) => s + r.count, 0))}</p>
          </div>
        </div>
      </div>

      <div className="card mb-lg">
        <div className="card-header">
          <h3>{dict.conversionTitle}</h3>
        </div>
        <table className="data compact">
          <thead>
            <tr>
              <th>{dict.conversionSource}</th>
              <th className="right">{dict.funnelNew}</th>
              <th className="right">{dict.funnelContacted}</th>
              <th className="right">{dict.funnelReplied}</th>
              <th className="right">{dict.funnelMeeting}</th>
            </tr>
          </thead>
          <tbody>
            {sourceRows.map((r) => (
              <tr key={r.bucket}>
                <td>{SOURCE_LABEL[r.bucket]}</td>
                <td className="right num">{r.newCount}</td>
                <td className="right num">
                  {r.contactedCount} <span className="soft small">{pctOf(r.contactedCount, r.newCount)}%</span>
                </td>
                <td className="right num">
                  {r.repliedCount} <span className="soft small">{pctOf(r.repliedCount, r.newCount)}%</span>
                </td>
                <td className="right num">{r.meetingCount}</td>
              </tr>
            ))}
            <tr>
              <td className="strong">{dict.total}</td>
              <td className="right num strong">{sourceTotal.newCount}</td>
              <td className="right num strong">{sourceTotal.contactedCount}</td>
              <td className="right num strong">{sourceTotal.repliedCount}</td>
              <td className="right num strong">{sourceTotal.meetingCount}</td>
            </tr>
          </tbody>
        </table>
        <div className="card-footer meta">{dict.conversionFoot}</div>
      </div>

      <div className="card mb-lg">
        <div className="card-header">
          <h3>{dict.activityTitle}</h3>
        </div>
        <table className="data compact">
          <thead>
            <tr>
              <th>{dict.bdColumn}</th>
              <th className="right">{dict.activityNotes}</th>
              <th className="right">{dict.activityCalls}</th>
              <th className="right">{dict.activityMeetings}</th>
              <th className="right">{dict.activityEmailsSent}</th>
              <th className="right">{dict.activityRepliesReceived}</th>
              <th className="right">{dict.activityTasksCompleted}</th>
            </tr>
          </thead>
          <tbody>
            {perBdRows.map((r) => (
              <tr key={r.bdId}>
                <td>
                  <span className="owner-chip">
                    <Avatar id={r.bdId} initials={initialsFromName(r.bdName)} variant="bd" size="sm" />
                    {r.bdName}
                  </span>
                </td>
                <td className="right num">{r.notes}</td>
                <td className="right num">{r.calls}</td>
                <td className="right num">{r.meetings}</td>
                <td className="right num">{r.emailsSent}</td>
                <td className="right num">{r.repliesReceived}</td>
                <td className="right num">{r.tasksCompleted}</td>
              </tr>
            ))}
            <tr>
              <td className="strong">{dict.total}</td>
              <td className="right num strong">{activityTotal.notes}</td>
              <td className="right num strong">{activityTotal.calls}</td>
              <td className="right num strong">{activityTotal.meetings}</td>
              <td className="right num strong">{activityTotal.emailsSent}</td>
              <td className="right num strong">{activityTotal.repliesReceived}</td>
              <td className="right num strong">{activityTotal.tasksCompleted}</td>
            </tr>
          </tbody>
        </table>
        <div className="card-footer meta">{dict.activityFoot}</div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{dict.queueTitle}</h3>
        </div>
        {hasQueueHistory ? (
          <>
            <table className="data compact">
              <thead>
                <tr>
                  <th>{dict.bdColumn}</th>
                  <th className="right">{dict.queueWorked}</th>
                  <th className="right">{dict.queuePostponed}</th>
                  <th className="right">{dict.queueSkipped}</th>
                  <th className="right">{dict.queueAssigned}</th>
                  <th>{dict.queueAdherence}</th>
                </tr>
              </thead>
              <tbody>
                {perBdRows.map((r) => (
                  <tr key={r.bdId}>
                    <td>
                      <span className="owner-chip">
                        <Avatar id={r.bdId} initials={initialsFromName(r.bdName)} variant="bd" size="sm" />
                        {r.bdName}
                      </span>
                    </td>
                    <td className="right num">{r.queue.worked}</td>
                    <td className="right num">{r.queue.postponed}</td>
                    <td className="right num">{r.queue.skipped}</td>
                    <td className="right num">{r.queue.assigned}</td>
                    <td>
                      <div className="row" style={{ gap: ".5rem" }}>
                        <div className="bar-track" style={{ width: "120px" }}>
                          <span className="bar-success" style={{ width: `${r.queue.workedPct}%` }} />
                          <span className="bar-warn" style={{ width: `${r.queue.postponedPct}%` }} />
                          <span className="bar-neutral" style={{ width: `${r.queue.skippedPct}%` }} />
                        </div>
                        <span className="mono small">{r.queue.adherencePct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="strong">{dict.total}</td>
                  <td className="right num strong">{queueTotal.worked}</td>
                  <td className="right num strong">{queueTotal.postponed}</td>
                  <td className="right num strong">{queueTotal.skipped}</td>
                  <td className="right num strong">{queueTotal.assigned}</td>
                  <td>
                    <span className="mono strong">{queueTotal.adherencePct}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="card-footer meta">{dict.queueRecentFoot}</div>
          </>
        ) : (
          <div className="card-body">
            <div className="empty">
              <div className="empty-icon">
                <InfoIcon className="icon icon-lg" />
              </div>
              <p>{dict.queueEmpty}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
