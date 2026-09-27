import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import type { TimelineActivityType, TimelineEntry } from "@/lib/activity/queries";
import { TIMELINE_ACTIVITY_TYPES } from "@/lib/activity/queries";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { groupTimelineEntries, upcomingTasks } from "@/lib/contacts/timelineGrouping";
import {
  buildConnectionTimelineEntries,
  linkedinEntryAccess,
  type ConnectionForTimeline,
  type LinkedinTimelineEntryType,
} from "@/lib/contacts/connectionTimelineEntries";
import { groupEmailThreads } from "@/lib/contacts/emailThreads";
import { callWhatLabel, entryBody } from "@/lib/contacts/timelineEntryBody";
import {
  CallIcon,
  DiscardIcon,
  HistoryIcon,
  LinkedInIcon,
  LockIcon,
  MailIcon,
  MeetingIcon,
  NoteIcon,
  SearchIcon,
  TasksIcon,
} from "@/components/icons";
import { AdminConversationReveal } from "./AdminConversationReveal";
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
  // Server-only formatter templates (see the comment on `contactRecordServer`
  // in dictionaries/es.ts) — Timeline.tsx is a server component, so it may
  // receive these directly; only the composed plain-string RESULT is ever
  // passed down to a client component (AdminConversationReveal).
  serverStrings: Dictionary["contactRecordServer"];
  entries: TimelineEntry[];
  countsByType: Record<string, number>;
  activeType?: TimelineActivityType;
  openTasks: TimelineTask[];
  connections: ConnectionForTimeline[];
  viewerBdId: string;
  isAdmin: boolean;
  // "Unificado a partir de N registros" system card (mockup-port r08;
  // contact-record.html:135-138). `null`/`unifiedFromCount <= 1` when this
  // person was never the survivor of a migration/merge.
  mergeInfo: { unifiedFromCount: number; hasMergeEvent: boolean; at: Date } | null;
}

const MERGE_UNIFIED_TYPE = "merge_unified" as const;

const LINKEDIN_PREFIX_KEY: Record<LinkedinTimelineEntryType, keyof ContactRecordLabels> = {
  linkedin_replied: "linkedinRepliedPrefix",
  linkedin_sent: "linkedinSentPrefix",
};

const FILTER_LABEL_KEY: Record<TimelineActivityType, keyof ContactRecordLabels> = {
  note: "timelineFilterNote",
  email_sent: "timelineFilterEmail",
  hunter_lookup: "timelineFilterHunter",
  status_change: "timelineFilterStatusChange",
  meeting_logged: "timelineFilterMeeting",
  call: "timelineFilterCall",
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
  call: CallIcon,
  discarded: DiscardIcon,
  status_backfill: HistoryIcon,
};

const TYPE_ICON_CLASS: Partial<Record<TimelineActivityType, string>> = {
  email_sent: "email",
  status_change: "system",
  meeting_logged: "meeting",
  call: "call",
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
export function Timeline({
  personId,
  labels: l,
  serverStrings,
  entries,
  countsByType,
  activeType,
  openTasks,
  connections,
  viewerBdId,
  isAdmin,
  mergeInfo,
}: TimelineProps) {
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);
  // LinkedIn connection cards (contact-record.html:124-131) only show when
  // no activity-type filter is active — they aren't one of the 6 filter
  // pills, so a filtered view (e.g. "Correos") shouldn't include them.
  const linkedinEntries = activeType ? [] : buildConnectionTimelineEntries(connections);
  const showMergeCard = !activeType && mergeInfo && mergeInfo.unifiedFromCount > 1;

  // Email-thread grouping (contact-record.html:116-123) — done on the raw
  // `entries` BEFORE merging in the LinkedIn/merge synthetic entries, so
  // `groupEmailThreads` only ever sees real `TimelineEntry` rows (it needs
  // `.visible`, which the synthetics don't carry).
  const threaded = groupEmailThreads(entries);
  const threadGroupsById = new Map(
    threaded.filter((t) => t.kind === "thread").map((t) => [`thread-${t.group.threadId}`, t.group]),
  );
  const processedEntries = threaded.map((t) =>
    t.kind === "single"
      ? t.entry
      : {
          id: `thread-${t.group.threadId}`,
          type: "email_sent",
          createdAt: t.group.latestAt,
          metadata: { isThread: true },
          actorBdId: null,
          actorName: null,
          visible: t.group.visible,
        },
  );

  const groups = groupTimelineEntries([
    ...processedEntries,
    ...linkedinEntries.map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt, metadata: e.metadata })),
    ...(showMergeCard
      ? [{ id: "merge-unified", type: MERGE_UNIFIED_TYPE, createdAt: mergeInfo!.at, metadata: null }]
      : []),
  ]);
  const upcoming = upcomingTasks(openTasks);
  const linkedinMetaById = new Map(linkedinEntries.map((e) => [e.id, e.metadata]));

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
              {group.items.map(({ entry, at }) => {
                if (entry.type === MERGE_UNIFIED_TYPE) {
                  return (
                    <div key={entry.id} className="tl-item">
                      <div className="tl-icon system">
                        <HistoryIcon className="icon" />
                      </div>
                      <div className="tl-card system">
                        <div className="tl-head">
                          <span className="what">{l.mergeCardWhat}</span>
                          <span className="when">{formatWhen(at)}</span>
                        </div>
                        <div className="tl-body">
                          {serverStrings.mergeCardBody(mergeInfo!.unifiedFromCount)}
                          {isAdmin && mergeInfo!.hasMergeEvent && (
                            <div className="row mt-lg">
                              <Link href="/admin/duplicates#history" className="btn btn-secondary btn-sm">
                                {l.reviewMergeAction}
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                const threadGroup = threadGroupsById.get(entry.id);
                if (threadGroup) {
                  return (
                    <div key={entry.id} className="tl-item">
                      <div className="tl-icon email">
                        <MailIcon className="icon" />
                      </div>
                      <div className="tl-card">
                        <div className="tl-head">
                          <span className="what">{l.timelineFilterEmail}</span>
                          <span className="badge badge-info no-dot">
                            {threadGroup.messages.length} {l.timelineFilterEmail.toLowerCase()}
                          </span>
                          <span className="when">{formatWhen(threadGroup.latestAt)}</span>
                        </div>
                        {threadGroup.visible ? (
                          <div className="thread">
                            {threadGroup.messages.map((m) => (
                              <div key={m.id} className="thread-msg">
                                <div>
                                  <span className="from">{m.actorName ?? l.timelineSystemActor}</span>
                                  <div className="snippet">{entryBody(m, l)}</div>
                                </div>
                                <span className="meta">{format(m.createdAt, "d MMM", { locale: es })}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="locked">
                            <LockIcon className="icon" />
                            <span>{l.timelineLockedContent}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                const linkedinMeta = linkedinMetaById.get(entry.id);
                if (linkedinMeta) {
                  const type = entry.type as LinkedinTimelineEntryType;
                  const access = linkedinEntryAccess(linkedinMeta.bdId, viewerBdId, isAdmin);
                  const bdName = linkedinMeta.bdName ?? l.emptyValue;
                  return (
                    <div key={entry.id} className="tl-item">
                      <div className={type === "linkedin_replied" ? "tl-icon reply" : "tl-icon"}>
                        <LinkedInIcon className="icon" />
                      </div>
                      <div className="tl-card">
                        <div className="tl-head">
                          <span className="what">
                            {l[LINKEDIN_PREFIX_KEY[type]] as string} · {l.linkedinConversationOfPrefix} {bdName}
                          </span>
                          <span className="when">{formatWhen(at)}</span>
                        </div>
                        {access === "admin-bypass" ? (
                          <AdminConversationReveal
                            personId={personId}
                            bdId={linkedinMeta.bdId}
                            auditAlertBody={serverStrings.adminAuditAlertBody(bdName)}
                            labels={l}
                          />
                        ) : access === "locked" ? (
                          <div className="locked">
                            <LockIcon className="icon" />
                            <span>{serverStrings.timelineLockedOwnedBy(bdName)}</span>
                          </div>
                        ) : (
                          <div className="tl-body">{l.connectionHistorySomePrefix}</div>
                        )}
                      </div>
                    </div>
                  );
                }

                const timelineEntry = entry as TimelineEntry;
                const Icon = TYPE_ICON[timelineEntry.type as TimelineActivityType] ?? NoteIcon;
                const iconClass = TYPE_ICON_CLASS[timelineEntry.type as TimelineActivityType];
                return (
                  <div key={timelineEntry.id} className="tl-item">
                    <div className={iconClass ? `tl-icon ${iconClass}` : "tl-icon"}>
                      <Icon className="icon" />
                    </div>
                    <div className={iconClass === "system" ? "tl-card system" : "tl-card"}>
                      <div className="tl-head">
                        <span className="what">
                          {timelineEntry.type === "call" ? (
                            callWhatLabel(timelineEntry.metadata ?? {}, l)
                          ) : (
                            <>
                              {l[FILTER_LABEL_KEY[timelineEntry.type as TimelineActivityType]] as string} ·{" "}
                              {timelineEntry.actorName ?? l.timelineSystemActor}
                            </>
                          )}
                        </span>
                        <span className="when">{formatWhen(at)}</span>
                      </div>
                      <div className={timelineEntry.visible ? "tl-body" : "locked"}>
                        {timelineEntry.type === "note" && timelineEntry.visible ? (
                          <blockquote>{entryBody(timelineEntry, l)}</blockquote>
                        ) : (
                          entryBody(timelineEntry, l)
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
