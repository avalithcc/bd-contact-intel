/**
 * The per-day send cap and the release order (design D7), as one pure function. The cap lives HERE, in the code that
 * releases sends, not only in the Sequence form: the form can be bypassed, this cannot.
 *
 * Budget per sending ACCOUNT per Miami day = max(0, min(daily caps of the Sequences that have a due candidate)
 * - sends already recorded today). Counting per account, across Sequences, is what stops splitting work over two
 * Sequences from bypassing the cap; taking the MINIMUM means two caps on one account resolve to the lower one (owner
 * rule); clamping at zero covers a cap edited below what was already sent. Steps 1 and 2 share the budget. Over-budget
 * members are `deferred`: they stay `approved` and NOTHING is written for them (the spec forbids dropping or
 * auto-cancelling them, and a hold would tell the BD something is wrong when nothing is).
 *
 * Nothing is released before 09:00 Miami on the run's own Miami day, whatever a step's stored due instant says: a
 * Sequence `hour` earlier than 9 (parseSchedule allows 0-23), or the 13:00 UTC cron firing at 08:00 under EST, must not
 * send early. Callers pass only members that already survived the pre-send checks, so a held member never uses budget.
 */
import { miamiCalendarDate, miamiWallClockToUtc } from "./miamiTime";

export const RELEASE_FLOOR_HOUR = 9;

export interface PlanCandidate {
  /** The member id: unique per run (a member is at step 1 or at step 2, never both). Final tie-break of the order. */
  id: string;
  accountId: string;
  sequenceId: string;
  dailyCap: number;
  step: 1 | 2;
  dueAt: Date;
  approvedAt: Date;
}

export interface ReleasePlanInput<T extends PlanCandidate> {
  now: Date;
  candidates: readonly T[];
  /** Recorded `outcome = 'sent'` claims per account for the run's Miami day. Absent = 0. Failed and pending never count. */
  sentToday: ReadonlyMap<string, number>;
}

const byOrder = (a: PlanCandidate, b: PlanCandidate) =>
  a.dueAt.getTime() - b.dueAt.getTime() || a.approvedAt.getTime() - b.approvedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function planSequenceRelease<T extends PlanCandidate>(input: ReleasePlanInput<T>): { release: T[]; deferred: T[] } {
  const { now, sentToday } = input;
  const due = input.candidates.filter((c) => c.dueAt.getTime() <= now.getTime()).sort(byOrder);
  const beforeFloor = now.getTime() < miamiWallClockToUtc(miamiCalendarDate(now), RELEASE_FLOOR_HOUR).getTime();

  const lowestCap = new Map<string, number>();
  for (const c of due) lowestCap.set(c.accountId, Math.min(lowestCap.get(c.accountId) ?? Infinity, c.dailyCap));
  const budget = new Map([...lowestCap].map(([account, cap]) => [account, Math.max(0, cap - (sentToday.get(account) ?? 0))]));

  const release: T[] = [];
  const deferred: T[] = [];
  for (const c of due) {
    const left = budget.get(c.accountId) ?? 0;
    if (beforeFloor || left <= 0) {
      deferred.push(c);
      continue;
    }
    budget.set(c.accountId, left - 1);
    release.push(c);
  }
  return { release, deferred };
}
