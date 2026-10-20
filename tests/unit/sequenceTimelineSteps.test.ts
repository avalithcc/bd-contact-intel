/**
 * The contact timeline's "Próximas" card for a Sequence email that is approved and waiting (mockup enviar-o-programar.html,
 * 4d): only the viewer's own, only approved ones with a moment, soonest first, managed from the Sequence.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { upcomingSequenceSteps } from "@/lib/sequences/timelineSteps";
import type { ContactMembership } from "@/lib/sequences/contactContext";

const base: ContactMembership = {
  memberId: "m1", sequenceName: "florida + us", state: "approved", ownedByViewer: true, scheduledFor: new Date("2026-10-22T13:00:00Z"),
  sentAt: null, repliedAt: null, discardedAt: null, discardReason: null, sequenceId: "s1", subject: "senior engineers", approvedAt: new Date("2026-10-19T14:43:00Z"), toAddress: "brian@example.test",
};

test("an approved own step with a moment becomes a card that links to its Sequence", () => {
  const [step] = upcomingSequenceSteps([base]);
  assert.deepEqual(step, { memberId: "m1", sequenceId: "s1", sequenceName: "florida + us", subject: "senior engineers", toAddress: "brian@example.test", at: base.scheduledFor, approvedAt: base.approvedAt });
});

test("other states, other BDs' Sequences and approvals without a moment are not shown", () => {
  const steps = upcomingSequenceSteps([
    { ...base, memberId: "a", state: "drafted" },
    { ...base, memberId: "b", state: "sent" },
    { ...base, memberId: "c", ownedByViewer: false },
    { ...base, memberId: "d", scheduledFor: null },
    { ...base, memberId: "e", sequenceId: undefined },
  ]);
  assert.deepEqual(steps, []);
});

test("several are listed soonest first", () => {
  const later = { ...base, memberId: "later", scheduledFor: new Date("2026-10-25T13:00:00Z") };
  assert.deepEqual(upcomingSequenceSteps([later, base]).map((s) => s.memberId), ["m1", "later"]);
});
