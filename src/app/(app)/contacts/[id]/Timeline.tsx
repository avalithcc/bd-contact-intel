"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import type { TimelineActivityType, TimelineEntry } from "@/lib/activity/queries";
import {
  TIMELINE_PILL_KEYS,
  sumPillCount,
  filterEntriesForPill,
  isPillSelectionComplete,
  type TimelinePillKey,
} from "@/lib/activity/timelinePills";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { groupTimelineEntries, upcomingTasks } from "@/lib/contacts/timelineGrouping";
import { groupEmailThreads } from "@/lib/contacts/emailThreads";
import { callWhatLabel, entryBody } from "@/lib/contacts/timelineEntryBody";
import { useToast } from "@/components/ToastProvider";
import {
  CallIcon,
  DiscardIcon,
  HistoryIcon,
  LockIcon,
  MailIcon,
  MeetingIcon,
  NoteIcon,
  SearchIcon,
  TasksIcon,
} from "@/components/icons";
import { CompleteTaskButton } from "./CompleteTaskButton";
import { NoteComposer } from "./NoteComposer";
import { getTimelinePillEntriesAction } from "../actions";
import styles from "./page.module.css";

export interface TimelineTask {
  id: string;
  title: string;
  dueAt: Date | null;
  assignedToName: string | null;
}

// NOTE: LinkedIn is hidden here on purpose — the owner turned LinkedIn
// ingestion off (see chore/hide-linkedin-imports). `connections`
// (ConnectionForTimeline[]) and `viewerBdId` used to be TimelineProps,
// feeding `buildConnectionTimelineEntries`/`linkedinEntryAccess`
// (src/lib/contacts/connectionTimelineEntries.ts) to synthesize the
// "Mensaje de LinkedIn enviado"/"Respuesta de LinkedIn recibida" cards
// (contact-record.html:124-131) and gate `AdminConversationReveal`
// (./AdminConversationReveal.tsx). All of that is untouched in the DB and
// in connectionTimelineEntries.ts; to restore, re-add both props here and
// in page.tsx's <Timeline connections={record.connections}
// viewerBdId={me.id} />, then bring back the imports/const/render branch
// this file used to have (see git history).
export interface TimelineProps {
  personId: string;
  labels: ContactRecordLabels;
  // Server-fetched initial page for `activePill` (or the unfiltered "Todo"
  // page when `activePill` is undefined) — see the "Instant pill filtering"
  // comment on the component below for how this seeds client-side state.
  entries: TimelineEntry[];
  // TRUE per-type totals, computed server-side over every row (never capped
  // by the query's `limit` — see getPersonTimeline) — the ground truth the
  // client compares its own loaded pool against (isPillSelectionComplete).
  countsByType: Record<string, number>;
  activePill?: TimelinePillKey;
  openTasks: TimelineTask[];
  isAdmin: boolean;
  // "Unificado a partir de N registros" system card (mockup-port r08;
  // contact-record.html:135-138). `null`/`unifiedFromCount <= 1` when this
  // person was never the survivor of a migration/merge. `bodyText` is
  // `dict.contactRecordServer.mergeCardBody(...)`'s RESULT, rendered
  // server-side in page.tsx — this is a Client Component, so it can never
  // receive the function template itself (see the doc comment on
  // `contactRecordServer` in dictionaries/es.ts).
  mergeInfo: { unifiedFromCount: number; hasMergeEvent: boolean; at: Date; bodyText: string } | null;
}

/** Cache key for the "Todo" (unfiltered) scope — `TimelinePillKey` never collides with this string. */
const ALL_SCOPE = "all" as const;
type TimelineScope = TimelinePillKey | typeof ALL_SCOPE;

function scopeOf(pill: TimelinePillKey | undefined): TimelineScope {
  return pill ?? ALL_SCOPE;
}

const MERGE_UNIFIED_TYPE = "merge_unified" as const;

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

// contact-record.html:97-106's 6 pills (Todo/Notas/Llamadas/Correos/
// Reuniones/Sistema — mockup-port fix). Grouping/counting itself lives in
// @/lib/activity/timelinePills (one data map, TIMELINE_PILL_GROUPS); this
// component only maps each pill to its label/icon.
const PILL_LABEL_KEY: Record<TimelinePillKey, keyof ContactRecordLabels> = {
  note: "timelinePillNotes",
  call: "timelinePillCalls",
  email_sent: "timelinePillEmails",
  meeting_logged: "timelinePillMeetings",
  system: "timelinePillSystem",
};

const PILL_ICON: Record<TimelinePillKey, (props: { className?: string }) => React.ReactElement> = {
  note: NoteIcon,
  call: CallIcon,
  email_sent: MailIcon,
  meeting_logged: MeetingIcon,
  system: HistoryIcon,
};

function filterHref(personId: string, pill?: TimelinePillKey): string {
  return pill ? `/contacts/${personId}?activityType=${pill}#activity` : `/contacts/${personId}#activity`;
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
 * groupTimelineEntries, src/lib/contacts/timelineGrouping.ts).
 *
 * Instant pill filtering (fix/timeline-filter-no-reload): a pill click used
 * to be a plain `<Link href="?activityType=...">`, so every click
 * re-rendered the ENTIRE record page server-side just to filter a list
 * already on screen. Now a click only ever does one of two things:
 *
 *  1. Filter the already-loaded `entries` pool locally (no network at all)
 *     when it's PROVEN to already contain every row for that pill —
 *     `isPillSelectionComplete` compares the pool against `countsByType`,
 *     the record's TRUE per-type totals (never capped by the query limit).
 *     True for the vast majority of contacts (prod average: 1.09 activities
 *     — the initial "Todo" page already holds everything).
 *  2. Fetch just that pill's own page via `getTimelinePillEntriesAction`
 *     (one query, no page render) when the pool is proven incomplete — e.g.
 *     a busy contact (prod max: 335 activities) whose "Todo" page is capped
 *     well below that and can be dominated by a more-recent type, silently
 *     under-representing an older one if filtered purely client-side.
 *
 * Each scope's result is cached in `cache` (keyed by pill, or `ALL_SCOPE`
 * for "Todo") for the lifetime of this mount, so re-visiting a pill is
 * always instant after its first load. The URL's `?activityType=` is kept
 * in sync via `history.replaceState` (no navigation — see `syncScopeUrl`),
 * and `entries`/`countsByType`/`activePill` are the server's ground truth
 * again on every fresh server render (e.g. `router.refresh()` after adding
 * a note) — the effect below resets the cache whenever those props change,
 * so mutations elsewhere on the page (NoteComposer, CompleteTaskButton)
 * still show up without a stale client cache masking them.
 *
 * `entry.metadata === null` (isTimelineEntryVisible said no, design R6)
 * always renders the locked marker regardless of type.
 */
export function Timeline({
  personId,
  labels: l,
  entries,
  countsByType,
  activePill,
  openTasks,
  isAdmin,
  mergeInfo,
}: TimelineProps) {
  const { showToast } = useToast();
  const [cache, setCache] = useState<Partial<Record<TimelineScope, TimelineEntry[]>>>(() => ({
    [scopeOf(activePill)]: entries,
  }));
  const [activeScope, setActiveScope] = useState<TimelineScope>(() => scopeOf(activePill));
  const [pendingScope, setPendingScope] = useState<TimelineScope | null>(null);
  // Guards the reset effect below against firing redundantly on mount (the
  // `useState` initializers above already seed the right state for the
  // first render) — it should only re-seed when the SERVER sends new props.
  const mountedProps = useRef({ entries, activePill });

  useEffect(() => {
    if (mountedProps.current.entries === entries && mountedProps.current.activePill === activePill) return;
    mountedProps.current = { entries, activePill };
    setCache({ [scopeOf(activePill)]: entries });
    setActiveScope(scopeOf(activePill));
    setPendingScope(null);
  }, [entries, activePill]);

  function syncScopeUrl(pill: TimelinePillKey | undefined) {
    if (typeof window === "undefined") return;
    // Raw History API, not `router.push`/`replace` — the App Router shallow-
    // routing pattern for updating the URL bar without triggering a server
    // render. Passing the router's own `history.state` back (instead of
    // `null`) keeps whatever Next.js already attached there (scroll
    // restoration, segment cache keys) intact.
    window.history.replaceState(window.history.state, "", filterHref(personId, pill));
  }

  function selectPill(pill: TimelinePillKey | undefined) {
    const scope = scopeOf(pill);
    if (scope === activeScope) return;
    syncScopeUrl(pill);

    const cached = cache[scope];
    if (cached) {
      setActiveScope(scope);
      return;
    }

    const referencePool = cache[activeScope] ?? entries;
    if (isPillSelectionComplete(referencePool, countsByType, pill)) {
      setCache((prev) => ({ ...prev, [scope]: filterEntriesForPill(referencePool, pill) }));
      setActiveScope(scope);
      return;
    }

    setPendingScope(scope);
    getTimelinePillEntriesAction(personId, pill)
      .then((result) => {
        setPendingScope(null);
        if (!result.ok) {
          showToast(l.genericError, "error");
          return;
        }
        setCache((prev) => ({ ...prev, [scope]: result.entries }));
        setActiveScope(scope);
      })
      .catch(() => {
        setPendingScope(null);
        showToast(l.genericError, "error");
      });
  }

  function handlePillClick(e: React.MouseEvent<HTMLAnchorElement>, pill: TimelinePillKey | undefined) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    selectPill(pill);
  }

  const displayedEntries = cache[activeScope] ?? entries;
  const activePillNow = activeScope === ALL_SCOPE ? undefined : activeScope;
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);
  const showMergeCard = !activePillNow && mergeInfo && mergeInfo.unifiedFromCount > 1;

  // Email-thread grouping (contact-record.html:116-123) — done on the raw
  // `displayedEntries` BEFORE merging in the merge synthetic entry, so
  // `groupEmailThreads` only ever sees real `TimelineEntry` rows (it needs
  // `.visible`, which the synthetic doesn't carry).
  const threaded = groupEmailThreads(displayedEntries);
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
    ...(showMergeCard
      ? [{ id: "merge-unified", type: MERGE_UNIFIED_TYPE, createdAt: mergeInfo!.at, metadata: null }]
      : []),
  ]);
  const upcoming = upcomingTasks(openTasks);

  return (
    <div>
      <div className="timeline-toolbar" role="group" aria-label={l.timelineFilterGroupLabel} aria-busy={pendingScope !== null}>
        <Link
          href={filterHref(personId)}
          className={activePillNow ? "filter-pill" : "filter-pill on"}
          onClick={(e) => handlePillClick(e, undefined)}
          aria-current={activePillNow ? undefined : "true"}
        >
          {l.timelineFilterAll} <span className="n">{total}</span>
          {pendingScope === ALL_SCOPE && <span className="spinner" aria-hidden="true" />}
        </Link>
        {TIMELINE_PILL_KEYS.map((pill) => {
          const Icon = PILL_ICON[pill];
          return (
            <Link
              key={pill}
              href={filterHref(personId, pill)}
              className={activePillNow === pill ? "filter-pill on" : "filter-pill"}
              onClick={(e) => handlePillClick(e, pill)}
              aria-current={activePillNow === pill ? "true" : undefined}
            >
              <Icon className="icon" />
              {l[PILL_LABEL_KEY[pill]] as string} <span className="n">{sumPillCount(countsByType, pill)}</span>
              {pendingScope === pill && <span className="spinner" aria-hidden="true" />}
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

      {displayedEntries.length === 0 && upcoming.length === 0 ? (
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
                          {mergeInfo!.bodyText}
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
