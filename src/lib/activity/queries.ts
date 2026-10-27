import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activity, bd, type Activity, type NewActivity } from "@/db/schema";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { personIdLookupSql } from "@/lib/identity/resolveDb";
import { resolvePersonIdLookup } from "@/lib/identity/referenceWrite";
import { recomputePersonStatus } from "@/lib/status/recompute";
import { isOwnerTouchType } from "@/lib/identity/ownerOnTouch";
import { transferOwnersOnTouch } from "@/lib/identity/ownerOnTouchDb";
import { buildTimelineEntry, type TimelineEntry } from "@/lib/activity/timelineEntry";
import { notFoldedAttemptSql } from "@/lib/activity/callAttemptFold";
import { timelineOrderBySql } from "@/lib/activity/timelineOrder";
import { TIMELINE_PILL_GROUPS, type TimelinePillKey } from "@/lib/activity/timelinePills";

export type { TimelinePillKey } from "@/lib/activity/timelinePills";

export type { TimelineEntry } from "@/lib/activity/timelineEntry";

/** Activity types the Contact record's timeline pane renders (task 10.1).
 * The task activity types (ALL_TASK_ACTIVITY_TYPES (src/lib/tasks/taskActivityBody.ts)) join in with the task-edit
 * change — they appear in "Todo" through this same list (and its
 * `countsByType`), but are grouped under the "Tareas" pill instead of
 * "Sistema" (see TIMELINE_PILL_GROUPS, timelinePills.ts, and
 * TASK_ACTIVITY_TYPES there) and are never contact-touch/discard evidence
 * (deriveStatus.ts has no case for them — see
 * tests/unit/deriveStatus.test.ts). `reply_received` (email-sync brief) is
 * a synced Gmail reply — grouped under the "Correos" pill together with
 * `email_sent` (TIMELINE_PILL_GROUPS), never its own pill. */
export const TIMELINE_ACTIVITY_TYPES = [
  "note",
  "email_sent",
  "reply_received",
  "auto_reply_received",
  "email_bounced",
  "hunter_lookup",
  "status_change",
  "meeting_logged",
  // The rest of a meeting's life (meeting-outcomes). `meeting_scheduled` is deliberately absent: the "Próximas" card and the
  // outcome cards already tell it, and the activity itself stays as the audit record of who scheduled what.
  "meeting_no_show",
  "meeting_cancelled",
  "meeting_rescheduled",
  "call",
  "call_attempt",
  "lusha_reveal",
  "discarded",
  "status_backfill",
  // follow-up-expiry: leaving and re-entering Seguimientos (rendered as Sistema rows).
  "follow_up_dropped",
  "follow_up_expired",
  "follow_up_reentered",
  "task_created",
  "task_updated",
  "task_completed",
  "task_reopened",
] as const;

export type TimelineActivityType = (typeof TIMELINE_ACTIVITY_TYPES)[number];

export function isTimelineActivityType(value: string): value is TimelineActivityType {
  return (TIMELINE_ACTIVITY_TYPES as readonly string[]).includes(value);
}

export interface PersonTimelinePage {
  entries: TimelineEntry[];
  countsByType: Record<string, number>;
}

export interface ActivityFilters {
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  types?: string[];
}

export interface ActivityRow extends Activity {}

export interface ActivitiesPage {
  rows: ActivityRow[];
  total: number;
}

export async function getActivities(
  filters: ActivityFilters,
  limit: number = 50,
  offset: number = 0,
): Promise<ActivitiesPage> {
  const conditions: SQL[] = [];

  if (filters.leadId) {
    conditions.push(eq(activity.leadId, filters.leadId));
  }

  if (filters.companyKey) {
    conditions.push(eq(activity.companyKey, filters.companyKey));
  }

  if (filters.contactId) {
    conditions.push(eq(activity.contactId, filters.contactId));
  }

  if (filters.types && filters.types.length > 0) {
    const typeConditions = filters.types.map((t) => eq(activity.type, t));
    conditions.push(or(...typeConditions)!);
  }

  conditions.push(isNull(activity.deletedAt));
  const whereCondition = and(...conditions);

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activity)
    .where(whereCondition);

  const rows = await db
    .select()
    .from(activity)
    .where(whereCondition)
    .orderBy(desc(activity.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    rows,
    total: total?.count ?? 0,
  };
}

export async function getActivitiesByLead(
  leadId: string,
  limit: number = 50,
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.leadId, leadId), isNull(activity.deletedAt)))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

export async function getActivitiesByCompany(
  companyKey: string,
  limit: number = 50,
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.companyKey, companyKey), isNull(activity.deletedAt)))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

export async function getActivitiesByContact(
  contactId: string,
  limit: number = 50,
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.contactId, contactId), isNull(activity.deletedAt)))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

/**
 * `person_id` is resolved via a `person_id_map` subquery in the same insert
 * statement (design "Reference writes"; task 4B.5) — no matcher, no
 * advisory lock, since this never creates a person. Left null (kill switch
 * off, or the row's legacy id isn't mapped yet) leaves this byte-identical
 * to pre-cutover behavior for that row.
 *
 * Wrapped in a transaction (task 5.2) so the status cache (design D4) is
 * recomputed from the just-inserted activity in the same transaction as the
 * write itself — every activity type is potential status evidence
 * (deriveStatus decides which ones actually move the stage or discard).
 */
export async function createActivity(input: NewActivity): Promise<Activity> {
  return db.transaction((tx) => createActivityInTx(tx, input));
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * `createActivity`'s body on a caller-owned transaction, for writers that must
 * commit the activity together with other rows (the send path writes the
 * `email_message` row in the same transaction).
 */
export async function createActivityInTx(tx: DbTransaction, input: NewActivity): Promise<Activity> {
  const lookup = input.personId == null ? resolvePersonIdLookup(input) : null;
  const values =
    lookup && isIdentityDualWriteEnabled() ? { ...input, personId: personIdLookupSql(lookup) } : input;
  const [row] = await tx.insert(activity).values(values).returning();
  if (row!.personId) {
    await recomputePersonStatus(tx, row!.personId);
    // The BD who contacts becomes the owner, in this same transaction.
    if (isOwnerTouchType(row!.type)) await transferOwnersOnTouch(tx, [row!.personId], row!.actorBdId);
  }
  return row!;
}

/**
 * Read side of the Contact record's timeline pane (task 10.1; contact-record
 * spec "Filtered activity timeline"). Not `bdId`-scoped at the row level —
 * same as getContactRecord (queries.ts) — but redacts `metadata` per entry
 * via `buildTimelineEntry` (design R6) before returning, so the caller never
 * has to remember to redact. `opts.viewerIsAdmin` (default closed) is the one
 * way another BD's conversation content stays unredacted.
 *
 * Bug fix (prod smoke test): ordered by `effectiveActivityAtSql()` (the ONE
 * shared SQL helper listQueries.ts also uses), not raw `activity.createdAt`
 * — a HubSpot-imported `status_backfill` row's real time is
 * `metadata.originalAt`, not `created_at` (the migration's own run date), so
 * ordering (and therefore which rows the `limit` keeps) by `created_at`
 * could both mis-rank and wrongly truncate imported history. Each returned
 * entry exposes `at` (effective time, from `buildTimelineEntry`) alongside
 * `createdAt` — see src/lib/activity/timelineEntry.ts.
 *
 * Filters by `pill` (mockup-port fix; contact-record.html:97-106's 6 pills:
 * Todo/Notas/Llamadas/Correos/Reuniones/Sistema), not by a raw
 * `TimelineActivityType`: `TIMELINE_PILL_GROUPS` (timelinePills.ts) is the
 * one place that expands a pill into the DB types it covers, so `system`
 * fans out to all 4 internal/migration types in a single `OR` here instead
 * of the caller (or this function) ever filtering on one raw type alone.
 */
export async function getPersonTimeline(
  personId: string,
  viewerBdId: string,
  opts: { pill?: TimelinePillKey; limit?: number; viewerIsAdmin?: boolean } = {},
): Promise<PersonTimelinePage> {
  const types = opts.pill ? TIMELINE_PILL_GROUPS[opts.pill] : TIMELINE_ACTIVITY_TYPES;
  const notFolded = notFoldedAttemptSql();
  const deleter = alias(bd, "note_deleter");
  const typeCondition = and(eq(activity.personId, personId), or(...types.map((t) => eq(activity.type, t))), notFolded);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: activity.id,
        type: activity.type,
        createdAt: activity.createdAt,
        actorBdId: activity.actorBdId,
        actorName: bd.name,
        metadata: activity.metadata,
        deletedAt: activity.deletedAt,
        deletedByBdId: activity.deletedByBdId,
        deletedByName: deleter.name,
        deletedByRole: deleter.role,
      })
      .from(activity)
      .leftJoin(bd, eq(bd.id, activity.actorBdId))
      .leftJoin(deleter, eq(deleter.id, activity.deletedByBdId))
      .where(typeCondition)
      // DISPLAY time, not "last touch" time — see timelineOrder.ts's doc
      // comment for why this timeline must NOT use `NULLS LAST` here.
      .orderBy(timelineOrderBySql())
      .limit(opts.limit ?? 100),
    db
      .select({ type: activity.type, count: sql<number>`count(*)` })
      .from(activity)
      // A deleted note still renders (as a tombstone) but is not a note any more: it does not count in any pill.
      .where(and(eq(activity.personId, personId), or(...TIMELINE_ACTIVITY_TYPES.map((t) => eq(activity.type, t))), notFolded, isNull(activity.deletedAt)))
      .groupBy(activity.type),
  ]);

  const entries: TimelineEntry[] = rows.map((row) => buildTimelineEntry(row, viewerBdId, opts.viewerIsAdmin ?? false));

  const countsByType: Record<string, number> = {};
  for (const r of countRows) countsByType[r.type] = Number(r.count);

  return { entries, countsByType };
}
