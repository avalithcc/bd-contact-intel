/**
 * "Embudo de contactos" + "Tasa de respuesta" KPI (owner-reporting decision
 * 6). The funnel is the period's own cohort (persons whose `created_at`
 * falls in the selected period, non-merged, optionally owner-scoped) —
 * `newTotal` IS that cohort's size; `contactedOrMore`/`repliedOrMore`/
 * `meeting` are how far those SAME persons have progressed as of now
 * (cumulative — a person in "Reunión" also counts in "Contactado" and
 * "Respondió"). "Tasa de respuesta" reuses these same numbers
 * (Respondió-or-further ÷ Contactado-or-further) rather than a second,
 * separately-scoped query — decision 6 names this the cheap, honest
 * "snapshot ratio" (not real per-cohort reply-latency tracking).
 */

export interface FunnelCounts {
  newTotal: number;
  contactedOrMore: number;
  repliedOrMore: number;
  meeting: number;
  discarded: number;
}

/**
 * The reply-rate tile's own counts: same statuses as `contactedOrMore`/`repliedOrMore`, but current clients (won +
 * active) are left out of numerator and denominator (owner decision 2026-10-19). Optional so callers that only have
 * the everyone-counts fall back to them.
 */
export interface ReplyRateCounts {
  rateContacted: number;
  rateReplied: number;
}

export interface FunnelBreakdown extends FunnelCounts {
  /** The "Tasa de respuesta" tile (clients excluded): percentage, whether it is a rate, and the "replied / contacted" fraction. */
  rateReplyPct: number;
  rateReplyIsRate: boolean;
  rateReplyFraction: string;
  rateContacted: number;
  rateReplied: number;
  contactedPct: number;
  repliedPct: number;
  meetingPct: number;
  discardedPct: number;
  /** Respondió-or-further ÷ Contactado-or-further (decision 6) — the "Tasa de respuesta" KPI. */
  replyRatePct: number;
  /** Same value as replyRatePct, exposed under the funnel row's own label ("% de Contactado"). */
  repliedOfContactedPct: number;
  /** Reunión ÷ Respondió-or-further ("% de Respondió" on the funnel's last row). */
  meetingOfRepliedPct: number;
  /** False when the reply-rate denominator is below MIN_RATE_SAMPLE: the percentage must not be shown as a rate. */
  replyRateIsRate: boolean;
  /** "replied / contacted" raw fraction, shown instead of the percentage when `replyRateIsRate` is false. */
  replyRateFraction: string;
  /** Same rule for Reunión ÷ Respondió-or-further. */
  meetingOfRepliedIsRate: boolean;
  meetingOfRepliedFraction: string;
}

/** Minimum denominator for a ratio to be presented as a rate (1 of 2 is noise, not 50%). */
export const MIN_RATE_SAMPLE = 10;

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

export function buildFunnelBreakdown(counts: FunnelCounts & Partial<ReplyRateCounts>): FunnelBreakdown {
  const replyRatePct = pct(counts.repliedOrMore, counts.contactedOrMore);
  const rateContacted = counts.rateContacted ?? counts.contactedOrMore;
  const rateReplied = counts.rateReplied ?? counts.repliedOrMore;
  return {
    ...counts,
    rateContacted,
    rateReplied,
    rateReplyPct: pct(rateReplied, rateContacted),
    rateReplyIsRate: rateContacted >= MIN_RATE_SAMPLE,
    rateReplyFraction: `${rateReplied} / ${rateContacted}`,
    contactedPct: pct(counts.contactedOrMore, counts.newTotal),
    repliedPct: pct(counts.repliedOrMore, counts.newTotal),
    meetingPct: pct(counts.meeting, counts.newTotal),
    discardedPct: pct(counts.discarded, counts.newTotal),
    replyRatePct,
    repliedOfContactedPct: replyRatePct,
    meetingOfRepliedPct: pct(counts.meeting, counts.repliedOrMore),
    replyRateIsRate: counts.contactedOrMore >= MIN_RATE_SAMPLE,
    replyRateFraction: `${counts.repliedOrMore} / ${counts.contactedOrMore}`,
    meetingOfRepliedIsRate: counts.repliedOrMore >= MIN_RATE_SAMPLE,
    meetingOfRepliedFraction: `${counts.meeting} / ${counts.repliedOrMore}`,
  };
}
