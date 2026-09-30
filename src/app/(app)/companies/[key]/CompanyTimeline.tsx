"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import type { CompanyActivityFilter } from "@/lib/companies/recordMappers";
import { resolveCompanyScopeRows, type CompanyTimelineFilterCounts } from "@/lib/companies/recordMappers";
import { isRequestCurrent } from "@/lib/activity/requestGeneration";
import type { CompanyTimelineViewRow } from "@/lib/companies/timelineView";
import { groupTimelineEntries } from "@/lib/contacts/timelineGrouping";
import { MailIcon, HistoryIcon, NoteIcon, MeetingIcon, TasksIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { getCompanyTimelineFilterEntriesAction } from "../actions";

export interface CompanyTimelineLabels {
  timelineFilterAll: string;
  timelineFilterNote: string;
  timelineFilterStageChange: string;
  timelineFilterContactActivity: string;
  timelineEmpty: string;
  genericError: string;
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

const TYPE_ICON: Record<string, (props: { className?: string }) => React.ReactElement> = {
  note: NoteIcon,
  email_sent: MailIcon,
  // Synced Gmail reply (email-sync brief) — same icon as email_sent, no new
  // visual design for this entry type yet.
  reply_received: MailIcon,
  status_change: HistoryIcon,
  status_backfill: HistoryIcon,
  meeting_logged: MeetingIcon,
  task_updated: TasksIcon,
  task_completed: TasksIcon,
  task_reopened: TasksIcon,
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
 * that's subject-agnostic — and, as of fix/company-timeline-filter-no-reload,
 * the same instant-filter machinery Contact's `Timeline.tsx` uses
 * (`isRequestCurrent`/a per-mount cache/a resolve-or-fetch decision), applied
 * to this tab's OWN filter vocabulary (all/note/stage_change/contact_activity)
 * rather than activity-type pills — see `resolveCompanyScopeRows`
 * (recordMappers.ts) for the one place that vocabulary difference lives.
 *
 * Before this fix, a filter pill was a plain `<Link href="?activityFilter=...">`,
 * so every click re-rendered the ENTIRE record page server-side (`getCompanyByKey`
 * plus a several-query `Promise.all`) just to filter a list already on
 * screen — the identical bug already fixed on the Contact record. Now a
 * click only ever does one of two things:
 *
 *  1. Filter the already-loaded row pool locally (no network) when it's
 *     PROVEN to already contain every row for that filter —
 *     `resolveCompanyScopeRows` compares the pool against `counts`, the
 *     record's TRUE per-filter totals (never capped by the query's
 *     `TIMELINE_LIMIT` — see `getCompanyTimelineFilterCounts`).
 *  2. Fetch just that filter's own page via
 *     `getCompanyTimelineFilterEntriesAction` (one query, no page render)
 *     when the pool is proven incomplete.
 *
 * Rows arrive PRE-FORMATTED (`CompanyTimelineViewRow`'s `what`/`body`) — see
 * `buildCompanyTimelineViewRows` (timelineView.ts) for why the "what" text's
 * formatter functions (`serverStrings`) can never themselves cross into this
 * Client Component.
 */
export function CompanyTimeline({
  companyKey,
  rows,
  counts,
  activeFilter,
  labels: l,
}: {
  companyKey: string;
  rows: CompanyTimelineViewRow[];
  counts: CompanyTimelineFilterCounts;
  activeFilter: CompanyActivityFilter;
  labels: CompanyTimelineLabels;
}) {
  const { showToast } = useToast();
  const [cache, setCache] = useState<Partial<Record<CompanyActivityFilter, CompanyTimelineViewRow[]>>>(() => ({
    [activeFilter]: rows,
  }));
  const [activeScope, setActiveScope] = useState<CompanyActivityFilter>(activeFilter);
  const [pendingScope, setPendingScope] = useState<CompanyActivityFilter | null>(null);
  // See Contact record's Timeline.tsx for the full reasoning behind each of
  // these refs — this mirrors that component's guards exactly, just against
  // this tab's own filter vocabulary instead of a pill key.
  const mountedProps = useRef({ rows, activeFilter });
  const activeScopeRef = useRef(activeScope);
  activeScopeRef.current = activeScope;
  const generationRef = useRef(0);

  function bumpGeneration(): void {
    generationRef.current += 1;
  }

  function syncFilterUrl(filter: CompanyActivityFilter) {
    if (typeof window === "undefined") return;
    // Raw History API, not the Next.js router — same deliberate choice
    // Contact record's Timeline.tsx makes (see its `syncScopeUrl`'s doc
    // comment): a filter click is not a new place in history, and must not
    // trigger the server render `router.replace` would cause.
    window.history.replaceState(window.history.state, "", filterHref(companyKey, filter));
  }

  function fetchScope(filter: CompanyActivityFilter) {
    const requestGeneration = generationRef.current;
    setPendingScope(filter);
    getCompanyTimelineFilterEntriesAction(companyKey, filter)
      .then((result) => {
        if (!isRequestCurrent(requestGeneration, generationRef.current)) return;
        setPendingScope(null);
        if (!result.ok) {
          showToast(l.genericError, "error");
          return;
        }
        setCache((prev) => ({ ...prev, [filter]: result.rows }));
        setActiveScope(filter);
      })
      .catch(() => {
        if (!isRequestCurrent(requestGeneration, generationRef.current)) return;
        setPendingScope(null);
        showToast(l.genericError, "error");
      });
  }

  // Re-derives the client's own still-active filter from fresh server props
  // (e.g. after `router.refresh()` following a note/task mutation elsewhere
  // on the page) — see Contact record's Timeline.tsx's matching effect for
  // the full "why" (the same fresh-review fix applies here verbatim).
  useEffect(() => {
    if (mountedProps.current.rows === rows && mountedProps.current.activeFilter === activeFilter) return;
    mountedProps.current = { rows, activeFilter };
    bumpGeneration();
    setPendingScope(null);

    const targetScope = activeScopeRef.current;

    setCache((prev) => {
      const next: Partial<Record<CompanyActivityFilter, CompanyTimelineViewRow[]>> = { [activeFilter]: rows };
      if (targetScope !== activeFilter && prev[targetScope]) next[targetScope] = prev[targetScope];
      return next;
    });

    if (targetScope === activeFilter) {
      syncFilterUrl(targetScope);
      return;
    }

    const resolved = resolveCompanyScopeRows(rows, counts, targetScope);
    if (resolved.kind === "ready") {
      setCache((prev) => ({ ...prev, [targetScope]: resolved.rows }));
      syncFilterUrl(targetScope);
      return;
    }

    syncFilterUrl(targetScope);
    fetchScope(targetScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rows`/`activeFilter`
    // (the server round-trip signal) intentionally gate this effect alone;
    // `counts` always arrives from the same load as `rows`, and
    // `companyKey`/`l`/`showToast` are stable for the life of this page.
  }, [rows, activeFilter]);

  function selectFilter(filter: CompanyActivityFilter) {
    if (filter === activeScope) return;
    bumpGeneration();
    syncFilterUrl(filter);

    const cached = cache[filter];
    if (cached) {
      setActiveScope(filter);
      return;
    }

    const referencePool = cache[activeScope] ?? rows;
    const resolved = resolveCompanyScopeRows(referencePool, counts, filter);
    if (resolved.kind === "ready") {
      setCache((prev) => ({ ...prev, [filter]: resolved.rows }));
      setActiveScope(filter);
      return;
    }

    fetchScope(filter);
  }

  function handleFilterClick(e: React.MouseEvent<HTMLAnchorElement>, filter: CompanyActivityFilter) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    selectFilter(filter);
  }

  const displayedRows = cache[activeScope] ?? rows;
  const groups = groupTimelineEntries(
    displayedRows.map((r) => ({ id: r.id, type: r.type, createdAt: r.createdAt, metadata: r.metadata })),
  );

  return (
    <div id="activity">
      <div className="timeline-toolbar" role="group" aria-label={l.timelineFilterAll} aria-busy={pendingScope !== null}>
        {FILTERS.map((filter) => (
          <Link
            key={filter}
            href={filterHref(companyKey, filter)}
            className={activeScope === filter ? "filter-pill on" : "filter-pill"}
            onClick={(e) => handleFilterClick(e, filter)}
            aria-current={activeScope === filter ? "true" : undefined}
          >
            {filterLabel(l, filter)}
            {pendingScope === filter && <span className="spinner" aria-hidden="true" />}
          </Link>
        ))}
      </div>

      {displayedRows.length === 0 ? (
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
                const row = displayedRows.find((r) => r.id === entry.id)!;
                const Icon = TYPE_ICON[entry.type] ?? NoteIcon;
                return (
                  <div key={entry.id} className="tl-item">
                    <div className="tl-icon">
                      <Icon className="icon" />
                    </div>
                    <div className="tl-card">
                      <div className="tl-head">
                        <span className="what">
                          {row.scope === "contact" && row.personId ? (
                            <Link href={`/contacts/${row.personId}`}>{row.what}</Link>
                          ) : (
                            row.what
                          )}
                        </span>
                        <span className="when">{formatWhen(at)}</span>
                      </div>
                      {row.body && (
                        // Fresh-review BLOCKER fix, 2026-09-30: `row.visible`
                        // (buildCompanyTimelineViewRows) mirrors the contact
                        // timeline's locked-marker class swap — `row.body`
                        // is already the locked-content copy when `!visible`
                        // (computed server-side; no metadata ever reaches
                        // this component for a locked row).
                        <div className={row.visible ? "tl-body" : "locked"}>
                          <blockquote>{row.body}</blockquote>
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
