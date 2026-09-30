"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import { EditTaskDialog, type EditTaskLabels } from "@/app/(app)/tasks/EditTaskDialog";
import { formatTaskDueDate } from "@/lib/tasks/argentinaDate";
import type { TimelineActivityType, TimelineEntry } from "@/lib/activity/queries";
import {
  TIMELINE_PILL_KEYS,
  TASK_ACTIVITY_TYPES,
  sumPillCount,
  sumTaskActivityCount,
  resolveScopeEntries,
  type TimelinePillKey,
} from "@/lib/activity/timelinePills";
import { isRequestCurrent } from "@/lib/activity/requestGeneration";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { groupTimelineEntries, upcomingTasks } from "@/lib/contacts/timelineGrouping";
import { sortTasksForTimelinePill } from "@/lib/contacts/timelineTasks";
import {
  groupEmailThreads,
  isInferredThread,
  threadContextSummary,
  type EmailThreadGroup,
} from "@/lib/contacts/emailThreads";
import { callWhatLabel, emailRecipientText, entryBody } from "@/lib/contacts/timelineEntryBody";
import { splitQuotedText } from "@/lib/gmail/splitQuotedText";
import { useToast } from "@/components/ToastProvider";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import {
  CallIcon,
  ChevronDownIcon,
  DiscardIcon,
  ExternalLinkIcon,
  EyeIcon,
  HistoryIcon,
  LockIcon,
  MailIcon,
  MeetingIcon,
  NoteIcon,
  SearchIcon,
  TasksIcon,
} from "@/components/icons";
import { CompleteTaskButton } from "./CompleteTaskButton";
import { ReopenTaskButton } from "./ReopenTaskButton";
import { NoteComposer } from "./NoteComposer";
import { AdminViewConversationDialog } from "./AdminViewConversationDialog";
import { canShowAdminConversationAction } from "@/lib/activity/adminConversationAccess";
import { getTimelinePillEntriesAction } from "../actions";
import { getThreadBodiesAction } from "./threadActions";
import type { ThreadMessageBody } from "@/lib/gmail/threadMessages";
import styles from "./page.module.css";

export interface TimelineTask {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "done";
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedToBdId: string | null;
  assignedToName: string | null;
  /** Precomputed "Name · Company" text for the edit dialog's read-only
   * "Asociado con" field — see EditTaskDialog.tsx's EditableTask. */
  associationLabel: string;
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
  // Synced-thread "Recibido" messages (email-sync.html screen 1) never
  // carry the contact's own name in `actorName` — every `email_sent`/
  // `reply_received` row's `actorBdId`/`actorName` is the MAILBOX OWNER
  // (see src/lib/gmail/syncQueries.ts#writeSyncedMessages), so the
  // counterpart's identity for a "Recibido" message is simply this record's
  // own contact.
  personName: string;
  labels: ContactRecordLabels;
  // Server-fetched initial page for `activePill` (or the unfiltered "Todo"
  // page when `activePill` is undefined) — see the "Instant pill filtering"
  // comment on the component below for how this seeds client-side state.
  entries: TimelineEntry[];
  // TRUE per-type totals, computed server-side over every row (never capped
  // by the query's `limit` — see getPersonTimeline) — the ground truth the
  // client compares its own loaded pool against (isPillSelectionComplete).
  countsByType: Record<string, number>;
  // `"task"` (contact-record.html:104's "Tareas" pill) is never a real
  // `TimelinePillKey` — see the doc comment on @/lib/activity/timelinePills —
  // it only ever comes from page.tsx's own `?activityType=task` deep-link
  // check, never from `getPersonTimeline`'s filter.
  activePill?: TimelinePillKey | "task";
  // Every open-or-done task for this Contact that FIT the bounded reads
  // behind getTasksForPerson (src/lib/tasks/queries.ts — open capped at 50,
  // done at 20) — the "Próximas" bucket below filters this down to
  // `status === "open"` itself (unchanged behavior); the "Tareas" pill uses
  // the full array via sortTasksForTimelinePill.
  tasks: TimelineTask[];
  // TRUE count of open+done tasks (cancelled excluded), never capped by
  // `tasks`' own bounded reads — same "never capped" contract as
  // `countsByType` above. Drives the Tareas pill's own badge AND the part of
  // "Todo"'s total that accounts for tasks (getTasksForPerson's
  // openCount+doneCount).
  taskTotalCount: number;
  // Feed the "Editar tarea" dialog (task-edit change) opened from a task
  // card's title or its "Reprogramar" button — see `editingTask` state
  // below. Same shape NewTaskButton/TaskTitleLink already take.
  assigneeOptions: { id: string; name: string }[];
  meId: string;
  taskLabels: EditTaskLabels;
  isAdmin: boolean;
  // "Unificado a partir de N registros" system card (mockup-port r08;
  // contact-record.html:135-138). `null`/`unifiedFromCount <= 1` when this
  // person was never the survivor of a migration/merge. `bodyText` is
  // `dict.contactRecordServer.mergeCardBody(...)`'s RESULT, rendered
  // server-side in page.tsx — this is a Client Component, so it can never
  // receive the function template itself (see the doc comment on
  // `contactRecordServer` in dictionaries/es.ts).
  mergeInfo: { unifiedFromCount: number; hasMergeEvent: boolean; at: Date; bodyText: string } | null;
  // The activity row that fired the CURRENT `replied` status, or `null`
  // (status isn't `replied`, or it came from a connection row instead of an
  // activity — see StatusBecause, src/lib/status/deriveStatus.ts). Drives
  // the "Marcó el estado como Respondió" marker (email-sync.html:165) on
  // the one synced message inside a thread that actually moved the needle.
  statusMovedByActivityId: string | null;
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
  // Synced Gmail reply (email-sync brief) — own headline label, but grouped
  // under the same "Correos" pill as email_sent (TIMELINE_PILL_GROUPS).
  reply_received: "timelineFilterReplyReceived",
  hunter_lookup: "timelineFilterHunter",
  status_change: "timelineFilterStatusChange",
  meeting_logged: "timelineFilterMeeting",
  call: "timelineFilterCall",
  discarded: "timelineFilterDiscarded",
  status_backfill: "timelineFilterStatusBackfill",
  task_updated: "timelineFilterTaskUpdated",
  task_completed: "timelineFilterTaskCompleted",
  task_reopened: "timelineFilterTaskReopened",
};

// contact-record.html's `.tl-icon`/`.tl-icon.{modifier}` per activity type
// (mockup-port r03). `note`/`hunter_lookup` render the plain (unmodified)
// icon circle, matching the mockup's markup for both.
const TYPE_ICON: Record<TimelineActivityType, (props: { className?: string }) => React.ReactElement> = {
  note: NoteIcon,
  email_sent: MailIcon,
  // Same icon as email_sent — no new visual design for this entry type yet.
  reply_received: MailIcon,
  hunter_lookup: SearchIcon,
  status_change: HistoryIcon,
  meeting_logged: MeetingIcon,
  call: CallIcon,
  discarded: DiscardIcon,
  status_backfill: HistoryIcon,
  // Uses the existing system/status-change entry layout (owner spec) — same
  // icon family as every other internal/system-generated entry.
  task_updated: TasksIcon,
  task_completed: TasksIcon,
  task_reopened: TasksIcon,
};

const TYPE_ICON_CLASS: Partial<Record<TimelineActivityType, string>> = {
  email_sent: "email",
  reply_received: "email",
  status_change: "system",
  meeting_logged: "meeting",
  call: "call",
  discarded: "discard",
  status_backfill: "system",
  task_updated: "system",
  task_completed: "system",
  task_reopened: "system",
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

function filterHref(personId: string, pill?: TimelinePillKey | "task"): string {
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
  personName,
  labels: l,
  entries,
  countsByType,
  activePill,
  tasks,
  taskTotalCount,
  assigneeOptions,
  meId,
  taskLabels,
  isAdmin,
  mergeInfo,
  statusMovedByActivityId,
}: TimelineProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editingTask, setEditingTask] = useState<TimelineTask | null>(null);
  // On-demand thread bodies (task brief §1 — never fetched during the
  // page's own render). Keyed by `gmailThreadId`, only ever populated the
  // first time that thread is expanded; re-collapsing/re-expanding reuses
  // the cached entry instead of re-fetching.
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [threadBodies, setThreadBodies] = useState<Record<string, Record<string, ThreadMessageBody>>>({});
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [expandedQuotedIds, setExpandedQuotedIds] = useState<Set<string>>(new Set());
  // Admin's "Ver conversación (queda registrado)" action (admin-conversation-
  // access mockup, screen 1) — one dialog instance shared by every locked row,
  // rather than one per BD like the mockup's own `#confirm-view-juan`/`-ana`
  // anchors, since the set of BDs a contact has locked content from isn't
  // known ahead of render time here the way the mockup's fixed sample is.
  const [pendingAdminView, setPendingAdminView] = useState<{ bdId: string; bdName: string } | null>(null);

  function toggleQuoted(messageId: string) {
    setExpandedQuotedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function toggleThread(threadId: string) {
    if (expandedThreadId === threadId) {
      setExpandedThreadId(null);
      return;
    }
    setExpandedThreadId(threadId);
    if (threadBodies[threadId]) return;
    setLoadingThreadId(threadId);
    getThreadBodiesAction(personId, threadId)
      .then((result) => {
        setLoadingThreadId(null);
        if (!result.ok) {
          showToast(l.timelineThreadLoadError, "error");
          return;
        }
        const byGmailMessageId = Object.fromEntries(result.messages.map((m) => [m.gmailMessageId, m]));
        setThreadBodies((prev) => ({ ...prev, [threadId]: byGmailMessageId }));
      })
      .catch(() => {
        setLoadingThreadId(null);
        showToast(l.timelineThreadLoadError, "error");
      });
  }
  // "task" (the Tareas pill) is never a real activity scope for the
  // cache/fetch engine below — it's tracked entirely by `isTasksActive`
  // instead, since its data (`tasks`) is always fully loaded already, never
  // fetched. `activityPillOf` strips it before feeding the engine.
  function activityPillOf(pill: TimelinePillKey | "task" | undefined): TimelinePillKey | undefined {
    return pill === "task" ? undefined : pill;
  }
  const [cache, setCache] = useState<Partial<Record<TimelineScope, TimelineEntry[]>>>(() => ({
    [scopeOf(activityPillOf(activePill))]: entries,
  }));
  const [activeScope, setActiveScope] = useState<TimelineScope>(() => scopeOf(activityPillOf(activePill)));
  const [isTasksActive, setIsTasksActive] = useState(activePill === "task");
  const isTasksActiveRef = useRef(isTasksActive);
  isTasksActiveRef.current = isTasksActive;
  const [pendingScope, setPendingScope] = useState<TimelineScope | null>(null);
  // Guards the reset effect below against firing redundantly on mount (the
  // `useState` initializers above already seed the right state for the
  // first render) — it should only re-derive when the SERVER sends new props.
  const mountedProps = useRef({ entries, activePill });
  // "Latest value" ref (fresh-review CRITICAL fix): the reset effect below
  // must read whatever pill the CLIENT currently has selected, not the one
  // it was seeded with — reading `activeScope` state directly from the
  // effect would make the effect depend on it and re-run on every pill
  // click, which is not what "reset only when the server sends new props"
  // means. Assigning during render is the standard React pattern for this.
  const activeScopeRef = useRef(activeScope);
  activeScopeRef.current = activeScope;
  // Fresh-review follow-up WARNING: a scoped fetch (fetchScope) can be
  // superseded either by a NEWER fetch (another pill clicked before the
  // first resolves) or by a background data refresh (the reset effect
  // below) — this counter is bumped at both of those points, and a
  // resolving fetch discards its own result once it's no longer current
  // (see fetchScope / isRequestCurrent, @/lib/activity/requestGeneration).
  const generationRef = useRef(0);

  function bumpGeneration(): void {
    generationRef.current += 1;
  }

  function syncScopeUrl(pill: TimelinePillKey | "task" | undefined) {
    if (typeof window === "undefined") return;
    // Raw History API, not `router.push`/`router.replace` — deliberate:
    // 1) `replaceState`, not `pushState` — a filter pill is not a new place
    //    in the page's history; it must not spam Back with one entry per
    //    click, and Back from the record page should leave the record, not
    //    walk through every pill the BD tried.
    // 2) Raw `history`, not the Next.js router — this is the App Router
    //    shallow-routing workaround (Next has no first-class shallow
    //    routing yet): it updates the visible URL without the server render
    //    a `router.replace` would trigger, which is the whole point of this
    //    fix. Passing the router's own `history.state` back (instead of
    //    `null`) keeps whatever Next.js already attached there (scroll
    //    restoration, segment cache keys) intact.
    //
    // Trade-off this buys: Next's OWN internal `canonicalUrl` (written only
    // by a real `router.push`/`replace`) is untouched by this call and can
    // still diverge from the address bar — see the reset effect below for
    // why that no longer matters for correctness.
    window.history.replaceState(window.history.state, "", filterHref(personId, pill));
  }

  /**
   * Fetches one pill's own page (getTimelinePillEntriesAction) and, on
   * success, both caches it and makes it the active scope. Shared by
   * `selectPill` (a fresh click) and the reset effect (re-deriving the
   * still-active pill after a background data refresh) so a fetch's
   * success/error handling can't drift between the two call sites.
   *
   * Callers are expected to have already called `bumpGeneration()` for
   * whatever event triggered this fetch (a click, a refresh) — this only
   * CAPTURES the resulting generation and, once the promise settles,
   * refuses to touch cache/activeScope/pendingScope if a LATER event (a
   * newer fetch, or another refresh) has since moved the generation past
   * it (`isRequestCurrent`). Without this, a slow fetch that's since been
   * superseded could resolve after the fact and silently jump the view
   * back to its (now stale) pill.
   */
  function fetchScope(pill: TimelinePillKey | undefined, scope: TimelineScope) {
    const requestGeneration = generationRef.current;
    setPendingScope(scope);
    getTimelinePillEntriesAction(personId, pill)
      .then((result) => {
        if (!isRequestCurrent(requestGeneration, generationRef.current)) return;
        setPendingScope(null);
        if (!result.ok) {
          showToast(l.genericError, "error");
          return;
        }
        setCache((prev) => ({ ...prev, [scope]: result.entries }));
        setActiveScope(scope);
      })
      .catch(() => {
        if (!isRequestCurrent(requestGeneration, generationRef.current)) return;
        setPendingScope(null);
        showToast(l.genericError, "error");
      });
  }

  /**
   * Fresh-review CRITICAL fix: `router.refresh()` (NoteComposer/
   * CompleteTaskButton, after a mutation) re-fetches Next's own
   * `canonicalUrl` — the pill active at the LAST REAL navigation — not
   * `window.location`, so it's blind to any `syncScopeUrl` calls a pill
   * click made since. The server therefore recomputes `activePill` (this
   * `activePill` prop) for whatever pill THAT was, not what the BD is
   * currently looking at, and can even revert the visible URL back to it.
   *
   * The underlying data DID change (that's the whole reason the refresh
   * fired) and every previously cached scope may now be stale, so this
   * drops the cache — but it must NOT let the server's `activePill` decide
   * what's on screen: `activeScopeRef` (the CLIENT's own last selection)
   * is the one source of truth for the active pill after first paint, and
   * this only ever re-derives THAT pill's view from the fresh pool —
   * locally when possible (`resolveScopeEntries`), via one scoped fetch
   * otherwise — then re-asserts the URL, since the refresh may have
   * reverted it.
   *
   * Fresh-review follow-up WARNING: fresh server props always supersede
   * whatever fetch might be in flight (the pool it was fetching against no
   * longer reflects the current data), so this bumps the generation
   * unconditionally before anything else. That bump is exactly what makes
   * the very next line — `setPendingScope(null)` — safe to call
   * unconditionally too: if a fetch WAS in flight, it just became stale by
   * construction (its captured generation can no longer equal the new
   * current one), so clearing its spinner here is clearing a spinner this
   * effect just superseded, never one that still belongs to a fetch this
   * effect has no opinion on. If none was in flight, clearing `null` to
   * `null` is a no-op.
   */
  useEffect(() => {
    if (mountedProps.current.entries === entries && mountedProps.current.activePill === activePill) return;
    mountedProps.current = { entries, activePill };
    bumpGeneration();
    setPendingScope(null);

    const serverScope = scopeOf(activityPillOf(activePill));

    // The Tareas pill never depends on `entries`/`cache` at all — it always
    // reads the fresh `tasks` prop directly (see the render below) — so a
    // background refresh (e.g. completing/reopening a task while THIS pill
    // is the one on screen) only needs to keep the activity cache warm for
    // whenever the BD leaves it, and to re-assert the URL the server's own
    // (activity-only) `activePill` may have reverted.
    if (isTasksActiveRef.current) {
      setCache((prev) => ({ ...prev, [serverScope]: entries }));
      syncScopeUrl("task");
      return;
    }

    const targetScope = activeScopeRef.current;
    const targetPill = targetScope === ALL_SCOPE ? undefined : targetScope;

    // Always refresh the scope the server just delivered. Every OTHER
    // previously cached scope is dropped — the data changed, so a stale
    // cache entry can't be trusted blindly the next time that pill is
    // clicked (`selectPill`'s cache-hit fast path) — EXCEPT the currently
    // active one, if different: its OLD (pre-mutation, but still correctly-
    // scoped) entries stay in place until its replacement below is ready,
    // so the visible list never flashes to a DIFFERENT scope's data while
    // re-deriving it.
    setCache((prev) => {
      const next: Partial<Record<TimelineScope, TimelineEntry[]>> = { [serverScope]: entries };
      if (targetScope !== serverScope && prev[targetScope]) next[targetScope] = prev[targetScope];
      return next;
    });

    if (targetScope === serverScope) {
      syncScopeUrl(targetPill);
      return;
    }

    const resolved = resolveScopeEntries(entries, countsByType, targetPill);
    if (resolved.kind === "ready") {
      setCache((prev) => ({ ...prev, [targetScope]: resolved.entries }));
      syncScopeUrl(targetPill);
      return;
    }

    syncScopeUrl(targetPill);
    fetchScope(targetPill, targetScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entries`/
    // `activePill` (the server round-trip signal) intentionally gate this
    // effect alone; `countsByType` always arrives from the same
    // getPersonTimeline call as `entries`, and `personId`/`l`/`showToast`
    // are stable for the life of this record page.
  }, [entries, activePill]);

  function selectPill(pill: TimelinePillKey | undefined) {
    const scope = scopeOf(pill);
    const leavingTasksPill = isTasksActive;
    if (scope === activeScope && !leavingTasksPill) return;
    setIsTasksActive(false);
    // Every branch below moves the active scope away from whatever it was —
    // including the cache-hit/local-derive ones that never call
    // `fetchScope` at all — so this must supersede any fetch already in
    // flight from a PREVIOUS click here too, not just the two triggers the
    // fetch-vs-fetch/refresh race was first reported for: otherwise that
    // earlier fetch could still resolve later and jump the view back to its
    // pill even though the BD already moved on to this one via a cheaper
    // path.
    bumpGeneration();
    syncScopeUrl(pill);

    // Coming FROM the Tareas pill back to an activity scope that's already
    // cached (the common case — nothing about the activity pool changed
    // while Tareas was on screen) needs no re-derivation at all.
    if (scope === activeScope) return;

    const cached = cache[scope];
    if (cached) {
      setActiveScope(scope);
      return;
    }

    const referencePool = cache[activeScope] ?? entries;
    const resolved = resolveScopeEntries(referencePool, countsByType, pill);
    if (resolved.kind === "ready") {
      setCache((prev) => ({ ...prev, [scope]: resolved.entries }));
      setActiveScope(scope);
      return;
    }

    fetchScope(pill, scope);
  }

  /**
   * "Tareas" pill (mockup-port timeline-tasks-pill; contact-record.html:104)
   * — always a pure client-side switch, never a fetch: `tasks` (open + done)
   * is already fully loaded in `props` (see TimelineProps' doc comment), the
   * same way the "Próximas" bucket below has always rendered straight from
   * props with no cache/fetch machinery of its own.
   */
  function selectTasksPill() {
    if (isTasksActive) return;
    setIsTasksActive(true);
    syncScopeUrl("task");
  }

  function handlePillClick(e: React.MouseEvent<HTMLAnchorElement>, pill: TimelinePillKey | undefined) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    selectPill(pill);
  }

  function handleTasksPillClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    selectTasksPill();
  }

  const displayedEntries = cache[activeScope] ?? entries;
  const activePillNow = activeScope === ALL_SCOPE ? undefined : activeScope;
  // "Todo" totals every activity type PLUS every task (open + done) — the
  // mockup's own arithmetic pins this: contact-record.html:98's "Todo 15"
  // equals the sum of every OTHER pill's own count on that same screen
  // (3+1+2+4+0+2+3, including "Tareas 2"), not just the activity types.
  // `taskTotalCount`, not `tasks.length` — `tasks` is the bounded rows array
  // (getTasksForPerson caps open at 50, done at 20); `taskTotalCount` is the
  // true, never-capped total, same invariant `countsByType` already holds.
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0) + taskTotalCount;
  const showMergeCard = !isTasksActive && !activePillNow && mergeInfo && mergeInfo.unifiedFromCount > 1;

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
  const openTasksForUpcoming = tasks.filter((t) => t.status === "open");
  const upcoming = upcomingTasks(openTasksForUpcoming);
  const sortedTasksForPill = sortTasksForTimelinePill(tasks);
  const openTasksForPill = sortedTasksForPill.filter((t) => t.status === "open");
  const doneTasksForPill = sortedTasksForPill.filter((t) => t.status === "done");
  // task_updated/task_completed/task_reopened activity (task-edit change) —
  // grouped under the Tareas pill, not "Sistema" (see TASK_ACTIVITY_TYPES,
  // timelinePills.ts). Read from the "Todo" pool (usually complete per
  // isPillSelectionComplete's own contract — see that function's doc
  // comment); the badge itself uses `taskActivityCount`, the record's TRUE
  // total, so a busier contact's badge stays exact even if this list can't.
  const taskActivityPool = cache[ALL_SCOPE] ?? entries;
  const taskActivityEntries = taskActivityPool.filter((e) =>
    (TASK_ACTIVITY_TYPES as readonly string[]).includes(e.type),
  );
  const taskActivityCount = sumTaskActivityCount(countsByType);
  // Pills that group `activity` rows, minus "Sistema" — rendered before the
  // Tareas pill so Tareas can sit right where contact-record.html:104 puts
  // it: after Reuniones, before Sistema.
  const activityPillsBeforeTasks = TIMELINE_PILL_KEYS.filter((pill) => pill !== "system");

  /**
   * One open-task card — identical markup for the "Próximas" bucket
   * (visible regardless of the active pill) and the Tareas pill's own open
   * group (review fix: these two used to be hand-duplicated JSX blocks that
   * had to be kept in sync by hand).
   */
  function renderOpenTaskCard(t: TimelineTask) {
    return (
      <div key={t.id} className="tl-item">
        <div className="tl-icon">
          <TasksIcon className="icon" />
        </div>
        <div className="tl-card">
          <div className="tl-head">
            <button type="button" className="btn-text-reset what" onClick={() => setEditingTask(t)}>
              {t.title}
            </button>
            {t.dueAt && (
              <span className="badge badge-warn no-dot">
                {l.taskDueBadgePrefix} {formatTaskDueDate(t.dueAt)}
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
            {/* task-edit change: "Reprogramar" now opens the same "Editar
                tarea" dialog the title opens — previously inert
                (contact-record.html:111 has no wired destination for it). */}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingTask(t)}>
              {l.taskReschedule}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /**
   * The admin-only action row under a locked card (admin-conversation-access
   * mockup, `.locked-actions`). `canShowAdminConversationAction` (pure;
   * src/lib/activity/adminConversationAccess.ts) is the single source of
   * truth for "does this admin get the button" — `isAdmin` is server-computed
   * (page.tsx, from `me.role`), never a client-side guess.
   */
  function renderAdminViewAction(bdId: string | null, bdName: string | null) {
    if (!canShowAdminConversationAction({ isAdmin, locked: true, targetBdId: bdId })) return null;
    return (
      <div className="locked-actions row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setPendingAdminView({ bdId: bdId!, bdName: bdName ?? l.timelineSystemActor })}
        >
          <EyeIcon className="icon" />
          {l.viewConversationLink} ({l.viewConversationAuditHint})
        </button>
      </div>
    );
  }

  /**
   * One `task_updated`/`task_completed`/`task_reopened` entry inside the
   * Tareas pill's own view — the EXACT SAME system/status-change entry
   * layout the main "Todo" list already uses for these types (owner spec),
   * just grouped here instead of interleaved by month.
   */
  function renderTaskActivityEntry(entry: TimelineEntry) {
    const Icon = TYPE_ICON[entry.type as TimelineActivityType] ?? TasksIcon;
    return (
      <div key={entry.id} className="tl-item">
        <div className="tl-icon system">
          <Icon className="icon" />
        </div>
        <div className="tl-card system">
          <div className="tl-head">
            <span className="what">
              {l[FILTER_LABEL_KEY[entry.type as TimelineActivityType]] as string} · {entry.actorName ?? l.timelineSystemActor}
            </span>
            <span className="when">{formatWhen(entry.at)}</span>
          </div>
          <div className="tl-body">{entryBody(entry, l)}</div>
        </div>
      </div>
    );
  }

  /**
   * One message inside an expanded synced thread (email-sync.html:158-174).
   * `body` is `undefined` while the thread's bodies are still loading —
   * renders a couple of skeleton lines instead of the (missing) real text.
   */
  function renderThreadMessage(m: TimelineEntry, body: ThreadMessageBody | undefined, loading: boolean) {
    const isSent = m.type === "email_sent";
    const avatarId = isSent ? (m.actorBdId ?? meId) : personId;
    const senderName = isSent ? (m.actorName ?? l.timelineSystemActor) : personName;
    const to = emailRecipientText(m.metadata);
    const movedStatus = m.id === statusMovedByActivityId;
    const quotedOpen = expandedQuotedIds.has(m.id);
    const split = body?.bodyText ? splitQuotedText(body.bodyText) : null;

    return (
      <div key={m.id} className="thread-msg">
        <Avatar id={avatarId} initials={initialsFromName(senderName)} variant={isSent ? "bd" : "circle"} size="sm" />
        <div>
          <div className="thread-msg-head">
            <span className="who">
              <span className="from">{senderName}</span>{" "}
              <span className={isSent ? "badge badge-info no-dot" : "badge badge-success no-dot"}>
                {isSent ? l.timelineSentBadge : l.timelineReceivedBadge}
              </span>
            </span>
            <span className="when">{formatWhen(m.at)}</span>
          </div>
          {to && (
            <span className="meta recipient">
              {l.timelineRecipientPrefix} {to}
            </span>
          )}
          {movedStatus && <span className="badge badge-replied no-dot status-marker">{l.timelineStatusMovedMarker}</span>}
          {loading ? (
            <>
              <div className="skeleton mt-2xs" style={{ width: "90%" }} />
              <div className="skeleton mt-2xs" style={{ width: "60%" }} />
            </>
          ) : split ? (
            <>
              <div className="snippet" style={{ whiteSpace: "pre-wrap" }}>
                {split.main}
              </div>
              {split.quoted && (
                <>
                  <button
                    type="button"
                    className="quoted-toggle"
                    aria-expanded={quotedOpen}
                    onClick={() => toggleQuoted(m.id)}
                  >
                    <ChevronDownIcon className="icon" />
                    {quotedOpen ? l.timelineQuotedHide : l.timelineQuotedShow}
                  </button>
                  <div className="quoted-body" hidden={!quotedOpen} style={{ whiteSpace: "pre-wrap" }}>
                    {split.quoted}
                  </div>
                </>
              )}
              {body?.bodyTruncated && <p className="meta mt-2xs">{l.timelineBodyTruncatedNote}</p>}
            </>
          ) : (
            <div className="snippet">{entryBody(m, l)}</div>
          )}
        </div>
      </div>
    );
  }

  /**
   * The "Correos" pill's thread card (email-sync.html:151-187). Collapsed
   * by default — the intro line + "Ver en Gmail" are always visible, but
   * the per-message list (and its bodies) is only fetched once the BD
   * clicks to expand it (task brief §1: never a round trip on page load).
   */
  function renderEmailThreadCard(threadId: string, group: EmailThreadGroup<TimelineEntry>, when: Date) {
    const inferred = isInferredThread(group);
    const { matchedEmail, direction } = threadContextSummary(group);
    const subject = group.messages[0]?.metadata?.subject;
    const subjectText = typeof subject === "string" && subject ? subject : l.timelineThreadNoSubject;
    const isExpanded = expandedThreadId === threadId;
    const isLoadingThread = loadingThreadId === threadId;
    const bodiesForThread = threadBodies[threadId];

    return (
      <div key={`thread-${threadId}`} className="tl-item">
        <div className="tl-icon email">
          <MailIcon className="icon" />
        </div>
        <div className="tl-card">
          <div className="tl-head">
            <span className="what">
              {l.timelineThreadWhatPrefix} · {subjectText}
            </span>
            <span className="badge badge-info no-dot">
              {group.messages.length} {l.timelineFilterEmail.toLowerCase()}
            </span>
            <span className="when">{formatWhen(when)}</span>
          </div>
          {group.visible ? (
            <>
              <div className="tl-body">
                {/* Contextual summary (email-sync.html:180: "Con
                    d.salazar@despegar.com Deducido · Diego Salazar ·
                    saliente") replaces the generic sync-explanation intro —
                    mockup-fidelity fix, 2026-10-01. `personName` is always
                    the counterpart here: a thread only ever shows on the ONE
                    contact record it's grouped under. */}
                <p>
                  {l.timelineThreadContextPrefix}{" "}
                  {matchedEmail && <span className="mono">{matchedEmail}</span>}
                  {inferred && (
                    <>
                      {" "}
                      <span className="badge badge-probable" title={l.inferredMatchHint}>
                        {l.inferredBadge}
                      </span>
                    </>
                  )}{" "}
                  · {personName} · {direction === "inbound" ? l.timelineThreadInbound : l.timelineThreadOutbound}
                </p>
                <a
                  className="btn btn-ghost btn-sm mt-md"
                  href={`https://mail.google.com/mail/u/0/#all/${threadId}`}
                  target="_blank"
                  rel="noopener"
                >
                  <ExternalLinkIcon className="icon" />
                  {l.timelineViewInGmail}
                </a>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-md"
                aria-expanded={isExpanded}
                onClick={() => toggleThread(threadId)}
              >
                <ChevronDownIcon className="icon" />
                {isExpanded ? l.timelineHideMessages : l.timelineShowMessages}
                {isLoadingThread && <span className="spinner" aria-hidden="true" />}
              </button>
              {isExpanded && (
                <div className="thread">
                  {group.messages.map((m) => {
                    const gmailMessageId = typeof m.metadata?.gmailMessageId === "string" ? m.metadata.gmailMessageId : null;
                    const body = gmailMessageId ? bodiesForThread?.[gmailMessageId] : undefined;
                    return renderThreadMessage(m, body, isLoadingThread);
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="locked">
              <LockIcon className="icon" />
              <span>
                {(() => {
                  // The synthetic thread entry itself carries no actorName
                  // (it's synthesized in processedEntries above), but the
                  // REAL messages inside `group` do — `actorName` is never
                  // redacted, only `metadata` is (buildTimelineEntry.ts) —
                  // and every message in one gmailThreadId shares the same
                  // owning BD, so the first one is exactly the thread's own
                  // owner (email-sync.html:186's "Este hilo pertenece a
                  // Ana Pereyra").
                  const ownerName = group.messages.find((m) => m.actorName)?.actorName ?? l.timelineSystemActor;
                  return `${l.timelineLockedThreadBelongsTo} ${ownerName}. ${l.timelineLockedThreadPrivacyPrefix} ${ownerName} ${l.timelineLockedThreadPrivacySuffix}`;
                })()}
              </span>
            </div>
          )}
          {!group.visible &&
            renderAdminViewAction(
              group.messages.find((m) => m.actorBdId)?.actorBdId ?? null,
              group.messages.find((m) => m.actorName)?.actorName ?? null,
            )}
        </div>
      </div>
    );
  }

  function renderActivityPill(pill: TimelinePillKey) {
    const Icon = PILL_ICON[pill];
    return (
      <Link
        key={pill}
        href={filterHref(personId, pill)}
        className={!isTasksActive && activePillNow === pill ? "filter-pill on" : "filter-pill"}
        onClick={(e) => handlePillClick(e, pill)}
        aria-current={!isTasksActive && activePillNow === pill ? "true" : undefined}
      >
        <Icon className="icon" />
        {l[PILL_LABEL_KEY[pill]] as string} <span className="n">{sumPillCount(countsByType, pill)}</span>
        {pendingScope === pill && <span className="spinner" aria-hidden="true" />}
      </Link>
    );
  }

  return (
    <div>
      <div className="timeline-toolbar" role="group" aria-label={l.timelineFilterGroupLabel} aria-busy={pendingScope !== null}>
        <Link
          href={filterHref(personId)}
          className={!isTasksActive && !activePillNow ? "filter-pill on" : "filter-pill"}
          onClick={(e) => handlePillClick(e, undefined)}
          aria-current={!isTasksActive && !activePillNow ? "true" : undefined}
        >
          {l.timelineFilterAll} <span className="n">{total}</span>
          {pendingScope === ALL_SCOPE && <span className="spinner" aria-hidden="true" />}
        </Link>
        {activityPillsBeforeTasks.map(renderActivityPill)}
        <Link
          href={filterHref(personId, "task")}
          className={isTasksActive ? "filter-pill on" : "filter-pill"}
          onClick={handleTasksPillClick}
          aria-current={isTasksActive ? "true" : undefined}
        >
          <TasksIcon className="icon" />
          {l.timelinePillTasks} <span className="n">{taskTotalCount + taskActivityCount}</span>
        </Link>
        {renderActivityPill("system")}
        <span className="grow" />
        {/* Static — the record's timeline has exactly one sort order today
            (newest-first per bucket); no toggle exists to switch it, same as
            the static mockup shows no alternate state either. */}
        <button type="button" className="btn btn-ghost btn-sm" disabled>
          {l.timelineSortNewestFirst}
        </button>
      </div>

      <NoteComposer personId={personId} labels={l} />

      {isTasksActive ? (
        <>
          {openTasksForPill.length === 0 && doneTasksForPill.length === 0 && taskActivityEntries.length === 0 ? (
            <div className={styles.placeholder}>{l.timelineTasksEmpty}</div>
          ) : (
            <>
              {openTasksForPill.length > 0 && (
                <>
                  <div className="tl-group">{l.timelineGroupUpcoming}</div>
                  <div className="tl">{openTasksForPill.map(renderOpenTaskCard)}</div>
                </>
              )}
              {doneTasksForPill.length > 0 && (
                <>
                  <div className="tl-group">{l.timelineGroupCompletedTasks}</div>
                  <div className="tl">
                    {doneTasksForPill.map((t) => (
                      <div key={t.id} className="tl-item">
                        <div className="tl-icon">
                          <TasksIcon className="icon" />
                        </div>
                        <div className="tl-card">
                          <div className="tl-head">
                            <button type="button" className="btn-text-reset what" onClick={() => setEditingTask(t)}>
                              {t.title}
                            </button>
                            <span className="badge badge-neutral no-dot">{l.taskStatusDone}</span>
                            {t.assignedToName && (
                              <span className="when">
                                {l.timelineAssignedToPrefix} {t.assignedToName}
                              </span>
                            )}
                          </div>
                          <div className="row mt-lg">
                            <ReopenTaskButton
                              taskId={t.id}
                              personId={personId}
                              label={l.taskReopen}
                              errorLabel={l.genericError}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {taskActivityEntries.length > 0 && (
                <>
                  <div className="tl-group">{l.timelinePillTasks}</div>
                  <div className="tl">{taskActivityEntries.map(renderTaskActivityEntry)}</div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <div className="tl-group">{l.timelineGroupUpcoming}</div>
              <div className="tl">{upcoming.map(renderOpenTaskCard)}</div>
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
                  return renderEmailThreadCard(threadGroup.threadId, threadGroup, threadGroup.latestAt);
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
                      {!timelineEntry.visible &&
                        renderAdminViewAction(timelineEntry.actorBdId, timelineEntry.actorName)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
          )}
        </>
      )}

      {pendingAdminView && (
        <AdminViewConversationDialog
          open
          onClose={() => setPendingAdminView(null)}
          personId={personId}
          personName={personName}
          bdId={pendingAdminView.bdId}
          bdName={pendingAdminView.bdName}
          labels={l}
        />
      )}

      {editingTask && (
        <EditTaskDialog
          task={{
            id: editingTask.id,
            title: editingTask.title,
            description: editingTask.description,
            dueAt: editingTask.dueAt,
            assignedToBdId: editingTask.assignedToBdId,
            status: editingTask.status,
            personId,
            companyKey: null,
            associationLabel: editingTask.associationLabel,
          }}
          assigneeOptions={assigneeOptions}
          meId={meId}
          labels={taskLabels}
          onClose={() => setEditingTask(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
