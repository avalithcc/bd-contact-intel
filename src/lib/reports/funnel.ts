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

export interface FunnelBreakdown extends FunnelCounts {
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
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

export function buildFunnelBreakdown(counts: FunnelCounts): FunnelBreakdown {
  const replyRatePct = pct(counts.repliedOrMore, counts.contactedOrMore);
  return {
    ...counts,
    contactedPct: pct(counts.contactedOrMore, counts.newTotal),
    repliedPct: pct(counts.repliedOrMore, counts.newTotal),
    meetingPct: pct(counts.meeting, counts.newTotal),
    discardedPct: pct(counts.discarded, counts.newTotal),
    replyRatePct,
    repliedOfContactedPct: replyRatePct,
    meetingOfRepliedPct: pct(counts.meeting, counts.repliedOrMore),
  };
}
