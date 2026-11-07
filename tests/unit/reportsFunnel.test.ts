/**
 * Unit tests for src/lib/reports/funnel.ts.
 *
 * "Embudo de contactos" is still a snapshot of the period's cohort by current
 * status (owner-reporting decision 6) — that card did not change. What changed
 * (owner decision 2026-11-06) is that "Tasa de respuesta" no longer derives
 * from those same numbers: `rateContacted`/`rateReplied` arrive from the dated
 * query and are REQUIRED, with no fallback to the snapshot counts, and the
 * funnel's Respondió row no longer publishes a competing "% de Contactado".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_RATE_SAMPLE, buildFunnelBreakdown } from "@/lib/reports/funnel";

const COHORT = { newTotal: 184, contactedOrMore: 96, repliedOrMore: 41, meeting: 12, discarded: 15 };
const RATE = { rateContacted: 61, rateReplied: 4 };

test("buildFunnelBreakdown computes each stage's percentage of the funnel's own 'new' total", () => {
  const b = buildFunnelBreakdown({ ...COHORT, ...RATE });
  assert.equal(b.newTotal, 184);
  assert.equal(b.contactedOrMore, 96);
  assert.equal(b.contactedPct, 52); // round(96/184*100)
  assert.equal(b.repliedPct, 22); // round(41/184*100)
  assert.equal(b.meetingPct, 7); // round(12/184*100)
  assert.equal(b.discardedPct, 8); // round(15/184*100)
});

test("the only response rate on the page is the dated one: replied ÷ contacted in the period", () => {
  const b = buildFunnelBreakdown({ ...COHORT, ...RATE });
  assert.equal(b.rateReplyPct, 7); // round(4/61*100) = 6.6 -> 7
  assert.equal(b.rateReplyFraction, "4 / 61");
  assert.notEqual(b.rateReplyPct, Math.round((COHORT.repliedOrMore / COHORT.contactedOrMore) * 100), "never the snapshot ratio");
});

test("buildFunnelBreakdown's meetingOfRepliedPct is Reunión ÷ Respondió-or-further (the cohort card's own ratio, unchanged)", () => {
  const b = buildFunnelBreakdown({ ...COHORT, ...RATE });
  assert.equal(b.meetingOfRepliedPct, 29); // round(12/41*100) = 29.27
});

test("buildFunnelBreakdown never divides by zero: an empty period yields all-zero percentages, not NaN", () => {
  const b = buildFunnelBreakdown({ newTotal: 0, contactedOrMore: 0, repliedOrMore: 0, meeting: 0, discarded: 0, rateContacted: 0, rateReplied: 0 });
  assert.deepEqual([b.contactedPct, b.repliedPct, b.meetingPct, b.discardedPct, b.rateReplyPct, b.meetingOfRepliedPct], [0, 0, 0, 0, 0, 0]);
});

test("buildFunnelBreakdown never mutates its input", () => {
  const input = { ...COHORT, ...RATE };
  const clone = { ...input };
  buildFunnelBreakdown(input);
  buildFunnelBreakdown(input);
  assert.deepEqual(input, clone);
});

test("MIN_RATE_SAMPLE is 10", () => {
  assert.equal(MIN_RATE_SAMPLE, 10);
});

test("production case 1 of 2 is NOT presented as a rate", () => {
  const b = buildFunnelBreakdown({ newTotal: 200, contactedOrMore: 2, repliedOrMore: 1, meeting: 0, discarded: 0, rateContacted: 2, rateReplied: 1 });
  assert.equal(b.rateReplyPct, 50); // maths unchanged
  assert.equal(b.rateReplyIsRate, false);
  assert.equal(b.rateReplyFraction, "1 / 2");
  assert.equal(b.meetingOfRepliedIsRate, false);
  assert.equal(b.meetingOfRepliedFraction, "0 / 1");
});

test("rate is presented at exactly MIN_RATE_SAMPLE, not below", () => {
  const at = buildFunnelBreakdown({ newTotal: 50, contactedOrMore: 10, repliedOrMore: 10, meeting: 5, discarded: 0, rateContacted: 10, rateReplied: 10 });
  assert.equal(at.rateReplyIsRate, true);
  assert.equal(at.meetingOfRepliedIsRate, true);
  const below = buildFunnelBreakdown({ newTotal: 50, contactedOrMore: 9, repliedOrMore: 9, meeting: 5, discarded: 0, rateContacted: 9, rateReplied: 9 });
  assert.equal(below.rateReplyIsRate, false);
  assert.equal(below.meetingOfRepliedIsRate, false);
});

test("the dated denominator alone decides whether the tile shows a percentage", () => {
  // The cohort is large, but only 3 people were actually contacted in the period.
  const b = buildFunnelBreakdown({ ...COHORT, rateContacted: 3, rateReplied: 1 });
  assert.equal(b.rateReplyIsRate, false, "96 cohort contacts must not promote a 3-person sample to a rate");
  assert.equal(b.rateReplyFraction, "1 / 3");
});

test("zero denominator is not a rate and yields a 0 / 0 fraction", () => {
  const b = buildFunnelBreakdown({ newTotal: 0, contactedOrMore: 0, repliedOrMore: 0, meeting: 0, discarded: 0, rateContacted: 0, rateReplied: 0 });
  assert.equal(b.rateReplyIsRate, false);
  assert.equal(b.rateReplyFraction, "0 / 0");
});
