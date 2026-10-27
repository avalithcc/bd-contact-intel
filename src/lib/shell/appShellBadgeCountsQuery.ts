/**
 * Fresh-review fix: `AppLayout` used to run `getTaskBadgeCount` and
 * `getFollowUpQueueBadgeCount` as two separate sequential round trips —
 * doubling the shell's own query budget on every single page view (rule:
 * "round trips are the budget", PERFORMANCE.md). Combines both into ONE
 * statement, two independent scalar subqueries in a single `SELECT`, so the
 * shell pays exactly one round trip for both badges combined, same as
 * before this feature existed.
 *
 * Each subquery preserves the EXACT semantics of the function it replaces:
 * - `task_count`: `getTaskBadgeCount` — open tasks assigned to this BD, due
 *   (non-null `due_at`) before `tomorrowStartUtc`.
 * - `follow_up_count`: `getFollowUpQueueBadgeCount` — this BD's `pending`
 *   queue rows for today's `queue_date` that have NOT been worked today (ANY
 *   BD, not just this one — see queueQueries.ts's `workedTodayExists` doc
 *   comment) AND whose person is not merged (matches `readQueueRows`'s own
 *   `isNull(person.mergedIntoId)` join filter — without this, a merged
 *   person could inflate the badge past what the page itself shows). Never
 *   materializes an un-materialized day (reads 0 rows -> 0 for free),
 *   matching the original function's contract. Its "worked today" window
 *   uses `workedTodayFromIso`/`workedTodayToIso` (real-instant
 *   `argentinaInstantBoundary` bounds), a DIFFERENT pair from
 *   `tomorrowStartUtcIso` (naive `due_at` bound) — see each param's own
 *   comment; this split IS the fix for the 2026-09-30 day-boundary bug.
 *
 * Schema-only import (no `@/db` client) so this stays importable — and this
 * file's own test stays runnable — without a live DATABASE_URL, same
 * convention as src/lib/followUp/candidateQuery.ts. `activity` is left
 * UNALIASED (rule 4/PgDialect render test below); the "worked today" time
 * expression below is therefore written with LITERAL `activity.`-qualified
 * SQL text (not `${activity.column}` interpolation) — PERFORMANCE.md's
 * documented Drizzle 0.36.4 gotcha: `activity` is already interpolated bare
 * as this subquery's `FROM ${activity}` target, so reusing the SAME column
 * reference via `${activity.column}` a second time inside this NESTED
 * correlated subquery would silently re-emit its earlier unqualified
 * rendering instead of table-qualifying it, making the correlation always
 * resolve inside the wrong scope. `queueSelection.ts#workedTodayAtSql()`
 * (which DOES use `${activity.column}` interpolation, safe there because
 * it is never nested inside another query that already bare-interpolated
 * `activity`) is NOT reused here for that reason — this file inlines the
 * equivalent CASE as raw text instead, kept in sync by
 * tests/unit/queueSelection.test.ts and this file's own tests both pinning
 * the same `call`-excluded, `email_sent`/`reply_received`-only rule.
 */
import { sql } from "drizzle-orm";
import { notActiveClientCompanySql } from "@/lib/followUp/activeClientExclusion";
import { activity, bd, companyAbsorptionProposal, duplicateCandidate, emailAccount, followUpQueueItem, meeting, person, scheduledEmail, sequence, sequenceMember, task } from "@/db/schema";
import { safeTimestamptzText } from "@/lib/contacts/effectiveActivityTime";
import { carriedOpenItemSql, carriedOverdueCountSql } from "@/lib/followUp/openCycle";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";
import { CLOSED_STATES } from "@/lib/sequences/memberState";

/** Raw-SQL-text twin of queueSelection.ts#workedTodayAtSql() — see this file's doc comment for why it can't reuse that helper via interpolation here. */
export const WORKED_TODAY_AT_SQL_TEXT = `(case
            when activity.type = 'call' then activity.created_at
            when activity.type in ('email_sent', 'reply_received') then coalesce(${safeTimestamptzText("(activity.metadata->>'occurredAt')")}, activity.created_at)
            else activity.created_at end)`;

export interface AppShellBadgeCountsQueryParams {
  bdId: string;
  /** ART calendar date (`YYYY-MM-DD`) for the follow-up queue lookup. */
  queueDate: string;
  /**
   * `getTaskBadgeCount`'s `before` boundary — tomorrow's ART calendar date at
   * 00:00 UTC (naive `due_at` scheme, `argentinaDayBoundaries`). Bounds
   * `task.due_at` ONLY — never reuse this for the "worked today" instant
   * window below (see that param's own comment and
   * src/lib/tasks/argentinaDate.ts's module doc comment).
   */
  tomorrowStartUtcIso: string;
  /**
   * Real-instant "worked today" window (queueQueries.ts#workedTodayExists),
   * from `argentinaInstantBoundary` — the actual UTC instant ART midnight
   * falls on. Bounds `activity`'s real timestamp expression, NOT
   * `task.due_at`. Deliberately separate from `tomorrowStartUtcIso` above:
   * that one is the naive 00:00-UTC `due_at` boundary and is >=3h off from
   * ART midnight, which is exactly the bug this pair of params fixes (an
   * activity logged 21:00-24:00 ART used to fail this window).
   */
  workedTodayFromIso: string;
  workedTodayToIso: string;
  /** The clock for "Por confirmar" (meeting_pending_count): a scheduled meeting whose time is at or before it. */
  nowIso: string;
  /**
   * Only admins see (and can open) /admin/duplicates, so only they pay for
   * the `duplicate_count` subquery; everyone else gets a literal 0.
   */
  isAdmin?: boolean;
}

export function buildAppShellBadgeCountsQuery({
  bdId,
  queueDate,
  tomorrowStartUtcIso,
  workedTodayFromIso,
  workedTodayToIso,
  nowIso,
  isAdmin = false,
}: AppShellBadgeCountsQueryParams) {
  const workedTypes = sql.join(
    [...WORKED_ACTIVITY_TYPES].map((t) => sql`${t}`),
    sql`, `,
  );
  const closedStates = sql.join(
    CLOSED_STATES.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`
    select
      (
        select count(*)::int
        from ${task}
        where task.assigned_to_bd_id = ${bdId}::uuid
          and task.status = 'open'
          and task.due_at is not null
          and task.due_at < ${tomorrowStartUtcIso}::timestamptz
      ) as task_count,
      (
        (
        select count(*)::int
        from ${followUpQueueItem}
        where follow_up_queue_item.bd_id = ${bdId}::uuid
          and follow_up_queue_item.queue_date = ${queueDate}::date
          and follow_up_queue_item.state = 'pending'
          -- Fresh-review fix: without this, a merged person still counted
          -- toward the badge while readQueueRows (queueQueries.ts) already
          -- hides them from the page itself -- the badge said 3, the page
          -- showed 2. Same "merged persons are hidden from every read"
          -- guard (design D1/D6) as that function's own isNull(person.
          -- mergedIntoId) join filter.
          and exists (
            select 1 from ${person}
            where person.id = follow_up_queue_item.person_id
              and person.merged_into_id is null
              -- Same exclusion as the page read (activeClientExclusion.ts).
              and ${notActiveClientCompanySql(sql`person.company_key`)}
          )
          and not exists (
            select 1 from ${activity}
            where activity.person_id = follow_up_queue_item.person_id
              and activity.type in (${workedTypes})
              and ${sql.raw(WORKED_TODAY_AT_SQL_TEXT)} >= ${workedTodayFromIso}::timestamptz
              and ${sql.raw(WORKED_TODAY_AT_SQL_TEXT)} < ${workedTodayToIso}::timestamptz
          )
        )
        -- follow-up-expiry: plus every unworked item carried from an earlier day (days 1-2 and the Vencidos), the same
        -- predicate the page reads with (openCycle.ts).
        + (select count(*)::int from ${followUpQueueItem} where ${carriedOpenItemSql(bdId, queueDate)})
      ) as follow_up_count,
      -- The Vencidos alone, for the badge's accessible name ("13 seguimientos pendientes: 3 vencidos y 10 de hoy").
      ${carriedOverdueCountSql(bdId, queueDate)}::int as follow_up_overdue_count,
      (
        -- Team-wide on purpose: unlike task_count/follow_up_count (per-BD),
        -- an absorption proposal is proposed by one BD and resolved by any
        -- BD, so every BD sees the same pending total. No bd filter.
        -- Backed by company_absorption_proposal_open_absorbed_idx (partial,
        -- WHERE status = 'open').
        select count(*)::int
        from ${companyAbsorptionProposal}
        where company_absorption_proposal.status = 'open'
      ) as absorption_count,
      ${
        isAdmin
          ? sql`(
        -- Exactly the /admin/duplicates queue (listOpenDuplicateCandidates):
        -- status = 'open'. Team-wide, admin-only. Backed by
        -- duplicate_candidate_status_idx.
        select count(*)::int
        from ${duplicateCandidate}
        where duplicate_candidate.status = 'open'
      )`
          : sql`0`
      } as duplicate_count,
      -- F5: has today's queue been built for this BD? The shell builds it
      -- when false (readBadgeRowEnsuringQueue.ts). Index-friendly: hits the
      -- (bd_id, queue_date, person_id) unique key.
      exists (
        select 1 from ${followUpQueueItem}
        where follow_up_queue_item.bd_id = ${bdId}::uuid
          and follow_up_queue_item.queue_date = ${queueDate}::date
      ) as queue_built,
      (
        -- Reconnect banner (email-sync.html screen 4) — piggybacked onto
        -- this SAME single round trip (PERFORMANCE.md) rather than a
        -- second query in AppLayout. Returns the raw columns
        -- decideConnectionBanner() needs, not a precomputed verdict, so that
        -- pure function (unit-tested) stays the one place the rule lives.
        select json_build_object(
          'status', email_account.status,
          'grantedScopes', email_account.granted_scopes,
          -- Sync health inputs (syncHealth.ts): same row, same round trip.
          'syncError', email_account.sync_error,
          'lastSyncedAt', email_account.last_synced_at,
          'connectedAt', email_account.connected_at
        )
        from ${emailAccount}
        where email_account.bd_id = ${bdId}::uuid
      ) as email_account_banner_state,
      (
        -- Sidebar "Secuencias" pill (outreach-sequences 13.6): THIS BD's Sequences that still have at least one member
        -- with something left to do (anything outside replied / no_reply / discarded). Per-BD, like task_count.
        -- Backed by sequence_member_sequence_state_idx; the owner scan is over a handful of rows.
        select count(*)::int
        from ${sequence}
        where sequence.owner_bd_id = ${bdId}::uuid
          and exists (
            select 1 from ${sequenceMember}
            where sequence_member.sequence_id = sequence.id
              and sequence_member.state not in (${closedStates})
          )
      ) as sequence_count,
      (
        -- Sidebar "Programados" pill (scheduled-send): THIS BD's emails still waiting on them or on the clock -- scheduled,
        -- on hold (the contact replied) or failed. Backed by scheduled_email_bd_status_idx.
        select count(*)::int
        from ${scheduledEmail}
        where scheduled_email.bd_id = ${bdId}::uuid
          and scheduled_email.status in ('scheduled', 'on_hold', 'failed')
      ) as scheduled_count,
      (
        -- Sidebar "Reuniones" pill (meeting-outcomes): THIS BD's meetings waiting for an outcome ("Por confirmar") -- scheduled,
        -- and their time has passed. Only their own, an admin's included. Backed by meeting_bd_status_at_idx.
        select count(*)::int
        from ${meeting}
        where meeting.bd_id = ${bdId}::uuid
          and meeting.status = 'scheduled'
          and meeting.scheduled_at <= ${nowIso}::timestamptz
      ) as meeting_pending_count,
      ${
        isAdmin
          ? sql`(
        -- Admin sidebar pill "Estado de Gmail": the Gmail account of every monitored BD, as light json (no message, bounce or
        -- reminder tables: those belong to the fleet screen's own read). gmailAttentionCount() classifies it in JS with the
        -- same rules as the screen. Same monitored set as fleetQueries.ts: admins, BDs with reminders on, or any account.
        -- Literal column text, not interpolated column objects, per the Drizzle gotcha in PERFORMANCE.md. A handful of rows.
        select json_agg(json_build_object(
          'has', email_account.bd_id is not null,
          'status', email_account.status,
          'grantedScopes', email_account.granted_scopes,
          'syncError', email_account.sync_error,
          'lastSyncedAt', email_account.last_synced_at,
          'connectedAt', email_account.connected_at
        ))
        from ${bd}
        left join ${emailAccount} on email_account.bd_id = bd.id
        where bd.role = 'admin' or bd.email_reminders_enabled or email_account.bd_id is not null
      )`
          : sql`null`
      } as gmail_fleet_accounts
  `;
}
