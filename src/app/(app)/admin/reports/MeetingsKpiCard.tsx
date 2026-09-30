"use client";

import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { KpiDrilldownCard } from "./KpiDrilldownCard";
import { getMeetingsDrilldownAction } from "./actions";
import type { MeetingDrilldownRow } from "@/lib/reports/meetingsDrilldown";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";

// ClientStrings-wrapped — see WonCompaniesKpiCard.tsx's matching doc
// comment for the "why" (review fix: no raw dictionary module import at
// client module scope).
export type MeetingsKpiCardLabels = ClientStrings<
  Pick<
    Dictionary["reports"],
    | "kpiMeetings"
    | "meetingsDialogTitle"
    | "meetingsDialogColContact"
    | "meetingsDialogColCompany"
    | "meetingsDialogColBd"
    | "meetingsDialogColDate"
    | "meetingsDialogEmpty"
    | "dialogClose"
    | "dialogLoading"
    | "dialogError"
  >
>;

/**
 * "Reuniones agendadas" KPI (reports-bd-filter-drilldown, owner request):
 * clickable once its value is >= 1, opening a Dialog with the meetings
 * logged in the selected period — actor-scoped (`activity.actor_bd_id`),
 * matching "Actividad por BD"'s own "Reuniones" column, NOT the "Embudo de
 * contactos" card's owner-scoped "Reunión" row. See
 * src/lib/reports/meetingsDrilldown.ts's doc comment.
 */
export function MeetingsKpiCard({
  value,
  foot,
  fromIso,
  toIso,
  bdId,
  labels: l,
}: {
  value: number;
  foot: React.ReactNode;
  fromIso: string;
  toIso: string;
  bdId: string | null;
  labels: MeetingsKpiCardLabels;
}) {
  return (
    <KpiDrilldownCard<MeetingDrilldownRow>
      toneClass="success"
      label={l.kpiMeetings}
      value={value}
      foot={foot}
      dialogTitle={l.meetingsDialogTitle}
      closeLabel={l.dialogClose}
      loadingLabel={l.dialogLoading}
      errorLabel={l.dialogError}
      fetchRows={() => getMeetingsDrilldownAction({ fromIso, toIso, bdId })}
      renderList={(rows) =>
        rows.length === 0 ? (
          <p className="meta">{l.meetingsDialogEmpty}</p>
        ) : (
          <table className="data compact">
            <thead>
              <tr>
                <th>{l.meetingsDialogColContact}</th>
                <th>{l.meetingsDialogColCompany}</th>
                <th>{l.meetingsDialogColBd}</th>
                <th className="right">{l.meetingsDialogColDate}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.activityId}>
                  <td>
                    <Link href={`/contacts/${row.personId}`}>{row.personName}</Link>
                  </td>
                  <td>{row.companyName ?? "—"}</td>
                  <td>{row.bdName ?? "—"}</td>
                  <td className="right num">{format(row.meetingAt, "d MMM yyyy, HH:mm", { locale: es })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    />
  );
}
