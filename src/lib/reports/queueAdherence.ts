/**
 * "Adherencia a la cola de seguimientos" (owner-reporting: follow-up-queue
 * README decision 3; queueSelection.ts's WORKED_ACTIVITY_TYPES). `assigned`
 * (the denominator) includes `stillPending` — a queued row from a past day
 * nobody ever worked, postponed, or skipped — so a stalled item can never
 * silently inflate the adherence rate by dropping out of the denominator.
 */

export interface QueueAdherenceCounts {
  worked: number;
  postponed: number;
  skipped: number;
  /** `state = 'pending'` rows with no matching activity that day (queueQueries.ts's own "worked today" rule, generalized to any past day). */
  stillPending: number;
}

export interface QueueAdherenceRow extends QueueAdherenceCounts {
  assigned: number;
  adherencePct: number;
  workedPct: number;
  postponedPct: number;
  skippedPct: number;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function buildQueueAdherenceRow(counts: QueueAdherenceCounts): QueueAdherenceRow {
  const assigned = counts.worked + counts.postponed + counts.skipped + counts.stillPending;
  return {
    ...counts,
    assigned,
    adherencePct: pct(counts.worked, assigned),
    workedPct: pct(counts.worked, assigned),
    postponedPct: pct(counts.postponed, assigned),
    skippedPct: pct(counts.skipped, assigned),
  };
}
