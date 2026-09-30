"use client";

import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { KpiDrilldownCard } from "./KpiDrilldownCard";
import { getMeetingsDrilldownAction } from "./actions";
import type { MeetingDrilldownRow } from "@/lib/reports/meetingsDrilldown";
import { es as esDict } from "@/lib/i18n/dictionaries/es";

const dict = esDict.reports;

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
}: {
  value: number;
  foot: React.ReactNode;
  fromIso: string;
  toIso: string;
  bdId: string | null;
}) {
  return (
    <KpiDrilldownCard<MeetingDrilldownRow>
      toneClass="success"
      label={dict.kpiMeetings}
      value={value}
      foot={foot}
      dialogTitle={dict.meetingsDialogTitle}
      closeLabel={dict.dialogClose}
      loadingLabel={dict.dialogLoading}
      errorLabel={dict.dialogError}
      fetchRows={() => getMeetingsDrilldownAction({ fromIso, toIso, bdId })}
      renderList={(rows) =>
        rows.length === 0 ? (
          <p className="meta">{dict.meetingsDialogEmpty}</p>
        ) : (
          <table className="data compact">
            <thead>
              <tr>
                <th>{dict.meetingsDialogColContact}</th>
                <th>{dict.meetingsDialogColCompany}</th>
                <th>{dict.meetingsDialogColBd}</th>
                <th className="right">{dict.meetingsDialogColDate}</th>
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
