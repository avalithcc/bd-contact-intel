import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import type { CompanyTimelineRow } from "@/lib/companies/recordQueries";
import { filterTimelineRows, type CompanyActivityFilter } from "@/lib/companies/recordMappers";
import { groupTimelineEntries } from "@/lib/contacts/timelineGrouping";
import { MailIcon, HistoryIcon, NoteIcon, MeetingIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface CompanyTimelineLabels {
  timelineFilterAll: string;
  timelineFilterNote: string;
  timelineFilterStageChange: string;
  timelineFilterContactActivity: string;
  timelineEmpty: string;
  meetingLogged: string;
  atNote: string;
  atEmailSent: string;
  atStatusChange: string;
  atMeetingLogged: string;
  atCall: string;
  atDiscarded: string;
  atHunterLookup: string;
  atStatusBackfill: string;
}

const FILTERS: CompanyActivityFilter[] = ["all", "note", "stage_change", "contact_activity"];

function filterHref(companyKey: string, filter: CompanyActivityFilter): string {
  const encoded = encodeURIComponent(companyKey);
  return filter === "all" ? `/companies/${encoded}#activity` : `/companies/${encoded}?activityFilter=${filter}#activity`;
}

function filterLabel(l: CompanyTimelineLabels, filter: CompanyActivityFilter): string {
  switch (filter) {
    case "all":
      return l.timelineFilterAll;
    case "note":
      return l.timelineFilterNote;
    case "stage_change":
      return l.timelineFilterStageChange;
    case "contact_activity":
      return l.timelineFilterContactActivity;
  }
}

function typeLabel(l: CompanyTimelineLabels, type: string): string {
  switch (type) {
    case "note":
      return l.atNote;
    case "email_sent":
      return l.atEmailSent;
    case "status_change":
    case "status_backfill":
      return type === "status_backfill" ? l.atStatusBackfill : l.atStatusChange;
    case "meeting_logged":
      return l.atMeetingLogged;
    case "call":
      return l.atCall;
    case "discarded":
      return l.atDiscarded;
    case "hunter_lookup":
      return l.atHunterLookup;
    default:
      return type;
  }
}

const TYPE_ICON: Record<string, (props: { className?: string }) => React.ReactElement> = {
  note: NoteIcon,
  email_sent: MailIcon,
  status_change: HistoryIcon,
  status_backfill: HistoryIcon,
  meeting_logged: MeetingIcon,
};

function formatWhen(at: Date): string {
  return format(at, "d MMM, HH:mm", { locale: es });
}

/**
 * Activity tab (mockup-port c03; company-record.html:78-83). A dedicated,
 * simpler component rather than a literal reuse of the Contact record's
 * `Timeline.tsx`: that component carries person-only machinery (LinkedIn
 * connection cards, email-thread grouping, admin conversation reveal, merge
 * cards) that doesn't apply to a company. It DOES reuse the shared, generic
 * `groupTimelineEntries` (month bucketing) — the one piece of that module
 * that's subject-agnostic.
 */
export function CompanyTimeline({
  companyKey,
  rows,
  activeFilter,
  labels: l,
  serverStrings,
  stageLabelOf,
}: {
  companyKey: string;
  rows: CompanyTimelineRow[];
  activeFilter: CompanyActivityFilter;
  labels: CompanyTimelineLabels;
  serverStrings: Dictionary["companyRecordServer"];
  /** Maps a raw `relationship_stage` value (e.g. "qualified") to its
   * localized label (e.g. "Calificada") — reuses the same map `/companies`
   * and the About pane use, so a stage is never labeled two different ways
   * on the same page. */
  stageLabelOf: (stage: string) => string;
}) {
  const filtered = filterTimelineRows(rows, activeFilter);
  const groups = groupTimelineEntries(
    filtered.map((r) => ({ id: r.id, type: r.type, createdAt: r.createdAt, metadata: r.metadata })),
  );

  return (
    <div id="activity">
      <div className="timeline-toolbar" role="group" aria-label={l.timelineFilterAll}>
        {FILTERS.map((filter) => (
          <Link
            key={filter}
            href={filterHref(companyKey, filter)}
            className={activeFilter === filter ? "filter-pill on" : "filter-pill"}
          >
            {filterLabel(l, filter)}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="muted">{l.timelineEmpty}</p>
      ) : (
        groups.map((group, i) => (
          <div key={`${group.kind}-${group.monthKey}-${i}`}>
            <div className="tl-group">
              {group.kind === "pre-migration"
                ? l.timelineFilterAll
                : format(group.items[0].at, "MMMM yyyy", { locale: es })}
            </div>
            <div className="tl">
              {group.items.map(({ entry, at }) => {
                const row = filtered.find((r) => r.id === entry.id)!;
                const Icon = TYPE_ICON[entry.type] ?? NoteIcon;
                const metadata = entry.metadata ?? {};
                let what: string;
                if (row.scope === "company") {
                  if (entry.type === "note") what = serverStrings.noteBy(row.actorName ?? "");
                  else if (entry.type === "email_sent")
                    what = serverStrings.emailSentTo(typeof metadata.to === "string" ? metadata.to : "");
                  else if (entry.type === "status_change") {
                    const from = typeof metadata.from === "string" ? stageLabelOf(metadata.from) : "";
                    const to = typeof metadata.status === "string" ? stageLabelOf(metadata.status) : "";
                    what = serverStrings.stageChanged(from, to);
                  } else if (entry.type === "meeting_logged") what = l.meetingLogged;
                  else what = typeLabel(l, entry.type);
                } else {
                  what = row.personName ? `${typeLabel(l, entry.type)} · ${row.personName}` : typeLabel(l, entry.type);
                }
                const body = entry.type === "note" && typeof metadata.note === "string" ? metadata.note : null;
                return (
                  <div key={entry.id} className="tl-item">
                    <div className="tl-icon">
                      <Icon className="icon" />
                    </div>
                    <div className="tl-card">
                      <div className="tl-head">
                        <span className="what">
                          {row.scope === "contact" && row.personId ? (
                            <Link href={`/contacts/${row.personId}`}>{what}</Link>
                          ) : (
                            what
                          )}
                        </span>
                        <span className="when">{formatWhen(at)}</span>
                      </div>
                      {body && (
                        <div className="tl-body">
                          <blockquote>{body}</blockquote>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
