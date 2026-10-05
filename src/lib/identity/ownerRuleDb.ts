/**
 * DB reads feeding the pure owner rule (ownerRule.ts). Each is ONE statement,
 * set-based, and takes an optional id list (omitted = every person, for the
 * owner-run backfill). Not unit-tested directly (needs a DB): the rule they
 * feed is tested in ownerRule.test.ts.
 */
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { activity, personPropertyHistory } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { hasManualOwner, MANUAL_OWNER_SOURCE, OWNER_HISTORY_PROPERTIES } from "@/lib/identity/ownerRule";

type Executor = Pick<typeof db, "select">;

/** Ids (among `personIds`, or all) whose owner was set by hand. */
export async function readManualOwnerPersonIds(executor: Executor, personIds?: readonly string[]): Promise<Set<string>> {
  if (personIds && personIds.length === 0) return new Set();
  const rows = await executor
    .select({ personId: personPropertyHistory.personId, property: personPropertyHistory.property, source: personPropertyHistory.source })
    .from(personPropertyHistory)
    .where(
      and(
        inArray(personPropertyHistory.property, [...OWNER_HISTORY_PROPERTIES]),
        sql`${personPropertyHistory.source} = ${MANUAL_OWNER_SOURCE}`,
        personIds ? inArray(personPropertyHistory.personId, [...personIds]) : undefined,
      ),
    );
  return new Set(rows.filter((r) => hasManualOwner([r])).map((r) => r.personId));
}

/**
 * Latest effective activity time per (person, BD): `person_id` + `actor_bd_id`
 * + the shared effective-time rule (status_backfill uses metadata.originalAt;
 * task edits are not touches), never the denormalized contact_owner_bd_id.
 */
export async function readOwnerTouches(
  executor: Executor,
  personIds?: readonly string[],
): Promise<{ personId: string; bdId: string; at: Date }[]> {
  if (personIds && personIds.length === 0) return [];
  const rows = await executor
    .select({
      personId: activity.personId,
      bdId: activity.actorBdId,
      lastAt: sql<Date | string | null>`max(${effectiveActivityAtSql()})`,
    })
    .from(activity)
    .where(and(isNotNull(activity.personId), isNotNull(activity.actorBdId), personIds ? inArray(activity.personId, [...personIds]) : undefined))
    .groupBy(activity.personId, activity.actorBdId);
  const touches: { personId: string; bdId: string; at: Date }[] = [];
  for (const r of rows) {
    if (!r.personId || !r.bdId || !r.lastAt) continue;
    const at = new Date(r.lastAt);
    if (!Number.isNaN(at.getTime())) touches.push({ personId: r.personId, bdId: r.bdId, at });
  }
  return touches;
}
