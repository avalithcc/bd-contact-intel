/**
 * Pure ownership rule: the owner of a person is the BD who WORKED the contact
 * LAST. This replaces R3 ("earliest LinkedIn connector owns the contact"),
 * which left 90 live persons owned by a BD who never wrote while another BD
 * did. Connection seniority survives only as a tie-breaker and as the
 * fallback when nobody has touched the contact.
 *
 * The rule runs only at merge time and in the one-shot backfill; nothing
 * re-evaluates it when a BD later works the contact.
 *
 * A BD's last touch is the later of their `person_bd_connection.last_message_at`
 * and their latest activity on the person (`OwnerTouch`, read by
 * ownerRuleDb.ts). Direction does not matter: an inbound reply is still that
 * BD's touch.
 *
 * A manual owner assignment is STICKY: a `person_property_history` row with
 * property `ownerBdId` and source `edit` is the marker (no schema change), and
 * no automatic writer (merge, import, backfill) may move that owner again.
 */
import { parseConnectedOnDate } from "@/lib/migration/connectedOn";

export const OWNER_HISTORY_PROPERTY = "ownerBdId";
/** `updateLeadOwner` used to write this spelling; old manual edits carry it. */
export const LEGACY_OWNER_HISTORY_PROPERTY = "owner_bd_id";
export const OWNER_HISTORY_PROPERTIES: readonly string[] = [OWNER_HISTORY_PROPERTY, LEGACY_OWNER_HISTORY_PROPERTY];
/** The only history source that marks an owner as manually assigned. */
export const MANUAL_OWNER_SOURCE = "edit";
/** Source of history rows written by scripts/backfill-owner-last-worked.ts. Must NEVER equal `edit`, or every backfilled owner would turn sticky. */
export const OWNER_BACKFILL_SOURCE = "owner_backfill";

/**
 * Activity types that do NOT count as working the relationship for ownership.
 *
 * Ownership has a stricter bar than "última actividad": a `call_attempt` is
 * real engagement for the list column, sort and filter (it is deliberately not
 * in NON_TOUCH_ACTIVITY_TYPES), but dialling a number is not building the
 * relationship, and an attempt must never transfer a contact away from the BD
 * who did. The two bars disagree on purpose, so they are two lists and this
 * one must not be merged with, or replaced by, NON_TOUCH_ACTIVITY_TYPES. The
 * task-edit types are not listed here: they already have no effective time.
 */
export const OWNER_IGNORED_ACTIVITY_TYPES = ["call_attempt"] as const;

export function countsForOwnership(activityType: string): boolean {
  return !(OWNER_IGNORED_ACTIVITY_TYPES as readonly string[]).includes(activityType);
}

export interface OwnerHistoryMarker {
  property: string;
  source: string;
}

/** True when the history proves a person's owner was set by hand. */
export function hasManualOwner(history: readonly OwnerHistoryMarker[]): boolean {
  return history.some((h) => h.source === MANUAL_OWNER_SOURCE && OWNER_HISTORY_PROPERTIES.includes(h.property));
}

export interface OwnerConnection {
  bdId: string;
  connectedOn: string | null;
  lastMessageAt: Date | null;
}

/** The latest effective activity time of one BD on the person. */
export interface OwnerTouch {
  bdId: string;
  at: Date;
}

export type OwnerBasis = "last_touch" | "earliest_connection";

/** Pure: never mutates its inputs. `null` means "nobody to decide on" (caller keeps the existing owner). */
export function decideOwner(
  connections: readonly OwnerConnection[],
  touches: readonly OwnerTouch[],
): { bdId: string; basis: OwnerBasis } | null {
  const lastTouch = new Map<string, number>();
  const bump = (bdId: string, at: Date | null) => {
    const time = at?.getTime();
    if (time === undefined || Number.isNaN(time)) return;
    if (time > (lastTouch.get(bdId) ?? -Infinity)) lastTouch.set(bdId, time);
  };
  const earliestConnection = new Map<string, number>();
  for (const c of connections) {
    bump(c.bdId, c.lastMessageAt);
    const parsed = parseConnectedOnDate(c.connectedOn)?.getTime();
    if (parsed !== undefined && parsed < (earliestConnection.get(c.bdId) ?? Infinity)) earliestConnection.set(c.bdId, parsed);
  }
  for (const t of touches) bump(t.bdId, t.at);

  // Seniority: parseable dates ascending, unparseable last; bdId keeps it deterministic.
  const bySeniority = (a: string, b: string) =>
    (earliestConnection.get(a) ?? Infinity) - (earliestConnection.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0);

  if (lastTouch.size > 0) {
    const bdId = [...lastTouch.keys()].sort((a, b) => lastTouch.get(b)! - lastTouch.get(a)! || bySeniority(a, b))[0];
    return { bdId, basis: "last_touch" };
  }
  const bdId = [...earliestConnection.keys()].sort(bySeniority)[0];
  return bdId ? { bdId, basis: "earliest_connection" } : null;
}

export function pickOwnerByLastWorked(connections: readonly OwnerConnection[], touches: readonly OwnerTouch[]): string | null {
  return decideOwner(connections, touches)?.bdId ?? null;
}
