/**
 * Bug fix (owner report, prod smoke test): "Última actividad" (the column,
 * the sort, and the `lastActivityDays` filter) was reading
 * `activity.created_at` for EVERY row, including `status_backfill` rows —
 * migration reconstructions whose real historical time lives in
 * `metadata.originalAt`, not `created_at` (when the migration ran). That
 * made every backfill imported on a given day read as active THAT day
 * (e.g. 3,517 HubSpot backfills imported 2026-09-26 all sorted to the top
 * of the default list and all matched `lastActivityDays=30`).
 *
 * `resolveEffectiveActivityAt` is a thin, explicitly-named wrapper around
 * `@/lib/status/deriveStatus`'s `activityRowToStatusEvent(...).at` — the
 * SAME rule that function already uses to decide a `status_backfill` row's
 * effective time for status derivation — so this fix and status derivation
 * can never drift apart. `effectiveActivityAtSql` is the SQL-side twin of
 * that same rule (guarded: only casts `metadata->>'originalAt'`/
 * `metadata->>'occurredAt'` to `timestamptz` when it matches an
 * ISO-datetime shape, so a malformed value can't throw across the whole
 * query) — the ONE shared helper every raw-SQL site that needs a row's
 * effective time reuses (listQueries.ts's DISTINCT ON pick,
 * `lastActivityAgg` MAX, and `lastActivityDays` EXISTS filter; the Contact
 * record timeline's `getPersonTimeline`, bug fix, prod smoke test: a
 * HubSpot-imported `status_backfill` activity was ordered and displayed
 * by `created_at` — when the migration ran — instead of
 * `metadata.originalAt`, the historical time it reconstructs, making
 * imported history look like it happened today). A `call` row (migration
 * 0016) uses `metadata.occurredAt` the same way — a call is logged after
 * the fact, so its effective time is when it happened, not when the
 * dialog was saved — mirroring `activityRowToStatusEvent`'s `call` branch
 * exactly. `email_sent`/`reply_received` rows written by the Gmail sync
 * (email-sync brief) use `metadata.occurredAt` for the same reason: the
 * sync/backfill can insert a row days after the message was actually sent
 * or received (a 90-day backfill's oldest reply is inserted "now" but
 * happened months ago) — `OCCURRED_AT_ACTIVITY_TYPES`
 * (src/lib/status/deriveStatus.ts) is the ONE shared list both twins read,
 * so a future type added to it never needs updating in two places. This
 * module's tests pin the JS-side rule every SQL site must match.
 */
import { sql, type SQL } from "drizzle-orm";
import { activity } from "@/db/schema";
import { MEETING_ACTIVITY_TYPES } from "@/lib/meetings/status";
import {
  activityRowToStatusEvent,
  OCCURRED_AT_ACTIVITY_TYPES,
  type ActivityRowForStatus,
} from "@/lib/status/deriveStatus";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Activity types that record an editorial change to a Task association
 * (the types in `ALL_TASK_ACTIVITY_TYPES`, src/lib/tasks/taskActivityBody.ts) — NOT
 * BD engagement with the Contact itself. Editing a task's due date is not a
 * "touch" the way sending an email or logging a call is, so both twins
 * below treat these types as having NO effective time (SQL: `NULL`, which
 * `max()`/`coalesce()` ignore exactly like "no activity at all"; JS: `null`).
 * A person whose ONLY recorded activity is one of these types reads as
 * never-touched, not "touched when the task was edited" — every caller that
 * aggregates or orders by effective time already coalesces a missing value
 * to `-infinity`/falls back to `createdAt` for display (see
 * defaultPipelineStageQuery.ts, candidateQuery.ts, timelineEntry.ts,
 * timelineGrouping.ts), so this list is defined ONCE here and both twins
 * reference it — no second definition to drift.
 */
export const NON_TOUCH_ACTIVITY_TYPES = [
  "task_created",
  "task_updated",
  "task_completed",
  "task_reopened",
  // Scheduling, rescheduling, cancelling or a no-show records what happened to a meeting, not a conversation with the
  // Contact (meeting-outcomes). Only "Se hizo" (`meeting_logged`) is a touch.
  ...MEETING_ACTIVITY_TYPES,
] as const;

function isNonTouchActivityType(type: string): boolean {
  return (NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes(type);
}

/**
 * `Date | null` — `null` for `NON_TOUCH_ACTIVITY_TYPES` (see above), matching
 * `effectiveActivityAtSql()`'s `NULL` branch exactly. Every caller that needs
 * a value even for a non-touch row (e.g. a timeline row still needs SOME
 * date to render) falls back to `row.createdAt` itself at the call site,
 * same as the SQL twin's callers fall back via `coalesce`.
 */
export function resolveEffectiveActivityAt(row: ActivityRowForStatus & { deletedAt?: Date | null }): Date | null {
  // A soft-deleted note (contact-note-delete) is no longer an activity anyone can see, so it is not a "touch" either.
  if (row.deletedAt || isNonTouchActivityType(row.type)) return null;
  return activityRowToStatusEvent(row).at;
}

/**
 * The ONE time rule, in SQL. Two named entry points below ask two DIFFERENT questions of the same rows, and they differ in
 * exactly one branch (a soft-deleted note). Do not merge them back into one function: that is the mistake this split prevents.
 *
 *  - `effectiveActivityAtSql()`  "what should the BD SEE as activity?"  A soft-deleted note is NULL here: it is no longer
 *    shown, so it is not "Última actividad", not a day-filter match, not a count in a display. Use it for anything rendered.
 *  - `workDoneAtSql()`  "what WORK actually happened?"  A deleted note still has its time, because the touch happened and
 *    deleting its text does not un-happen it (owner decision: deleting a note is text cleanup, never a reassignment or an
 *    un-counting). Use it where the answer has a CONSEQUENCE beyond display: today the owner rule's evidence
 *    (identity/ownerRuleDb.ts#readOwnerTouches). The "worked today" reads (queueSelection.ts#workedTodayAtSql and its two
 *    raw-text twins) are the same second question and likewise ignore `deleted_at`.
 *
 * Both share `activityTimeCase`, so the status_backfill / occurredAt / non-touch rules cannot drift between them.
 *
 * SQL-side twin of `resolveEffectiveActivityAt` — same rule, same guard (only casts when `metadata->>'originalAt'` already
 * looks like an ISO datetime), so a query can `ORDER BY`/aggregate on a row's effective time without pulling every row into
 * JS first. `@/db/schema`-only import (no `@/db` client), so this stays importable without a live DATABASE_URL.
 */
/**
 * Full ISO-8601 datetime shape with real ranges (month 01-12, day 01-31, hour 00-23, minute/second 00-59, optional
 * fraction and offset). A prefix-only check let '2026-10-02T25:00:00' through to the cast, which throws.
 */
const ISO_DATETIME_SHAPE =
  "^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):?[0-5][0-9])?$";

/**
 * TOTAL timestamptz cast of a text expression: NULL (so the caller falls back to `created_at`) for anything that is not a
 * real datetime, and never an error. The shape regex rules out bad months/hours/minutes; the day-of-month check
 * (day <= days in that month, so '2026-02-30' and '2026-02-29' are rejected, '2028-02-29' is not) needs the nested CASE:
 * Postgres guarantees a CASE branch is only evaluated when its WHEN holds, which `a AND b` does not guarantee. Year is
 * limited to 19xx/20xx so `make_date` cannot see year 0.
 */
function safeTimestamptzSql(value: SQL) {
  return sql`(case when ${value} ~ ${sql.raw(`'${ISO_DATETIME_SHAPE}'`)} then (case
      when substr(${value}, 9, 2)::int <= extract(day from (make_date(substr(${value}, 1, 4)::int, substr(${value}, 6, 2)::int, 1) + interval '1 month' - interval '1 day'))::int
      then (${value})::timestamptz end) end)`;
}

function activityTimeCase(hideDeleted: boolean, meetingHeldAt = false) {
  const meetingBranch = meetingHeldAt
    ? sql`when ${activity.type} = 'meeting_logged' then coalesce(${safeTimestamptzSql(sql`(${activity.metadata}->>'at')`)}, ${activity.createdAt})
    `
    : sql``;
  const deletedBranch = hideDeleted ? sql`when ${activity.deletedAt} is not null then null ` : sql``;
  return sql`(case
    ${deletedBranch}when ${activity.type} in (${sql.join(
      NON_TOUCH_ACTIVITY_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}) then null
    ${meetingBranch}when ${activity.type} = 'status_backfill' then coalesce(${safeTimestamptzSql(sql`(${activity.metadata}->>'originalAt')`)}, ${activity.createdAt})
    when ${activity.type} in (${sql.join(
      OCCURRED_AT_ACTIVITY_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}) then coalesce(${safeTimestamptzSql(sql`(${activity.metadata}->>'occurredAt')`)}, ${activity.createdAt})
    else ${activity.createdAt} end)`;
}

/** What the BD SEES as activity: a soft-deleted note is NULL. See `activityTimeCase`'s doc for the two-question split. */
export function effectiveActivityAtSql() {
  return activityTimeCase(true);
}

/** What WORK happened: identical to `effectiveActivityAtSql()` except a soft-deleted note keeps its time. See above. */
export function workDoneAtSql() {
  return activityTimeCase(false);
}

/**
 * When the thing HAPPENED, for reports that bucket by period (prod 2026-10-19: a meeting logged 2026-09-30 and held
 * 2026-10-02 was counted in Q3). Identical to `workDoneAtSql()` except a `meeting_logged` row uses `metadata.at` (the
 * meeting's own date, entered by the BD, never in the future) and falls back to `created_at` when it is absent or not an
 * ISO datetime. `deriveStatus` deliberately keeps ignoring `metadata.at`, so status derivation is unchanged: this is a
 * reporting rule, not a status rule. Calls/emails/replies already use `metadata.occurredAt` in the shared case.
 */
export function happenedAtSql() {
  return activityTimeCase(false, true);
}

/** Same as `happenedAtSql()` but a soft-deleted note is NULL (display rule), for lists a BD reads. */
export function happenedAtDisplaySql() {
  return activityTimeCase(true, true);
}

/** JS twin of `happenedAtSql()` (pins the rule in a unit test; the report runs it in SQL). `null` for non-touch types. */
export function resolveHappenedAt(row: ActivityRowForStatus & { deletedAt?: Date | null }): Date | null {
  if (row.type === "meeting_logged" && !isNonTouchActivityType(row.type)) {
    const raw = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>).at : undefined;
    if (typeof raw === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(raw)) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return resolveEffectiveActivityAt({ ...row, deletedAt: null });
}

/** Same semantics as the SQL EXISTS filter's `effectiveAt >= since` check —
 * used here only to pin the rule in a unit test; the actual filter runs in
 * SQL (listQueries.ts), never by fetching rows into JS to check this. A
 * non-touch row (`resolveEffectiveActivityAt` returns `null`) is never
 * "within days" — matches the SQL EXISTS filter, where `NULL >= since` is
 * never true either. */
export function isEffectiveActivityWithinDays(
  row: ActivityRowForStatus,
  days: number,
  now: Date = new Date(),
): boolean {
  const at = resolveEffectiveActivityAt(row);
  if (!at) return false;
  const since = new Date(now.getTime() - days * MS_PER_DAY);
  return at >= since;
}

/**
 * Prod bug fix: the `lastActivityDays` EXISTS filter (listQueries.ts)
 * interpolated a raw JS `Date` directly into a `sql\`...\`` tagged
 * template. postgres-js's raw-template driver only accepts a string,
 * number, boolean, null, Buffer, or ArrayBuffer for an interpolated
 * value — NOT a `Date` object (that conversion only happens for drizzle's
 * typed column helpers like `gte()`, never for a raw `sql` template) — so
 * every `?...lastActivityDays=N` request threw `The "string" argument
 * must be of type string or an instance of Buffer or ArrayBuffer.
 * Received an instance of Date` and 500'd the whole page.
 *
 * Extracted as its own pure function (day-arithmetic + `.toISOString()`)
 * so the exact param shape the SQL site sends is unit-tested here; the SQL
 * site casts the resulting string explicitly (`${iso}::timestamptz`)
 * rather than relying on implicit coercion.
 */
export function buildSinceIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}
