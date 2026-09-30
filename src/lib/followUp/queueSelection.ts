/**
 * Pure eligibility/ordering rules for the per-BD daily follow-up queue
 * (openspec/decisions/2026-09-30-decision-brief.md, "1. Follow-up cadence —
 * decided"; openspec/changes/follow-up-queue/mockups/README.md). This is
 * the ONE place the rule is expressed and unit-tested; the production
 * candidate query (src/lib/followUp/candidateQuery.ts) computes the same
 * thresholds directly in SQL for the real per-BD round trip (rule: the
 * selection query must be ONE round trip, so eligibility can't be resolved
 * by pulling the whole table into JS) — this module exists to pin the rule
 * (same relationship as effectiveActivityTime.ts's JS helper vs. its SQL
 * twin `effectiveActivityAtSql()`).
 *
 * `selectFollowUpQueue` is a pure planner (never mutates `candidates`) so it
 * can be called repeatedly (e.g. once per render) without surprises — see
 * its "never mutates its input" test.
 */
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

export const FOLLOW_UP_REPLIED_THRESHOLD_DAYS = 3;
export const FOLLOW_UP_CONTACTED_THRESHOLD_DAYS = 7;
export const FOLLOW_UP_RECENCY_MONTHS = 12;
export const FOLLOW_UP_DAILY_CAP = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type FollowUpEligibleStatus = "contacted" | "replied";

/** One candidate contact, already scoped to persons whose `status` is
 * `contacted`/`replied` by the caller's SQL — but re-checked here too, so
 * this function stays correct even if a caller passes a wider set. */
export interface FollowUpCandidate {
  personId: string;
  ownerBdId: string | null;
  merged: boolean;
  status: string;
  lastTouchAt: Date | null;
  companyName: string | null;
  /** ART calendar date (`YYYY-MM-DD`) this candidate becomes selectable
   * again, or `null` if never snoozed. See queueSelection.ts's module doc
   * comment for why this rarely matters in production (the day's set never
   * refills) but is still part of the pure rule. */
  snoozedUntil: string | null;
}

export interface SelectedFollowUpItem {
  personId: string;
  status: FollowUpEligibleStatus;
  lastTouchAt: Date;
  companyName: string | null;
  /** 1-based display order. */
  position: number;
}

function daysSince(at: Date, now: Date): number {
  return (now.getTime() - at.getTime()) / MS_PER_DAY;
}

/** Due thresholds from the decision brief: `replied` at 3+ days since the
 * last touch, `contacted` at 7+ days. Boundary is inclusive (`>=`). */
export function isDueForFollowUp(status: FollowUpEligibleStatus, lastTouchAt: Date, now: Date): boolean {
  const days = daysSince(lastTouchAt, now);
  return status === "replied" ? days >= FOLLOW_UP_REPLIED_THRESHOLD_DAYS : days >= FOLLOW_UP_CONTACTED_THRESHOLD_DAYS;
}

/** 12-month recency window (decision brief: older contacts stay in
 * Outreach's `dormant` tier, not this queue). Boundary is inclusive. */
export function isWithinRecencyWindow(
  lastTouchAt: Date,
  now: Date,
  months: number = FOLLOW_UP_RECENCY_MONTHS,
): boolean {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return lastTouchAt >= cutoff;
}

function isEligibleStatus(status: string): status is FollowUpEligibleStatus {
  return status === "contacted" || status === "replied";
}

/**
 * Selects, orders and caps one BD's follow-up queue for `now`. Never
 * mutates `candidates` (filters into a new array, clones before sorting) —
 * calling this twice with the same input must return the same result.
 */
export function selectFollowUpQueue(
  candidates: readonly FollowUpCandidate[],
  bdId: string,
  now: Date,
  cap: number = FOLLOW_UP_DAILY_CAP,
): SelectedFollowUpItem[] {
  const today = argentinaCalendarDate(now);

  const eligible = candidates.filter((c): c is FollowUpCandidate & { status: FollowUpEligibleStatus; lastTouchAt: Date } => {
    if (c.ownerBdId !== bdId) return false;
    if (c.merged) return false;
    if (!isEligibleStatus(c.status)) return false;
    if (!c.lastTouchAt) return false;
    if (!isWithinRecencyWindow(c.lastTouchAt, now)) return false;
    if (!isDueForFollowUp(c.status, c.lastTouchAt, now)) return false;
    if (c.snoozedUntil && c.snoozedUntil > today) return false;
    return true;
  });

  const ordered = [...eligible].sort((a, b) => {
    if (a.status !== b.status) return a.status === "replied" ? -1 : 1;
    const byTouch = b.lastTouchAt.getTime() - a.lastTouchAt.getTime();
    if (byTouch !== 0) return byTouch;
    return (a.companyName ?? "").localeCompare(b.companyName ?? "");
  });

  return ordered.slice(0, cap).map((c, i) => ({
    personId: c.personId,
    status: c.status,
    lastTouchAt: c.lastTouchAt,
    companyName: c.companyName,
    position: i + 1,
  }));
}

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

export interface WorkedActivityRow {
  type: string;
  createdAt: Date;
  actorBdId: string | null;
}

/**
 * "Worked" = a counted activity was LOGGED (created) by this BD today, on
 * the Argentina calendar day — deliberately `createdAt`, not the "effective
 * activity time" (`effectiveActivityAtSql`/`resolveEffectiveActivityAt`)
 * used elsewhere for last-touch/status derivation. Those two concepts read
 * different things: effective time can backdate a `call`'s `occurredAt` to
 * a day before it was logged, but the BD still did the work of logging it
 * today — this function must not conflate the two.
 */
export function wasWorkedToday(activities: readonly WorkedActivityRow[], bdId: string, now: Date): boolean {
  const today = argentinaCalendarDate(now);
  return activities.some(
    (a) => WORKED_ACTIVITY_TYPES.has(a.type) && a.actorBdId === bdId && argentinaCalendarDate(a.createdAt) === today,
  );
}
