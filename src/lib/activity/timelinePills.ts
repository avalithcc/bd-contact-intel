/**
 * Timeline filter pills (mockup-port fix; contact-record.html:97-106's 8
 * pills). The product's filter grouping — NOT the raw `activity.type` DB
 * enum — is what the BD sees: `TIMELINE_ACTIVITY_TYPES` (queries.ts) has 8
 * values, 4 of which (`hunter_lookup`, `status_change`, `discarded`,
 * `status_backfill`) are internal/migration evidence, never a team member's
 * real-time action. Those 4 collapse behind ONE "Sistema" pill so the
 * migration artifact (`status_backfill` alone: 3,517 rows in prod) never
 * outranks real BD activity in the UI.
 *
 * No LinkedIn pill: LinkedIn ingestion is off (see chore/hide-linkedin-
 * imports) and this module doesn't reintroduce it.
 *
 * No "task" entry in `TIMELINE_PILL_GROUPS`/`TimelinePillKey` itself, even
 * though the record page's Actividad tab DOES have a "Tareas" pill
 * (mockup-port timeline-tasks-pill; contact-record.html:104): a task ROW
 * (open/done) is still never an `activity` row, so `getTasksForPerson`'s
 * task list has no `activity.type` to group here. Timeline.tsx handles that
 * pill's task-row part entirely on its own — `getTasksForPerson` is fetched
 * once in page.tsx's initial `Promise.all`, so selecting it is a pure
 * client-side switch, never a fetch through this module's `TimelinePillKey`
 * machinery.
 *
 * `task_updated`/`task_completed`/`task_reopened` (task-edit change) ARE
 * real `activity` rows, though — see `TASK_ACTIVITY_TYPES` below. They ride
 * along in "Todo" through `TIMELINE_ACTIVITY_TYPES` (queries.ts) like any
 * other type, but are deliberately left OUT of every `TIMELINE_PILL_GROUPS`
 * entry (in particular "system") — the Tareas pill counts and displays them
 * itself (Timeline.tsx adds `sumTaskActivityCount` to its own badge and
 * filters its own loaded pool by `TASK_ACTIVITY_TYPES` when that pill is
 * active), so they must never ALSO be attributed to an activity-type pill or
 * they'd be counted twice on the same screen.
 *
 * Deliberately has ZERO imports from @/lib/activity/queries (which imports
 * @/db) so this stays a pure, DB-free module a plain `node:test` file can
 * import directly.
 */
export const TIMELINE_PILL_KEYS = ["note", "call", "email_sent", "meeting_logged", "system"] as const;

export type TimelinePillKey = (typeof TIMELINE_PILL_KEYS)[number];

/**
 * One source of truth for which raw `activity.type` values a pill covers.
 * Four pills are 1:1 with a single activity type (their key IS that type,
 * so a pre-existing `?activityType=note` deep link keeps meaning exactly
 * what it always meant); `system` is the one pill that fans out to 4 types.
 */
export const TIMELINE_PILL_GROUPS: Record<TimelinePillKey, readonly string[]> = {
  note: ["note"],
  call: ["call"],
  email_sent: ["email_sent"],
  meeting_logged: ["meeting_logged"],
  system: ["hunter_lookup", "status_change", "discarded", "status_backfill"],
};

export function isTimelinePillKey(value: string): value is TimelinePillKey {
  return (TIMELINE_PILL_KEYS as readonly string[]).includes(value);
}

/**
 * Resolves a `?activityType=` query value to the pill it belongs to.
 *
 * Accepts either a pill key directly (the current link shape the app
 * generates, e.g. `?activityType=system`) OR one of the 4 raw types now
 * folded into `system` (e.g. `?activityType=status_backfill`), so an
 * existing bookmark/deep link built before this change still lands on the
 * right (now-grouped) filter instead of silently 404-ing into "Todo".
 */
export function resolveTimelinePillKey(value: string | undefined): TimelinePillKey | undefined {
  if (!value) return undefined;
  if (isTimelinePillKey(value)) return value;
  for (const key of TIMELINE_PILL_KEYS) {
    if (TIMELINE_PILL_GROUPS[key].includes(value)) return key;
  }
  return undefined;
}

/** A pill's badge count is the SUM over every type it groups. */
export function sumPillCount(countsByType: Record<string, number>, pill: TimelinePillKey): number {
  return TIMELINE_PILL_GROUPS[pill].reduce((sum, type) => sum + (countsByType[type] ?? 0), 0);
}

/**
 * The three real `activity` types the "Editar tarea" dialog writes
 * (task-edit change) — grouped under the Tareas pill, never a
 * `TimelinePillKey`/`TIMELINE_PILL_GROUPS` entry (see this module's doc
 * comment above for why). Timeline.tsx uses this both to add their true
 * count to the Tareas pill's badge (`sumTaskActivityCount`) and to filter
 * its own loaded entry pool down to just these three when that pill is
 * active.
 */
export const TASK_ACTIVITY_TYPES = ["task_updated", "task_completed", "task_reopened"] as const;

export function sumTaskActivityCount(countsByType: Record<string, number>): number {
  return TASK_ACTIVITY_TYPES.reduce((sum, type) => sum + (countsByType[type] ?? 0), 0);
}

/**
 * Narrows an already-loaded entry pool down to one pill's grouped types
 * (fix/timeline-filter-no-reload: the client-side counterpart of
 * `getPersonTimeline({ pill })`'s SQL `WHERE type IN (...)`). `pill ===
 * undefined` is the "Todo" scope — every loaded entry matches it, so it's
 * returned unfiltered.
 */
export function filterEntriesForPill<T extends { type: string }>(
  entries: readonly T[],
  pill: TimelinePillKey | undefined,
): T[] {
  if (!pill) return [...entries];
  const types: readonly string[] = TIMELINE_PILL_GROUPS[pill];
  return entries.filter((e) => types.includes(e.type));
}

/**
 * Decides whether an already-loaded entry pool is a safe substitute for a
 * fresh server fetch scoped to `pill` (fix/timeline-filter-no-reload: the
 * pill click must render instantly instead of re-navigating the whole
 * record page, but a busy contact's server page is capped well below its
 * true activity count — see getPersonTimeline's `limit` — so a purely
 * client-side filter over that capped page can silently under-represent an
 * older-skewing type).
 *
 * `countsByType` is the record's TRUE per-type totals (computed server-side
 * over every row, never capped by the page limit — see getPersonTimeline),
 * so comparing the loaded pool's matching count against it is exact: equal
 * or more loaded rows than the true count means every row for that pill is
 * already in hand; fewer means the pool is missing some and the caller must
 * fetch that pill's own page instead of trusting the local filter.
 */
export function isPillSelectionComplete(
  loadedEntries: readonly { type: string }[],
  countsByType: Record<string, number>,
  pill: TimelinePillKey | undefined,
): boolean {
  if (!pill) {
    const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);
    return loadedEntries.length >= total;
  }
  return filterEntriesForPill(loadedEntries, pill).length >= sumPillCount(countsByType, pill);
}

export type ScopeResolution<T> = { kind: "ready"; entries: T[] } | { kind: "fetch" };

/**
 * The one decision both a pill click (Timeline.tsx's `selectPill`) and a
 * background data refresh (its reset effect, after e.g. adding a note calls
 * `router.refresh()`) make from a freshly-available entry pool: can `pill`'s
 * view be safely derived from it right now, or does it require a scoped
 * server fetch? Pulled out as its own pure function (fresh-review CRITICAL
 * fix: `router.refresh()` used to force the active pill back to "Todo"
 * because the reset effect trusted the server's `activePill` prop instead of
 * re-deriving the CLIENT's own still-active pill from the new data) so both
 * call sites can never answer this question differently.
 */
export function resolveScopeEntries<T extends { type: string }>(
  pool: readonly T[],
  countsByType: Record<string, number>,
  pill: TimelinePillKey | undefined,
): ScopeResolution<T> {
  if (isPillSelectionComplete(pool, countsByType, pill)) {
    return { kind: "ready", entries: filterEntriesForPill(pool, pill) };
  }
  return { kind: "fetch" };
}
