import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { TimelineActivityType, TimelineEntry } from "@/lib/activity/queries";
import { TIMELINE_ACTIVITY_TYPES } from "@/lib/activity/queries";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import styles from "./page.module.css";

export interface TimelineProps {
  personId: string;
  labels: ContactRecordLabels;
  entries: TimelineEntry[];
  countsByType: Record<string, number>;
  activeType?: TimelineActivityType;
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

function filterHref(personId: string, type?: TimelineActivityType): string {
  return type ? `/contacts/${personId}?activityType=${type}#activity` : `/contacts/${personId}#activity`;
}

function formatWhen(at: Date): string {
  return format(at, "d MMM, HH:mm", { locale: es });
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
 * activity timeline"). Server component — filtering is a plain link to
 * `?activityType=`, so the page re-fetches server-side instead of shipping
 * client JS for it. `entry.metadata === null` (isTimelineEntryVisible said
 * no, design R6) always renders the locked marker regardless of type.
 */
export function Timeline({ personId, labels: l, entries, countsByType, activeType }: TimelineProps) {
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <div className={styles.filterBar} role="group" aria-label={l.timelineFilterGroupLabel}>
        <Link
          href={filterHref(personId)}
          className={activeType ? styles.filterChip : styles.filterChipActive}
        >
          {l.timelineFilterAll} <span>{total}</span>
        </Link>
        {TIMELINE_ACTIVITY_TYPES.map((type) => (
          <Link
            key={type}
            href={filterHref(personId, type)}
            className={activeType === type ? styles.filterChipActive : styles.filterChip}
          >
            {l[FILTER_LABEL_KEY[type]] as string} <span>{countsByType[type] ?? 0}</span>
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className={styles.placeholder}>{l.timelineEmpty}</div>
      ) : (
        <div className={styles.timeline}>
          {entries.map((entry) => (
            <div key={entry.id} className={styles.timelineItem}>
              <div className={styles.timelineHead}>
                <span>{l[FILTER_LABEL_KEY[entry.type as TimelineActivityType]] as string} · {entry.actorName ?? l.timelineSystemActor}</span>
                <span className={styles.timelineWhen}>{formatWhen(entry.createdAt)}</span>
              </div>
              <div className={entry.visible ? styles.timelineBody : styles.timelineLocked}>
                {entryBody(entry, l)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
