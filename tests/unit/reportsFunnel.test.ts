/**
 * Unit tests for src/lib/reports/funnel.ts — "Embudo de contactos" +
 * "Tasa de respuesta" KPI (owner-reporting decision 6: a snapshot ratio
 * over the SAME period-scoped cohort the funnel card itself shows, not a
 * separate all-time global ratio and not per-cohort reply tracking).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFunnelBreakdown } from "@/lib/reports/funnel";

test("buildFunnelBreakdown computes each stage's percentage of the funnel's own 'new' total", () => {
  const b = buildFunnelBreakdown({ newTotal: 184, contactedOrMore: 96, repliedOrMore: 41, meeting: 12, discarded: 15 });
  assert.equal(b.newTotal, 184);
  assert.equal(b.contactedOrMore, 96);
  assert.equal(b.contactedPct, 52); // round(96/184*100)
  assert.equal(b.repliedPct, 22); // round(41/184*100)
  assert.equal(b.meetingPct, 7); // round(12/184*100)
  assert.equal(b.discardedPct, 8); // round(15/184*100)
});

test("buildFunnelBreakdown's replyRatePct is Respondió-or-further ÷ Contactado-or-further (decision 6), not ÷ newTotal", () => {
  const b = buildFunnelBreakdown({ newTotal: 184, contactedOrMore: 96, repliedOrMore: 41, meeting: 12, discarded: 15 });
  assert.equal(b.replyRatePct, 43); // round(41/96*100) = 42.7 -> 43
});

test("buildFunnelBreakdown's repliedOfContactedPct (the funnel row's own '% de Contactado') matches replyRatePct", () => {
  const b = buildFunnelBreakdown({ newTotal: 184, contactedOrMore: 96, repliedOrMore: 41, meeting: 12, discarded: 15 });
  assert.equal(b.repliedOfContactedPct, b.replyRatePct);
});

test("buildFunnelBreakdown's meetingOfRepliedPct is Reunión ÷ Respondió-or-further", () => {
  const b = buildFunnelBreakdown({ newTotal: 184, contactedOrMore: 96, repliedOrMore: 41, meeting: 12, discarded: 15 });
  assert.equal(b.meetingOfRepliedPct, 29); // round(12/41*100) = 29.27
});

test("buildFunnelBreakdown never divides by zero: an empty period yields all-zero percentages, not NaN", () => {
  const b = buildFunnelBreakdown({ newTotal: 0, contactedOrMore: 0, repliedOrMore: 0, meeting: 0, discarded: 0 });
  assert.deepEqual(
    [b.contactedPct, b.repliedPct, b.meetingPct, b.discardedPct, b.replyRatePct, b.repliedOfContactedPct, b.meetingOfRepliedPct],
    [0, 0, 0, 0, 0, 0, 0],
  );
});

test("buildFunnelBreakdown never mutates its input", () => {
  const input = { newTotal: 184, contactedOrMore: 96, repliedOrMore: 41, meeting: 12, discarded: 15 };
  const clone = { ...input };
  buildFunnelBreakdown(input);
  assert.deepEqual(input, clone);
});
