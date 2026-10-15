"use client";

import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronRightIcon } from "@/components/icons";
import { KpiDrilldownCard, DrilldownDialog, useDrilldown } from "./KpiDrilldownCard";
import { getCohortDrilldownAction } from "./actions";
import { drilldownCacheKey } from "@/lib/reports/drilldownCacheKey";
import { cohortHasReplyColumns, contactSubline, type CohortPopulation, type CohortRow } from "@/lib/reports/cohortDrilldown";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";

// ClientStrings-wrapped, same reasoning as MeetingsKpiCard.tsx: plain strings
// only cross the server -> client boundary. Header text and aria labels are
// built server-side (they use dictionary formatters) and arrive as props.
export type CohortDrilldownLabels = ClientStrings<
  Pick<
    Dictionary["reports"],
    | "kpiNewContacts"
    | "funnelContacted"
    | "funnelReplied"
    | "funnelMeeting"
    | "cohortColContact"
    | "cohortColCompany"
    | "cohortColBd"
    | "cohortRoleUnclassified"
    | "cohortRoleUnclassifiedHint"
    | "cohortColStatus"
    | "cohortColCreated"
    | "cohortColReplyAt"
    | "cohortColSequence"
    | "cohortEmptyNew"
    | "cohortEmptyContacted"
    | "cohortEmptyReplied"
    | "cohortEmptyMeeting"
    | "dialogClose"
    | "dialogLoading"
    | "dialogError"
    | "dialogTruncated"
    | "numberLocale"
  >
> & { leadStatuses: Dictionary["leadStatuses"]; roleGroups: Dictionary["roleGroups"] };

interface CohortQuery {
  population: CohortPopulation;
  fromIso: string;
  toIso: string;
  bdId: string | null;
  /** Header text, built server-side by cohortHeaderLines. */
  summary: string;
  note: string;
  labels: CohortDrilldownLabels;
}

const TITLE_KEY = { new: "kpiNewContacts", contacted: "funnelContacted", replied: "funnelReplied", meeting: "funnelMeeting" } as const;
const EMPTY_KEY = { new: "cohortEmptyNew", contacted: "cohortEmptyContacted", replied: "cohortEmptyReplied", meeting: "cohortEmptyMeeting" } as const;

function CohortSubtitle({ summary, note }: { summary: string; note: string }) {
  return (
    <>
      {summary}
      <br />
      {note}
    </>
  );
}

const dash = <span className="meta">—</span>;

/**
 * Muted second line of the Contacto cell, `title · group`, same in every
 * population (no per-population column). The title is clamped to one line with
 * an ellipsis; the group sits in its own non-shrinking span so a long title can
 * never cut it off. Nothing is rendered when there is nothing to say.
 */
function ContactSubline({ jobTitle, roleGroup, l }: { jobTitle: string | null; roleGroup: string | null; l: CohortDrilldownLabels }) {
  const line = contactSubline(jobTitle, roleGroup, l.roleGroups);
  if (!line) return null;
  const group = line.group.kind === "group" ? line.group.label : l.cohortRoleUnclassified;
  return (
    <span className="cell-sub cell-sub-split" title={[line.title, group].filter(Boolean).join(" · ")}>
      {line.title && <span className="clamp">{line.title}</span>}
      {line.title && <span aria-hidden="true">·</span>}
      <span className="group" title={line.group.kind === "unclassified" ? l.cohortRoleUnclassifiedHint : undefined}>
        {group}
      </span>
    </span>
  );
}

function CohortRowsTable({ population, rows, labels: l }: { population: CohortPopulation; rows: CohortRow[]; labels: CohortDrilldownLabels }) {
  if (rows.length === 0) return <p className="meta">{l[EMPTY_KEY[population]]}</p>;
  const withReply = cohortHasReplyColumns(population);
  return (
    <table className="data compact">
      <thead>
        <tr>
          <th>{l.cohortColContact}</th>
          <th>{l.cohortColCompany}</th>
          <th>{l.cohortColBd}</th>
          <th>{l.cohortColStatus}</th>
          <th>{l.cohortColCreated}</th>
          {withReply && <th>{l.cohortColReplyAt}</th>}
          {withReply && <th>{l.cohortColSequence}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.personId}>
            <td>
              <Link href={`/contacts/${row.personId}`}>{row.personName}</Link>
              <ContactSubline jobTitle={row.jobTitle} roleGroup={row.roleGroup} l={l} />
            </td>
            <td>{row.companyName ?? "—"}</td>
            <td>{row.ownerBdName ?? "—"}</td>
            <td>
              <span className={statusBadgeClass(row.status)}>{l.leadStatuses[row.status as keyof typeof l.leadStatuses] ?? row.status}</span>
            </td>
            <td className="num">
              <span className="nowrap">{format(row.createdAt, "d MMM yyyy", { locale: es })}</span>
            </td>
            {withReply && (
              <td className="num">
                {row.replyAt ? (
                  <>
                    <span className="nowrap">{format(row.replyAt, "d MMM yyyy", { locale: es })}</span>
                    <span className="cell-sub">{format(row.replyAt, "HH:mm")}</span>
                  </>
                ) : (
                  dash
                )}
              </td>
            )}
            {withReply && <td className="small">{row.sequenceName ?? dash}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function useCohortList({ population, fromIso, toIso, bdId }: CohortQuery) {
  return useDrilldown<CohortRow>(drilldownCacheKey({ kind: population, fromIso, toIso, bdId }), () => getCohortDrilldownAction({ population, fromIso, toIso, bdId }));
}

function CohortDialog({
  query,
  count,
  drilldown,
}: {
  query: CohortQuery;
  count: number;
  drilldown: ReturnType<typeof useCohortList>;
}) {
  const l = query.labels;
  return (
    <DrilldownDialog
      state={drilldown.state}
      onClose={drilldown.close}
      title={l[TITLE_KEY[query.population]]}
      subtitle={<CohortSubtitle summary={query.summary} note={query.note} />}
      xwide
      total={count}
      truncation={{ template: l.dialogTruncated, numberLocale: l.numberLocale }}
      closeLabel={l.dialogClose}
      loadingLabel={l.dialogLoading}
      errorLabel={l.dialogError}
      renderList={(rows) => <CohortRowsTable population={query.population} rows={rows} labels={l} />}
    />
  );
}

/**
 * KPI tile that opens a cohort list via the shared KpiDrilldownCard:
 * "Tasa de respuesta" (replied — the rate's numerator) and "Contactos nuevos"
 * (new — the whole cohort). `count` (not the displayed "28%"/"3 / 7") decides
 * clickability.
 */
export function CohortTile({
  toneClass,
  label,
  count,
  displayValue,
  foot,
  ...query
}: CohortQuery & {
  toneClass: string;
  label: string;
  count: number;
  displayValue?: string;
  foot: React.ReactNode;
}) {
  const l = query.labels;
  return (
    <KpiDrilldownCard<CohortRow>
      toneClass={toneClass}
      label={label}
      value={count}
      displayValue={displayValue}
      foot={foot}
      dialogTitle={l[TITLE_KEY[query.population]]}
      dialogSubtitle={<CohortSubtitle summary={query.summary} note={query.note} />}
      xwide
      truncation={{ template: l.dialogTruncated, numberLocale: l.numberLocale }}
      closeLabel={l.dialogClose}
      loadingLabel={l.dialogLoading}
      errorLabel={l.dialogError}
      cacheKey={drilldownCacheKey({ kind: query.population, fromIso: query.fromIso, toIso: query.toIso, bdId: query.bdId })}
      fetchRows={() => getCohortDrilldownAction({ population: query.population, fromIso: query.fromIso, toIso: query.toIso, bdId: query.bdId })}
      renderList={(rows) => <CohortRowsTable population={query.population} rows={rows} labels={l} />}
    />
  );
}

/**
 * Funnel row for Contactado / Respondió / Reunión. Clickable from a count of
 * 1 (dotted underline + chevron, there is no hover precedent on this card);
 * at 0 it renders as a static row that reserves the chevron's width.
 */
export function CohortFunnelRow({
  count,
  label,
  detail,
  ariaLabel,
  ...query
}: CohortQuery & { count: number; label: string; detail: React.ReactNode; ariaLabel: string }) {
  const drilldown = useCohortList(query);
  if (count < 1) {
    return (
      <div className="row between mt-md funnel-static">
        <span>{label}</span>
        <span className="num">
          {count} {detail}
        </span>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="funnel-live mt-md" aria-label={ariaLabel} onClick={drilldown.openDialog}>
        <span>{label}</span>
        <span className="right-side">
          <span className="num">
            <span className="live-count">{count}</span> {detail}
          </span>
          <ChevronRightIcon className="icon chev" />
        </span>
      </button>
      {drilldown.open && <CohortDialog query={query} count={count} drilldown={drilldown} />}
    </>
  );
}
