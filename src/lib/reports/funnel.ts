/**
 * "Embudo de contactos" + "Tasa de respuesta" KPI (owner-reporting decision
 * 6). The funnel is the period's own cohort (persons whose `created_at`
 * falls in the selected period, non-merged, optionally owner-scoped) —
 * `newTotal` IS that cohort's size; `contactedOrMore`/`repliedOrMore`/
 * `meeting` are how far those SAME persons have progressed as of now
 * (cumulative — a person in "Reunión" also counts in "Contactado" and
 * "Respondió"). That card stays a snapshot by current status on purpose: it
 * answers "the contacts that entered this period — where are they now?".
 *
 * "Tasa de respuesta" does NOT reuse those numbers any more (owner decision
 * 2026-11-06). A rate needs numerator and denominator in the same period and
 * both from dated events, so `rateContacted`/`rateReplied` come from
 * `replyRateEvidence.ts`'s dated query and are REQUIRED here: the old
 * `?? contactedOrMore` / `?? repliedOrMore` fallbacks were the bug itself (a
 * LinkedIn message received in 2012 made a person `replied` today), and the
 * funnel's Respondió row no longer shows a competing "% de Contactado", so the
 * page has exactly one response rate — the dated one.
 */

export interface FunnelCounts {
  newTotal: number;
  contactedOrMore: number;
  repliedOrMore: number;
  meeting: number;
  discarded: number;
}

/**
 * The reply-rate tile's own counts, from the dated query (queries.ts
 * `rpt_rate_scope`): persons with an outreach event inside the period, and the
 * ones among them whose reply event also falls inside it, at or after that
 * first outreach. Current clients (won + active) are left out of both (owner
 * decision 2026-10-19). Required, never optional: a fallback to the snapshot
 * counts is the bug this replaced.
 */
export interface ReplyRateCounts {
  rateContacted: number;
  rateReplied: number;
}

export interface FunnelBreakdown extends FunnelCounts, ReplyRateCounts {
  /** The "Tasa de respuesta" tile: percentage, whether it is a rate, and the "replied / contacted" fraction. */
  rateReplyPct: number;
  rateReplyIsRate: boolean;
  rateReplyFraction: string;
  contactedPct: number;
  repliedPct: number;
  meetingPct: number;
  discardedPct: number;
  /** Reunión ÷ Respondió-or-further ("% de Respondió" on the funnel's last row — a cohort ratio, not a rate over time). */
  meetingOfRepliedPct: number;
  /** False below MIN_RATE_SAMPLE: the fraction is shown instead of the percentage. */
  meetingOfRepliedIsRate: boolean;
  meetingOfRepliedFraction: string;
}

/** Minimum denominator for a ratio to be presented as a rate (1 of 2 is noise, not 50%). */
export const MIN_RATE_SAMPLE = 10;

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

export function buildFunnelBreakdown(counts: FunnelCounts & ReplyRateCounts): FunnelBreakdown {
  const { rateContacted, rateReplied } = counts;
  return {
    ...counts,
    rateReplyPct: pct(rateReplied, rateContacted),
    rateReplyIsRate: rateContacted >= MIN_RATE_SAMPLE,
    rateReplyFraction: `${rateReplied} / ${rateContacted}`,
    contactedPct: pct(counts.contactedOrMore, counts.newTotal),
    repliedPct: pct(counts.repliedOrMore, counts.newTotal),
    meetingPct: pct(counts.meeting, counts.newTotal),
    discardedPct: pct(counts.discarded, counts.newTotal),
    meetingOfRepliedPct: pct(counts.meeting, counts.repliedOrMore),
    meetingOfRepliedIsRate: counts.repliedOrMore >= MIN_RATE_SAMPLE,
    meetingOfRepliedFraction: `${counts.meeting} / ${counts.repliedOrMore}`,
  };
}
