import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface OverviewLastActivity {
  relativeLabel: string;
  channelLabel: string;
  actorName: string | null;
}

export interface OverviewTouchpoints {
  linkedin: number;
  email: number;
  notes: number;
  total: number;
}

export interface OverviewTask {
  id: string;
  title: string;
  dueAt: Date | null;
  assignedToName: string | null;
}

export interface OverviewSignal {
  companyName: string;
  openItCount: number;
  newLast7Days: number;
}

export interface OverviewProps {
  labels: ContactRecordLabels;
  // Server-only formatter templates (see the comment on `contactRecordServer`
  // in dictionaries/es.ts) — Overview.tsx is a server component, so it may
  // use these directly.
  serverStrings: Dictionary["contactRecordServer"];
  lastActivity: OverviewLastActivity | null;
  touchpoints: OverviewTouchpoints;
  openTasks: OverviewTask[];
  signal: OverviewSignal | null;
}

/**
 * Resumen tab (task 9.2 placeholder -> mockup-port r06 real data;
 * contact-record.html:151-157). Server component — every stat is computed
 * from data the page already fetches for the Actividad tab/right panel, no
 * new reads beyond the two derivations in page.tsx (mostRecentActivity/
 * touchpointTotal, src/lib/contacts/recentActivity.ts).
 */
export function Overview({ labels: l, serverStrings: s, lastActivity, touchpoints, openTasks, signal }: OverviewProps) {
  return (
    <>
      <div className="grid-2 mt-xl">
        <div className="stat">
          <div className="label">{l.lastActivityStatTitle}</div>
          <div className="value">{lastActivity ? lastActivity.relativeLabel : l.emptyValue}</div>
          <div className="foot">
            {lastActivity ? s.lastActivityFoot(lastActivity.channelLabel, lastActivity.actorName ?? l.emptyValue) : l.noRecentActivity}
          </div>
        </div>
        <div className="stat">
          <div className="label">{l.touchpointsStatTitle}</div>
          <div className="value">{touchpoints.total}</div>
          <div className="foot">{s.touchpointsFoot(touchpoints.linkedin, touchpoints.email, touchpoints.notes)}</div>
        </div>
      </div>

      <div className="card mt-xl">
        <div className="card-header">
          <h3>{l.openTasksTitle}</h3>
        </div>
        <div className="card-body soft">
          {openTasks.length ? (
            openTasks.map((t) => (
              <div key={t.id}>
                {s.openTaskLine(
                  t.title,
                  t.dueAt ? format(t.dueAt, "d MMM", { locale: es }) : l.emptyValue,
                  t.assignedToName ?? l.emptyValue,
                )}
              </div>
            ))
          ) : (
            <div>{l.noOpenTasks}</div>
          )}
        </div>
      </div>

      <div className="card mt-lg">
        <div className="card-header">
          <h3>{l.signalsTitle}</h3>
        </div>
        <div className="card-body soft">
          {signal ? (
            <>
              {s.hiringSignalText(signal.companyName, signal.openItCount)}
              {signal.newLast7Days > 0 && s.hiringSignalNewLast7Days(signal.newLast7Days)}
            </>
          ) : (
            l.noSignals
          )}
        </div>
      </div>
    </>
  );
}
