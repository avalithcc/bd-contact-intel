import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd, type Activity, type NewActivity } from "@/db/schema";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { personIdLookupSql } from "@/lib/identity/resolveDb";
import { resolvePersonIdLookup } from "@/lib/identity/referenceWrite";
import { recomputePersonStatus } from "@/lib/status/recompute";
import { isTimelineEntryVisible } from "@/lib/activity/timelineVisibility";

/** Activity types the Contact record's timeline pane renders (task 10.1). */
export const TIMELINE_ACTIVITY_TYPES = [
  "note",
  "email_sent",
  "hunter_lookup",
  "status_change",
  "meeting_logged",
  "discarded",
  "status_backfill",
] as const;

export type TimelineActivityType = (typeof TIMELINE_ACTIVITY_TYPES)[number];

export function isTimelineActivityType(value: string): value is TimelineActivityType {
  return (TIMELINE_ACTIVITY_TYPES as readonly string[]).includes(value);
}

export interface TimelineEntry {
  id: string;
  type: string;
  createdAt: Date;
  actorBdId: string | null;
  actorName: string | null;
  // Redacted to null when isTimelineEntryVisible() says this viewer may not
  // see this entry's content (design R6 / admin-access-audit).
  metadata: Record<string, unknown> | null;
  visible: boolean;
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

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

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
    .where(eq(activity.leadId, leadId))
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
    .where(eq(activity.companyKey, companyKey))
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
    .where(eq(activity.contactId, contactId))
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
  const lookup = input.personId == null ? resolvePersonIdLookup(input) : null;
  const values =
    lookup && isIdentityDualWriteEnabled() ? { ...input, personId: personIdLookupSql(lookup) } : input;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(activity).values(values).returning();
    if (row!.personId) await recomputePersonStatus(tx, row!.personId);
    return row!;
  });
}

/**
 * Read side of the Contact record's timeline pane (task 10.1; contact-record
 * spec "Filtered activity timeline"). Not `bdId`-scoped at the row level —
 * same as getContactRecord (queries.ts) — but redacts `metadata` per entry
 * via `isTimelineEntryVisible` (design R6) before returning, so the caller
 * never has to remember to redact.
 */
export async function getPersonTimeline(
  personId: string,
  viewerBdId: string,
  opts: { type?: TimelineActivityType; limit?: number } = {},
): Promise<PersonTimelinePage> {
  const typeCondition = opts.type
    ? and(eq(activity.personId, personId), eq(activity.type, opts.type))
    : and(eq(activity.personId, personId), or(...TIMELINE_ACTIVITY_TYPES.map((t) => eq(activity.type, t))));

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: activity.id,
        type: activity.type,
        createdAt: activity.createdAt,
        actorBdId: activity.actorBdId,
        actorName: bd.name,
        metadata: activity.metadata,
      })
      .from(activity)
      .leftJoin(bd, eq(bd.id, activity.actorBdId))
      .where(typeCondition)
      .orderBy(desc(activity.createdAt))
      .limit(opts.limit ?? 100),
    db
      .select({ type: activity.type, count: sql<number>`count(*)` })
      .from(activity)
      .where(and(eq(activity.personId, personId), or(...TIMELINE_ACTIVITY_TYPES.map((t) => eq(activity.type, t)))))
      .groupBy(activity.type),
  ]);

  const entries: TimelineEntry[] = rows.map((row) => {
    const visible = isTimelineEntryVisible({ type: row.type, actorBdId: row.actorBdId }, viewerBdId);
    return {
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      actorBdId: row.actorBdId,
      actorName: row.actorName,
      metadata: visible ? (row.metadata as Record<string, unknown>) : null,
      visible,
    };
  });

  const countsByType: Record<string, number> = {};
  for (const r of countRows) countsByType[r.type] = Number(r.count);

  return { entries, countsByType };
}
