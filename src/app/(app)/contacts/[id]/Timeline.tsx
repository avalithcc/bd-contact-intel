import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import type { TimelineActivityType, TimelineEntry } from "@/lib/activity/queries";
import { TIMELINE_ACTIVITY_TYPES } from "@/lib/activity/queries";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { groupTimelineEntries, upcomingTasks } from "@/lib/contacts/timelineGrouping";
import {
  DiscardIcon,
  HistoryIcon,
  MailIcon,
  MeetingIcon,
  NoteIcon,
  SearchIcon,
  TasksIcon,
} from "@/components/icons";
import { CompleteTaskButton } from "./CompleteTaskButton";
import { NoteComposer } from "./NoteComposer";
import styles from "./page.module.css";

export interface TimelineTask {
  id: string;
  title: string;
  dueAt: Date | null;
  assignedToName: string | null;
}

export interface TimelineProps {
  personId: string;
  labels: ContactRecordLabels;
  entries: TimelineEntry[];
  countsByType: Record<string, number>;
  activeType?: TimelineActivityType;
  openTasks: TimelineTask[];
}

const FILTER_LABEL_KEY: Record<TimelineActivityType, keyof ContactRecordLabels> = {
  note: "timelineFilterNote",
  email_sent: "timelineFilterEmail",
  hunter_lookup: "timelineFilterHunter",
  status_change: "timelineFilterStatusChange",
  meeting_logged: "timelineFilterMeeting",
  discarded: "timelineFilterDiscarded",
  status_backfill: "timelineFilterStatusBackfill",
};

// contact-record.html's `.tl-icon`/`.tl-icon.{modifier}` per activity type
// (mockup-port r03). `note`/`hunter_lookup` render the plain (unmodified)
// icon circle, matching the mockup's markup for both.
const TYPE_ICON: Record<TimelineActivityType, (props: { className?: string }) => React.ReactElement> = {
  note: NoteIcon,
  email_sent: MailIcon,
  hunter_lookup: SearchIcon,
  status_change: HistoryIcon,
  meeting_logged: MeetingIcon,
  discarded: DiscardIcon,
  status_backfill: HistoryIcon,
};

const TYPE_ICON_CLASS: Partial<Record<TimelineActivityType, string>> = {
  email_sent: "email",
  status_change: "system",
  meeting_logged: "meeting",
  discarded: "discard",
  status_backfill: "system",
};

function filterHref(personId: string, type?: TimelineActivityType): string {
  return type ? `/contacts/${personId}?activityType=${type}#activity` : `/contacts/${personId}#activity`;
}

function formatWhen(at: Date): string {
  return format(at, "d MMM, HH:mm", { locale: es });
}

function monthLabel(at: Date): string {
  const label = format(at, "MMMM yyyy", { locale: es });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function entryBody(entry: TimelineEntry, l: ContactRecordLabels): string {
  if (!entry.visible) return l.timelineLockedContent;
  const metadata = entry.metadata ?? {};
  switch (entry.type) {
    case "note":
      return typeof metadata.note === "string" ? metadata.note : "";
    case "email_sent":
      return typeof metadata.to === "string" ? `${l.timelineEmailSentPrefix} ${metadata.to}` : l.timelineEmailSentPrefix;
    case "hunter_lookup":
      return typeof metadata.hunterScore === "number"
        ? `${l.timelineHunterPrefix} · ${metadata.hunterScore}`
        : l.timelineHunterPrefix;
    case "status_change": {
      const status = typeof metadata.status === "string" ? metadata.status : null;
      const label = status ? (l.leadStatuses[status as keyof typeof l.leadStatuses] ?? status) : "";
      return `${l.timelineStatusChangedPrefix} ${label}`;
    }
    case "status_backfill": {
      const status = typeof metadata.status === "string" ? metadata.status : null;
      const label = status ? (l.leadStatuses[status as keyof typeof l.leadStatuses] ?? status) : "";
      return `${l.timelineStatusBackfillPrefix} ${label}`;
    }
    case "meeting_logged":
      return typeof metadata.notes === "string" && metadata.notes ? metadata.notes : l.timelineMeetingLoggedDefault;
    case "discarded": {
      const reason = typeof metadata.reason === "string" ? metadata.reason : null;
      const note = typeof metadata.note === "string" ? metadata.note : null;
      return [reason, note].filter(Boolean).join(" · ") || l.timelineDiscardedDefault;
    }
    default:
      return "";
  }
}

/**
 * Filtered activity timeline (task 10.1; contact-record spec "Filtered
 * activity timeline"; mockup-port r03 markup rework onto design-system.css's
 * `.filter-pill`/`.tl-group`/`.tl`/`.tl-item`/`.tl-icon`/`.tl-card` classes,
 * plus contact-record.html:107-149's date grouping — see
 * groupTimelineEntries, src/lib/contacts/timelineGrouping.ts). Server
 * component — filtering is a plain link to `?activityType=`, so the page
 * re-fetches server-side instead of shipping client JS for it.
 * `entry.metadata === null` (isTimelineEntryVisible said no, design R6)
 * always renders the locked marker regardless of type.
 */
export function Timeline({ personId, labels: l, entries, countsByType, activeType, openTasks }: TimelineProps) {
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);
  const groups = groupTimelineEntries(entries);
  const upcoming = upcomingTasks(openTasks);

  return (
    <div>
      <div className="timeline-toolbar" role="group" aria-label={l.timelineFilterGroupLabel}>
        <Link href={filterHref(personId)} className={activeType ? "filter-pill" : "filter-pill on"}>
          {l.timelineFilterAll} <span className="n">{total}</span>
        </Link>
        {TIMELINE_ACTIVITY_TYPES.map((type) => {
          const Icon = TYPE_ICON[type];
          return (
            <Link
              key={type}
              href={filterHref(personId, type)}
              className={activeType === type ? "filter-pill on" : "filter-pill"}
            >
              <Icon className="icon" />
              {l[FILTER_LABEL_KEY[type]] as string} <span className="n">{countsByType[type] ?? 0}</span>
            </Link>
          );
        })}
        <span className="grow" />
        {/* Static — the record's timeline has exactly one sort order today
            (newest-first per bucket); no toggle exists to switch it, same as
            the static mockup shows no alternate state either. */}
        <button type="button" className="btn btn-ghost btn-sm" disabled>
          {l.timelineSortNewestFirst}
        </button>
      </div>

      <NoteComposer personId={personId} labels={l} />

      {upcoming.length > 0 && (
        <>
          <div className="tl-group">{l.timelineGroupUpcoming}</div>
          <div className="tl">
            {upcoming.map((t) => (
              <div key={t.id} className="tl-item">
                <div className="tl-icon">
                  <TasksIcon className="icon" />
                </div>
                <div className="tl-card">
                  <div className="tl-head">
                    <span className="what">{t.title}</span>
                    {t.dueAt && (
                      <span className="badge badge-warn no-dot">
                        {l.taskDueBadgePrefix} {format(t.dueAt, "d MMM", { locale: es })}
                      </span>
                    )}
                    {t.assignedToName && (
                      <span className="when">
                        {l.timelineAssignedToPrefix} {t.assignedToName}
                      </span>
                    )}
                  </div>
                  <div className="row mt-lg">
                    <CompleteTaskButton
                      taskId={t.id}
                      personId={personId}
                      label={l.taskMarkDone}
                      errorLabel={l.genericError}
                    />
                    {/* Mockup itself has no wired destination for
                        "Reprogramar" (contact-record.html:111) — kept inert
                        rather than inventing an unspec'd reschedule flow. */}
                    <button type="button" className="btn btn-ghost btn-sm" disabled>
                      {l.taskReschedule}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {entries.length === 0 && upcoming.length === 0 ? (
        <div className={styles.placeholder}>{l.timelineEmpty}</div>
      ) : (
        groups.map((group, i) => (
          <div key={`${group.kind}-${group.monthKey}-${i}`}>
            <div className="tl-group">
              {group.kind === "pre-migration" ? l.timelineGroupPreMigration : monthLabel(group.items[0].at)}
            </div>
            <div className="tl">
              {group.items.map(({ entry }) => {
                const Icon = TYPE_ICON[entry.type as TimelineActivityType] ?? NoteIcon;
                const iconClass = TYPE_ICON_CLASS[entry.type as TimelineActivityType];
                return (
                  <div key={entry.id} className="tl-item">
                    <div className={iconClass ? `tl-icon ${iconClass}` : "tl-icon"}>
                      <Icon className="icon" />
                    </div>
                    <div className={iconClass === "system" ? "tl-card system" : "tl-card"}>
                      <div className="tl-head">
                        <span className="what">
                          {l[FILTER_LABEL_KEY[entry.type as TimelineActivityType]] as string} ·{" "}
                          {entry.actorName ?? l.timelineSystemActor}
                        </span>
                        <span className="when">{formatWhen(entry.createdAt)}</span>
                      </div>
                      <div className={entry.visible ? "tl-body" : "locked"}>
                        {entry.type === "note" && entry.visible ? (
                          <blockquote>{entryBody(entry, l)}</blockquote>
                        ) : (
                          entryBody(entry, l)
                        )}
                      </div>
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
