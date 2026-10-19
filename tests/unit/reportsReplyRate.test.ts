/**
 * The reply-rate tile reads its own counts (current clients excluded); the funnel rows keep the everyone-counts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFunnelBreakdown } from "@/lib/reports/funnel";

const COUNTS = { newTotal: 100, contactedOrMore: 60, repliedOrMore: 30, meeting: 5, discarded: 4 };

test("the reply-rate tile uses the client-excluded counts, the funnel row keeps everyone", () => {
  const b = buildFunnelBreakdown({ ...COUNTS, rateContacted: 40, rateReplied: 10 });
  assert.equal(b.rateReplyPct, 25);
  assert.equal(b.rateReplyFraction, "10 / 40");
  assert.equal(b.rateReplyIsRate, true);
  assert.equal(b.replyRatePct, 50, "funnel '% de Contactado' unchanged");
  assert.equal(b.repliedOfContactedPct, 50);
});

test("rateReplyIsRate follows the excluded denominator, not the funnel's", () => {
  const b = buildFunnelBreakdown({ ...COUNTS, rateContacted: 9, rateReplied: 3 });
  assert.equal(b.rateReplyIsRate, false);
  assert.equal(b.replyRateIsRate, true);
});

test("without rate counts the tile falls back to the funnel counts, and the input is not mutated", () => {
  const input = { ...COUNTS };
  const b = buildFunnelBreakdown(input);
  assert.equal(b.rateReplyPct, b.replyRatePct);
  assert.deepEqual(input, COUNTS);
});
