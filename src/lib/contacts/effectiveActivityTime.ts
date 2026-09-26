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
 * that same rule (guarded: only casts `metadata->>'originalAt'` to
 * `timestamptz` when it matches an ISO-datetime shape, so a malformed value
 * can't throw across the whole query) — the ONE shared helper every raw-SQL
 * site that needs a row's effective time reuses (listQueries.ts's DISTINCT
 * ON pick, `lastActivityAgg` MAX, and `lastActivityDays` EXISTS filter; the
 * Contact record timeline's `getPersonTimeline`, bug fix, prod smoke test:
 * a HubSpot-imported `status_backfill` activity was ordered and displayed
 * by `created_at` — when the migration ran — instead of
 * `metadata.originalAt`, the historical time it reconstructs, making
 * imported history look like it happened today). This module's tests pin
 * the JS-side rule every SQL site must match.
 */
import { sql } from "drizzle-orm";
import { activity } from "@/db/schema";
import { activityRowToStatusEvent, type ActivityRowForStatus } from "@/lib/status/deriveStatus";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function resolveEffectiveActivityAt(row: ActivityRowForStatus): Date {
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
  return sql`(case when ${activity.type} = 'status_backfill' and (${activity.metadata}->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (${activity.metadata}->>'originalAt')::timestamptz else ${activity.createdAt} end)`;
}

/** Same semantics as the SQL EXISTS filter's `effectiveAt >= since` check —
 * used here only to pin the rule in a unit test; the actual filter runs in
 * SQL (listQueries.ts), never by fetching rows into JS to check this. */
export function isEffectiveActivityWithinDays(
  row: ActivityRowForStatus,
  days: number,
  now: Date = new Date(),
): boolean {
  const since = new Date(now.getTime() - days * MS_PER_DAY);
  return resolveEffectiveActivityAt(row) >= since;
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
