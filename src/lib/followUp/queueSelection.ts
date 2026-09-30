/**
 * Shared constants for the per-BD daily follow-up queue
 * (openspec/decisions/2026-09-30-decision-brief.md, "1. Follow-up cadence —
 * decided"; openspec/changes/follow-up-queue/mockups/README.md).
 *
 * Fresh-review fix: this module used to also hold a pure JS eligibility/
 * ordering planner (`selectFollowUpQueue`) meant to "pin" the same rule the
 * SQL in src/lib/followUp/candidateQuery.ts implements. It had no production
 * caller — the real selection has to happen in SQL (rule: "the selection
 * query is one round trip"; pulling a BD's full candidate set into JS just
 * to replicate what one SQL query already does would cost exactly the
 * round-trip/memory blowup PERFORMANCE.md warns against) — so it was dead
 * code duplicating the 3-day/7-day/12-month thresholds as a SEPARATE set of
 * constants the SQL never referenced, free to silently drift from the real
 * rule. Deleted rather than kept "for documentation" (removed dead code +
 * its own tests, per review). `candidateQuery.ts`'s doc comment is now the
 * one place the eligibility/ordering rule is written down, next to the SQL
 * that actually enforces it.
 *
 * What's left here are the two values production genuinely imports:
 * `FOLLOW_UP_DAILY_CAP` (candidateQuery.ts's default `cap` parameter) and
 * `WORKED_ACTIVITY_TYPES` (queueQueries.ts's "worked today" `IN` list).
 */
import { sql } from "drizzle-orm";
import { activity } from "@/db/schema";
import { activityRowToStatusEvent, type ActivityRowForStatus } from "@/lib/status/deriveStatus";

export const FOLLOW_UP_DAILY_CAP = 10;

/** The five existing quick-action activity types that count as "worked"
 * (mockup README decision 3: "note, call, meeting, sent email, or
 * discard"), matching the exact `activity.type` values those dialogs write
 * (src/lib/contacts/timelineEntryBody.ts's own switch pins the same set).
 * Opening the record or creating a Tarea does NOT count. */
export const WORKED_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  "note",
  "call",
  "meeting_logged",
  "email_sent",
  "discarded",
]);

/**
 * "Worked today" (queueQueries.ts#workedTodayExists,
 * appShellBadgeCountsQuery.ts's `follow_up_count` subquery) asks "did the
 * BD do something on this contact today" — deliberately the raw log time
 * for most types (a `call` logged today about an event from yesterday
 * still counts: LOGGING it is the BD's action today).
 *
 * `email_sent`/`reply_received` rows written by the Gmail sync (email-sync
 * brief) break that assumption: their `created_at` is just when the
 * automated sync/backfill happened to run, unrelated to BD engagement
 * timing. A message synced TODAY that was actually sent/received 60 days
 * ago must NOT count as worked today; a message actually sent from Gmail
 * TODAY must. `metadata.occurredAt` carries the real time — reusing
 * `activityRowToStatusEvent` (src/lib/status/deriveStatus.ts) gets exactly
 * that substitution for free (it already redirects `email_sent`/
 * `reply_received`/`call` to `occurredAt` when present), so `call` is
 * explicitly carved back out here to preserve its existing "logged-at
 * counts" semantics.
 */
export function resolveWorkedTodayAt(row: ActivityRowForStatus): Date {
  if (row.type === "call") return row.createdAt;
  return activityRowToStatusEvent(row).at;
}

const WORKED_TODAY_OCCURRED_AT_TYPES = ["email_sent", "reply_received"] as const;

/** SQL-side twin of `resolveWorkedTodayAt` — same `call` carve-out, same ISO-datetime guard before casting. */
export function workedTodayAtSql() {
  return sql`(case
    when ${activity.type} = 'call' then ${activity.createdAt}
    when ${activity.type} in (${sql.join(
      WORKED_TODAY_OCCURRED_AT_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}) and (${activity.metadata}->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then (${activity.metadata}->>'occurredAt')::timestamptz
    else ${activity.createdAt} end)`;
}
