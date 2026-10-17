/**
 * `bounced` is sticky: nothing that runs by itself (inbound replies, re-imports, merges, Lusha) may bring a bounced
 * address back, while a person typing a DIFFERENT address starts from a clean slate. Each case calls the real planner.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planPropertyEdit } from "@/lib/contacts/propertyEdit";
import { planInboundReplyVerification } from "@/lib/gmail/inboundReplyVerification";
import { pickEmailWinner } from "@/lib/identity/merge";
import { stickyBouncedSide, type EmailStatus } from "@/lib/identity/matcher";
import { pickEmail } from "@/lib/lusha/parse";
import { planRevealedEmailWrite, type RevealPerson } from "@/lib/lusha/revealPlan";
import { canTransition } from "@/lib/sequences/memberState";
import { isReachable } from "@/lib/sequences/rosterGuards";

type Holder = { email: string; emailNormalized: string; emailStatus: EmailStatus };

test("an inbound reply never promotes a bounced address", () => {
  const plan = planInboundReplyVerification({ id: "p", emailNormalized: "a@corp.test", emailStatus: "bounced", mergedIntoId: null, liveHolders: 1 }, { direction: "inbound", fromAddress: "a@corp.test" });
  assert.deepEqual(plan, { personUpdate: null, historyRows: [] });
});

test("a merge keeps the bounce when both sides hold the same address, in either order", () => {
  const bounced: Holder = { email: "A@corp.test", emailNormalized: "a@corp.test", emailStatus: "bounced" };
  const verified: Holder = { email: "a@corp.test", emailNormalized: "a@corp.test", emailStatus: "verified" };
  assert.equal(pickEmailWinner(bounced, verified), bounced);
  assert.equal(pickEmailWinner(verified, bounced), bounced);
  assert.equal(stickyBouncedSide(verified, { ...verified }), null);
});

test("a merge of different addresses prefers the one that still works", () => {
  const bounced: Holder = { email: "old@corp.test", emailNormalized: "old@corp.test", emailStatus: "bounced" };
  const probable: Holder = { email: "new@corp.test", emailNormalized: "new@corp.test", emailStatus: "probable" };
  assert.equal(pickEmailWinner(bounced, probable), probable);
  assert.equal(pickEmailWinner(probable, bounced), probable);
});

const edited = (newEmail: string) =>
  planPropertyEdit(
    { id: "p", email: "old@corp.test", emailNormalized: "old@corp.test", emailStatus: "bounced", emailSource: "hunter", jobTitle: null, roleGroup: null, contactType: null, seniority: null, city: null, region: null, country: null, industry: null, phone: null, mobilePhone: null, profileKey: null } as Parameters<typeof planPropertyEdit>[0],
    "email",
    newEmail,
    "bd-1",
  );

test("typing a different address resets the status; only a change of letter case keeps the bounce", () => {
  assert.equal(edited("new@corp.test").personUpdate?.emailStatus, "none");
  assert.equal(edited("OLD@corp.test").personUpdate?.emailStatus, "bounced");
});

const person = (over: Partial<RevealPerson> = {}): RevealPerson => ({ id: "p", email: "old@corp.test", emailNormalized: "old@corp.test", emailStatus: "bounced", emailSource: "hunter", emailConfidence: null, mergedIntoId: null, phone: null, mobilePhone: null, ...over });
const META = { actorBdId: "bd-1", lushaId: "lu-1", creditsCharged: 1 };

test("a bounced Contact is unreachable, so Lusha may reveal a new address but never put the dead one back", () => {
  const p = person();
  assert.equal(isReachable({ personId: p.id, email: p.email, emailStatus: p.emailStatus, emailSource: p.emailSource, mergedIntoId: null, companyKey: null, clientStatus: null }), false);
  const fresh = planRevealedEmailWrite(p, pickEmail([{ email: "new@corp.test", confidence: 80 }]), META);
  assert.equal(fresh.personUpdate?.emailStatus, "probable");
  const same = planRevealedEmailWrite(p, pickEmail([{ email: "Old@corp.test", confidence: 80 }]), META);
  assert.equal(same.personUpdate, null);
});

test("a hard bounce discards any live membership and the member can never be re-admitted", () => {
  for (const state of ["drafted", "approved", "sent", "no_reply", "replied"] as const) assert.equal(canTransition(state, "discarded", "bounce"), true, state);
  assert.equal(canTransition("discarded", "drafted", "readmit", { discardReason: "bounce" }), false);
});
