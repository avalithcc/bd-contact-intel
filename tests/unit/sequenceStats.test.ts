import assert from "node:assert/strict";
import { test } from "node:test";
import type { MemberState } from "@/lib/sequences/memberState";
import { SENT_STATES } from "@/lib/sequences/memberState";
import { sequenceStats, type StatMember } from "@/lib/sequences/stats";

const SENT_AT = new Date("2026-10-14T13:00:00Z");

// Counts only: no names, so no fixture can ever hold a real prospect.
function members(spec: Partial<Record<MemberState, number>>, over: Partial<StatMember> = {}): StatMember[] {
  const out: StatMember[] = [];
  for (const [state, n] of Object.entries(spec) as [MemberState, number][]) {
    for (let i = 0; i < n; i++) out.push({ state, hasDraft: true, scheduledFor: null, sentAt: (SENT_STATES as readonly string[]).includes(state) ? SENT_AT : null, discardReason: null, ...over });
  }
  return out;
}

// The dataset of the approved mockup and of the sequence-detail-view "Counters match the cards" scenario.
const MID_FLIGHT = () => members({ drafted: 3, approved: 2, sent: 3, replied: 1, discarded: 1 });

test("mid-flight dataset yields the four cards 3, 2, 4 (3 awaiting a reminder), 1", () => {
  const s = sequenceStats(MID_FLIGHT());
  assert.equal(s.toReview, 3);
  assert.equal(s.queued, 2);
  assert.equal(s.sent, 4);
  assert.equal(s.awaitingReminder, 3);
  assert.equal(s.replied, 1);
});

test("the progress line is 4 of 10 and the discarded member stays in the total", () => {
  const s = sequenceStats(MID_FLIGHT());
  assert.equal(s.total, 10);
  assert.equal(s.sent, 4);
});

test("the sent and queued bar segments are proportional to the total", () => {
  const s = sequenceStats(MID_FLIGHT());
  assert.equal(s.segments.sentPct, 40);
  assert.equal(s.segments.queuedPct, 20);
});

test("the third, neutral segment is the remainder: 40% on the mockup dataset, discarded included, and the bar totals 100%", () => {
  const s = sequenceStats(MID_FLIGHT());
  assert.equal(s.segments.restPct, 40);
  assert.equal(s.segments.rest, 4);
  assert.equal(s.segments.sentPct + s.segments.queuedPct + s.segments.restPct, 100);
});

test("a finished bar is full: the remainder is zero", () => {
  const s = sequenceStats(members({ replied: 3, no_reply: 7 }));
  assert.deepEqual(s.segments, { sentPct: 100, queuedPct: 0, restPct: 0, rest: 0 });
});

test("a drafted member without a draft is not counted as ready to review", () => {
  const list = [...members({ drafted: 2 }), ...members({ drafted: 1 }, { hasDraft: false })];
  assert.equal(sequenceStats(list).toReview, 2);
});

test("the next release is the earliest scheduled instant among approved members", () => {
  const early = new Date("2026-10-15T13:00:00Z");
  const late = new Date("2026-10-16T13:00:00Z");
  const list = [
    ...members({ approved: 1 }, { scheduledFor: late }),
    ...members({ approved: 1 }, { scheduledFor: early }),
    // A drafted member's schedule must never leak into the queue foot.
    ...members({ drafted: 1 }, { scheduledFor: new Date("2026-10-14T13:00:00Z") }),
  ];
  assert.deepEqual(sequenceStats(list).nextReleaseAt, early);
});

test("finished counts: discarded members are in the total but NOT among the unanswered", () => {
  const s = sequenceStats(members({ replied: 3, no_reply: 6, discarded: 1 }));
  assert.equal(s.view, "finished");
  assert.deepEqual(s.finished, { replied: 3, noReply: 6, total: 10 });
});

test("the spec example: 3 replied and 7 no_reply of 10", () => {
  const s = sequenceStats(members({ replied: 3, no_reply: 7 }));
  assert.deepEqual(s.finished, { replied: 3, noReply: 7, total: 10 });
});

test("a sequence is not finished while anything is drafted, approved or awaiting a reminder", () => {
  for (const live of ["drafted", "approved", "sent"] as const) {
    assert.equal(sequenceStats(members({ replied: 2, no_reply: 1, [live]: 1 })).view, "live", live);
  }
});

test("members and no drafts at all is the empty state, with the member count", () => {
  const s = sequenceStats(members({ drafted: 10 }, { hasDraft: false }));
  assert.equal(s.view, "empty");
  assert.equal(s.total, 10);
});

test("no members renders live with zeroes, never NaN", () => {
  const s = sequenceStats([]);
  assert.equal(s.view, "live");
  assert.equal(s.segments.sentPct, 0);
  assert.equal(s.segments.queuedPct, 0);
});

// "No contactables": the tile counts addresses this Sequence actually wrote to and that then bounced or opted out.
const gone = (reason: string | null, sentAt: Date | null, state: MemberState = "discarded"): StatMember => ({ state, hasDraft: true, scheduledFor: null, sentAt, discardReason: reason });

test("not contactable counts a sent bounce and a sent opt-out, and the foot rate is over what went out", () => {
  // The mockup: 6 left (3 awaiting a reminder + 1 replied + 2 gone), 3 not contactable -> 50%.
  const s = sequenceStats([...members({ sent: 3, replied: 1 }), gone("bounce", SENT_AT), gone("opt_out", SENT_AT), gone("bounce", SENT_AT)]);
  assert.equal(s.sent, 7);
  assert.equal(s.notContactable, 3);
  assert.equal(s.notContactablePct, 43);
});

test("not contactable EXCLUDES a bounce whose sent_at is null: the address was burned elsewhere and this Sequence never wrote", () => {
  const s = sequenceStats([...members({ sent: 2 }), gone("bounce", null), gone("opt_out", null)]);
  assert.equal(s.notContactable, 0);
  assert.equal(s.sent, 2);
});

test("not contactable excludes a manual discard, even one made after the email went out", () => {
  const s = sequenceStats([...members({ sent: 1 }), gone("wrong_profile", SENT_AT), gone(null, SENT_AT)]);
  assert.equal(s.notContactable, 0);
});

test("sent counts a member who bounced or was discarded after the email left, but not the awaiting-reminder foot", () => {
  const s = sequenceStats([...members({ sent: 2 }), gone("bounce", SENT_AT), gone("manual", SENT_AT)]);
  assert.equal(s.sent, 4);
  assert.equal(s.awaitingReminder, 2);
});

test("the rate is 0, not NaN, when nothing went out", () => {
  const s = sequenceStats(members({ drafted: 2 }));
  assert.equal(s.notContactable, 0);
  assert.equal(s.notContactablePct, 0);
});
