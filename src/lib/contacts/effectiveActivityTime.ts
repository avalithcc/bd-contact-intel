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
import { sql } from "drizzle-orm";
import { activity } from "@/db/schema";
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
export const NON_TOUCH_ACTIVITY_TYPES = ["task_created", "task_updated", "task_completed", "task_reopened"] as const;

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
export function resolveEffectiveActivityAt(row: ActivityRowForStatus): Date | null {
  if (isNonTouchActivityType(row.type)) return null;
  return activityRowToStatusEvent(row).at;
}

/**
 * SQL-side twin of `resolveEffectiveActivityAt` — same rule, same guard
 * (only casts when `metadata->>'originalAt'` already looks like an ISO
 * datetime), so a query can `ORDER BY`/aggregate on a row's effective time
 * without pulling every row into JS first. `@/db/schema`-only import (no
 * `@/db` client), so this stays importable — and this file's tests stay
 * runnable — without a live DATABASE_URL, same as every other pure helper
 * here.
 */
export function effectiveActivityAtSql() {
  return sql`(case
    when ${activity.type} in (${sql.join(
      NON_TOUCH_ACTIVITY_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}) then null
    when ${activity.type} = 'status_backfill' and (${activity.metadata}->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (${activity.metadata}->>'originalAt')::timestamptz
    when ${activity.type} in (${sql.join(
      OCCURRED_AT_ACTIVITY_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}) and (${activity.metadata}->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (${activity.metadata}->>'occurredAt')::timestamptz
    else ${activity.createdAt} end)`;
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
