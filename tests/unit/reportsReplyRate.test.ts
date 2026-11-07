/**
 * "Tasa de respuesta" (owner decision 2026-11-06): numerator AND denominator
 * come from DATED events inside the same period, never from the `person.status`
 * cache over the persons CREATED in the period.
 *
 * Prod measurement that forced this (scripts/measure/reply-rate-evidence.ts,
 * 2026-11-06): the tile showed 3029/8644 = 35.0% all-time while only 197
 * persons had real dated reply evidence (2.3%); 2832 were in the numerator
 * ONLY through `person_bd_connection.received_count`, and 2827 of those had
 * their last received LinkedIn message BEFORE their own `created_at` (880 days
 * before on average, oldest message 2012-01-03).
 *
 * LinkedIn `message` rows are not evidence either (owner decision 2026-11-06):
 * the evidence is `activity` alone. See replyRateEvidence.ts's doc comment for
 * the 83% / 55.8%-vs-36.7% measurement behind that, and
 * tests/db/reportsClientsAndPeriods.test.ts for the real-SQL pin that imported
 * chat traffic moves neither side.
 *
 * These tests pin the pure twin of the SQL rule (replyRateEvidence.ts). The
 * real-SQL agreement is pinned by tests/db/reportsClientsAndPeriods.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFunnelBreakdown } from "@/lib/reports/funnel";
import { RATE_EVENT_ACTIVITY_TYPES, rateActivityEvent, resolveRateOutcome, type RateEvent } from "@/lib/reports/replyRateEvidence";
import { STATUS_NEUTRAL_ACTIVITY_TYPES } from "@/lib/status/deriveStatus";

const FROM = "2026-10-01T03:00:00.000Z";
const TO = "2026-11-01T03:00:00.000Z";

function act(type: string, at: string, metadata: unknown = null): RateEvent | null {
  return rateActivityEvent({ id: `${type}@${at}`, type, createdAt: new Date(at), metadata });
}

function outcome(events: readonly (RateEvent | null)[]) {
  return resolveRateOutcome(events.filter((e): e is RateEvent => e !== null), FROM, TO);
}

test("(a) a reply received BEFORE the period never counts, however much outreach happened inside it", () => {
  const o = outcome([act("reply_received", "2026-09-11T12:00:00Z"), act("email_sent", "2026-10-07T13:00:00Z")]);
  assert.equal(o.contacted, true, "the October email is the denominator");
  assert.equal(o.replied, false, "a September reply is not an October reply");
  assert.equal(o.replyAt, null);
});

test("(b) a reply inside the period but BEFORE that period's first outreach does not count", () => {
  const o = outcome([act("reply_received", "2026-10-02T09:00:00Z"), act("email_sent", "2026-10-07T13:00:00Z")]);
  assert.equal(o.contacted, true);
  assert.equal(o.replied, false, "the reply predates the outreach it would be credited to");
});

test("(c) a reply after the period's first outreach counts, and its date is the one shown", () => {
  const o = outcome([
    act("email_sent", "2026-10-07T13:00:00Z"),
    act("reply_received", "2026-10-09T10:00:00Z"),
    act("reply_received", "2026-10-20T10:00:00Z"),
  ]);
  assert.equal(o.replied, true);
  assert.equal(o.replyAt?.toISOString(), "2026-10-09T10:00:00.000Z", "the FIRST qualifying reply, not the latest");
  assert.equal(o.firstOutreachAt?.toISOString(), "2026-10-07T13:00:00.000Z");
});

test("(c2) a reply before the first outreach followed by one after it: the LATER, qualifying one is the date shown", () => {
  const o = outcome([
    act("reply_received", "2026-10-08T10:00:00Z"),
    act("email_sent", "2026-10-10T13:00:00Z"),
    act("reply_received", "2026-10-13T10:00:00Z"),
  ]);
  assert.equal(o.replied, true);
  assert.equal(o.replyAt?.toISOString(), "2026-10-13T10:00:00.000Z");
});

test("(d) a person contacted in the period who never replied is in the denominator only", () => {
  const o = outcome([act("email_sent", "2026-10-07T13:00:00Z"), act("call", "2026-10-08T10:00:00Z", { direction: "outbound", outcome: "no_answer" })]);
  assert.equal(o.contacted, true);
  assert.equal(o.replied, false);
});

test("(e) a person who replied in the period but was contacted in an EARLIER one is in neither count", () => {
  const o = outcome([act("email_sent", "2026-09-12T13:00:00Z"), act("reply_received", "2026-10-03T08:00:00Z")]);
  assert.equal(o.contacted, false, "no outreach event inside the window: not in the denominator");
  assert.equal(o.replied, false, "and therefore not in the numerator either");
});

test("(f) auto_reply_received and call_attempt still move nothing", () => {
  assert.equal(act("auto_reply_received", "2026-10-09T10:00:00Z"), null);
  assert.equal(act("call_attempt", "2026-10-09T10:00:00Z", { direction: "outbound" }), null);
  assert.equal(act("whatsapp_no_channel", "2026-10-09T10:00:00Z"), null);
  assert.equal(act("email_bounced", "2026-10-09T10:00:00Z"), null);
  assert.equal(act("meeting_scheduled", "2026-10-09T10:00:00Z"), null);
  const o = outcome([
    act("email_sent", "2026-10-07T13:00:00Z"),
    act("auto_reply_received", "2026-10-09T10:00:00Z"),
    act("call_attempt", "2026-10-10T10:00:00Z", { direction: "outbound" }),
  ]);
  assert.equal(o.contacted, true);
  assert.equal(o.replied, false);
});

test("the rate's activity types never overlap the status-neutral list (the guard, not an accident)", () => {
  const neutral = new Set<string>(STATUS_NEUTRAL_ACTIVITY_TYPES);
  for (const type of RATE_EVENT_ACTIVITY_TYPES) {
    assert.equal(neutral.has(type), false, `${type} is status-neutral and must not be rate evidence`);
  }
});

test("each evidence row is classified exactly the way deriveStatus reads it", () => {
  assert.deepEqual(pick(act("email_sent", "2026-10-07T13:00:00Z")), { outreach: true, reply: false });
  assert.deepEqual(pick(act("call", "2026-10-07T13:00:00Z", { direction: "outbound", outcome: "no_answer" })), { outreach: true, reply: false });
  assert.deepEqual(pick(act("call", "2026-10-07T13:00:00Z", { direction: "outbound", outcome: "connected" })), { outreach: true, reply: true });
  assert.deepEqual(pick(act("call", "2026-10-07T13:00:00Z", { direction: "inbound", outcome: "connected" })), { outreach: false, reply: true });
  assert.equal(act("call", "2026-10-07T13:00:00Z", { direction: "inbound", outcome: "no_answer" }), null);
  assert.deepEqual(pick(act("whatsapp", "2026-10-07T13:00:00Z", { outcome: "sent" })), { outreach: true, reply: false });
  assert.deepEqual(pick(act("whatsapp", "2026-10-07T13:00:00Z", { outcome: "replied" })), { outreach: false, reply: true });
  assert.deepEqual(pick(act("reply_received", "2026-10-07T13:00:00Z")), { outreach: false, reply: true });
  assert.deepEqual(pick(act("meeting_logged", "2026-10-07T13:00:00Z")), { outreach: false, reply: true });
  assert.deepEqual(pick(act("status_change", "2026-10-07T13:00:00Z", { status: "contacted" })), { outreach: true, reply: false });
  assert.equal(act("status_change", "2026-10-07T13:00:00Z", { status: "discarded" }), null);
  assert.equal(act("note", "2026-10-07T13:00:00Z"), null);
});

test("a manual move to Respondió/Reunión is reply evidence ONLY: one click must not manufacture its own outreach", () => {
  for (const status of ["replied", "meeting"]) {
    for (const type of ["status_change", "status_backfill"]) {
      assert.deepEqual(pick(act(type, "2026-10-07T13:00:00Z", { status })), { outreach: false, reply: true }, `${type} -> ${status}`);
    }
  }
  // ...so a person whose ONLY October evidence is that click has no dated outreach and leaves the rate entirely.
  const o = outcome([act("status_change", "2026-10-07T13:00:00Z", { status: "replied" })]);
  assert.equal(o.contacted, false, "not in the denominator");
  assert.equal(o.replied, false, "and therefore not in the numerator: no guaranteed 1/1");
  // A real dated sequence still counts.
  const real = outcome([
    act("status_change", "2026-10-05T13:00:00Z", { status: "contacted" }),
    act("status_change", "2026-10-09T13:00:00Z", { status: "replied" }),
  ]);
  assert.deepEqual([real.contacted, real.replied, real.replyAt?.toISOString()], [true, true, "2026-10-09T13:00:00.000Z"]);
});

test("an OUTBOUND connected call stays both the touch and the conversation (owner rule 2026-09-26, deliberate)", () => {
  const o = outcome([act("call", "2026-10-07T13:00:00Z", { direction: "outbound", outcome: "connected" })]);
  assert.deepEqual([o.contacted, o.replied], [true, true]);
  assert.equal(o.replyAt?.toISOString(), "2026-10-07T13:00:00.000Z");
});

function pick(event: RateEvent | null) {
  assert.ok(event, "expected this row to be rate evidence");
  return { outreach: event.outreach, reply: event.reply };
}

test("a status_backfill row is dated by metadata.originalAt, so imported history stays out of the period", () => {
  const backfill = act("status_backfill", "2026-10-15T12:00:00Z", { status: "replied", originalAt: "2023-02-01T10:00:00.000Z" });
  assert.equal(backfill?.at.toISOString(), "2023-02-01T10:00:00.000Z");
  const o = outcome([act("email_sent", "2026-10-07T13:00:00Z"), backfill]);
  assert.equal(o.contacted, true);
  assert.equal(o.replied, false, "the backfill reconstructs a 2023 event, not an October one");
});

test("resolveRateOutcome is pure: same input twice, same result, nothing mutated", () => {
  const events = [act("email_sent", "2026-10-07T13:00:00Z"), act("reply_received", "2026-10-09T10:00:00Z")].filter(
    (e): e is RateEvent => e !== null,
  );
  const snapshot = events.map((e) => ({ at: e.at.toISOString(), outreach: e.outreach, reply: e.reply }));
  const first = resolveRateOutcome(events, FROM, TO);
  const second = resolveRateOutcome(events, FROM, TO);
  assert.deepEqual(first, second);
  assert.deepEqual(
    events.map((e) => ({ at: e.at.toISOString(), outreach: e.outreach, reply: e.reply })),
    snapshot,
  );
});

test("the tile's percentage is replied ÷ contacted, both dated, with no snapshot fallback left", () => {
  const b = buildFunnelBreakdown({ newTotal: 100, contactedOrMore: 60, repliedOrMore: 30, meeting: 5, discarded: 4, rateContacted: 40, rateReplied: 10 });
  assert.equal(b.rateReplyPct, 25);
  assert.equal(b.rateReplyFraction, "10 / 40");
  assert.equal(b.rateReplyIsRate, true);
  assert.equal("replyRatePct" in b, false, "the snapshot ratio was the bug; it must not survive as a field");
  assert.equal("repliedOfContactedPct" in b, false);
  assert.equal("replyRateFraction" in b, false);
  assert.equal("replyRateIsRate" in b, false);
});

test("rateReplyIsRate follows the dated denominator alone", () => {
  const small = buildFunnelBreakdown({ newTotal: 100, contactedOrMore: 60, repliedOrMore: 30, meeting: 5, discarded: 4, rateContacted: 9, rateReplied: 3 });
  assert.equal(small.rateReplyIsRate, false);
  assert.equal(small.rateReplyFraction, "3 / 9");
  const empty = buildFunnelBreakdown({ newTotal: 0, contactedOrMore: 0, repliedOrMore: 0, meeting: 0, discarded: 0, rateContacted: 0, rateReplied: 0 });
  assert.equal(empty.rateReplyPct, 0, "never NaN");
  assert.equal(empty.rateReplyIsRate, false);
});
