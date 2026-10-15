// Task 10.5: which inbound mail moves a Sequence member to `replied`. Every message goes through the REAL
// parseGmailMessage + classifyGmailMessage (+ planThreadAttribution for thread-attributed ones), so the fields the
// planner reads are the ones the sync produces. No DB, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { classifyGmailMessage, type ClassifiedMessage, type KnownPersonEmail, type NeverLogRule } from "../../src/lib/gmail/classify";
import { parseGmailMessage, type GmailApiHeader } from "../../src/lib/gmail/parseMessage";
import { planThreadAttribution, type OutboundThreadRef } from "../../src/lib/gmail/threadAttribution";
import { applySequenceReplies, genuineRepliesByPerson, planSequenceReplies, type ReplyMember, type ReplyPorts } from "../../src/lib/sequences/applyReplies";

const BD = "bd@avalith.net";
const JONATHAN = "00000000-0000-4000-8000-0000000000a1";
const MARIA = "00000000-0000-4000-8000-0000000000a2";
const KNOWN: KnownPersonEmail[] = [
  { personId: JONATHAN, emailNormalized: "jonathan@guess.com", confidence: "exact" },
  { personId: MARIA, emailNormalized: "maria@guess.com", confidence: "inferred" },
];
const SENT = Date.UTC(2026, 9, 10, 14, 0, 0); // step 1 went out
const hours = (h: number) => SENT + h * 3_600_000;

interface Opts { gid?: string; at?: number; to?: string; cc?: string; subject?: string; headers?: GmailApiHeader[]; never?: NeverLogRule[] }

function inbound(from: string, o: Opts = {}): ClassifiedMessage {
  const parsed = parseGmailMessage({
    id: o.gid ?? "g1",
    threadId: "t1",
    internalDate: String(o.at ?? hours(2)),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: o.to ?? BD },
        ...(o.cc ? [{ name: "Cc", value: o.cc }] : []),
        { name: "Subject", value: o.subject ?? "Re: senior engineers" },
        ...(o.headers ?? []),
      ],
      body: { data: Buffer.from("hi").toString("base64url") },
    },
  });
  return classifyGmailMessage({ message: parsed, bdEmail: BD, knownPersons: KNOWN, neverLogRules: o.never ?? [] });
}
const outbound = (to: string, o: Opts = {}): ClassifiedMessage =>
  classifyGmailMessage({
    message: parseGmailMessage({
      id: o.gid ?? "o1", threadId: "t1", internalDate: String(o.at ?? hours(2)),
      payload: { mimeType: "text/plain", headers: [{ name: "From", value: BD }, { name: "To", value: to }, { name: "Subject", value: "hello" }] },
    }),
    bdEmail: BD, knownPersons: KNOWN, neverLogRules: [],
  });

const member = (over: Partial<ReplyMember> = {}): ReplyMember => ({ id: "m1", personId: JONATHAN, state: "sent", sentAt: new Date(SENT), ...over });
const AUTO: GmailApiHeader[] = [{ name: "Auto-Submitted", value: "auto-replied" }];

test("a non-automatic inbound message from the member's Contact after the step 1 send moves sent and no_reply to replied", () => {
  for (const state of ["sent", "no_reply"] as const) {
    const plan = planSequenceReplies([inbound("Jonathan <jonathan@guess.com>", { at: hours(2) })], [member({ state })]);
    assert.deepEqual(plan, [{ memberId: "m1", personId: JONATHAN, repliedAt: new Date(hours(2)), gmailMessageId: "g1" }], state);
  }
});

test("an address we only inferred still counts: the sender wrote from exactly that address", () => {
  const plan = planSequenceReplies([inbound("maria@guess.com")], [member({ id: "m2", personId: MARIA })]);
  assert.equal(plan.length, 1);
});

test("a Cc-only appearance does not count: the Contact did not write it", () => {
  const msg = inbound("someone@else.com", { cc: "jonathan@guess.com" });
  assert.deepEqual(msg.matches, []);
  assert.deepEqual(planSequenceReplies([msg], [member()]), []);
});

test("a message from the Contact before the step 1 send, or at the very instant of it, does not count", () => {
  assert.deepEqual(planSequenceReplies([inbound("jonathan@guess.com", { at: hours(-1) })], [member()]), []);
  assert.deepEqual(planSequenceReplies([inbound("jonathan@guess.com", { at: SENT })], [member()]), []);
});

test("a never-logged message cannot count, even from the Contact", () => {
  const msg = inbound("jonathan@guess.com", { never: [{ kind: "domain", value: "guess.com" }] });
  assert.equal(msg.neverLogged, true);
  assert.deepEqual(planSequenceReplies([msg], [member()]), []);
});

test("an automatic reply alone does not count; an auto-reply followed by a human reply sets replied_at to the SECOND message", () => {
  const auto = inbound("jonathan@guess.com", { gid: "auto", at: hours(1), headers: AUTO });
  const outOfOffice = inbound("jonathan@guess.com", { gid: "ooo", at: hours(1), subject: "Out of Office: Re: senior engineers" });
  assert.deepEqual(planSequenceReplies([auto, outOfOffice], [member()]), []);
  const human = inbound("jonathan@guess.com", { gid: "human", at: hours(5) });
  const later = inbound("jonathan@guess.com", { gid: "later", at: hours(9) });
  const plan = planSequenceReplies([later, auto, human], [member()]);
  assert.deepEqual(plan.map((p) => [p.gmailMessageId, p.repliedAt.getTime()]), [["human", hours(5)]]);
});

test("DECISION: a thread-attributed message never marks a member replied: the sender is an address we do not hold", () => {
  const raw = inbound("jonathan.p@otherdomain.com", { gid: "thr" });
  const ref: OutboundThreadRef = { gmailThreadId: "t1", rfcMessageId: "<out1@mail>", sentAt: new Date(SENT), personIds: [JONATHAN], matchedEmails: ["jonathan@guess.com"] };
  const [attributed] = planThreadAttribution([raw], [ref], { bdEmail: BD, ownAddresses: [BD], neverLogRules: [] });
  assert.equal(attributed!.matches[0]?.matchConfidence, "thread", "fixture really is thread-attributed");
  assert.deepEqual(planSequenceReplies([attributed!], [member()]), []);
});

test("outbound mail never counts, and a reply from one Contact does not move another Contact's member", () => {
  assert.deepEqual(planSequenceReplies([outbound("jonathan@guess.com")], [member()]), []);
  assert.deepEqual(planSequenceReplies([inbound("maria@guess.com")], [member()]), []);
});

test("only sent and no_reply members move; every other state, and a member with no send time, is left alone", () => {
  const msg = inbound("jonathan@guess.com");
  for (const state of ["drafted", "approved", "replied", "discarded"]) assert.deepEqual(planSequenceReplies([msg], [member({ state })]), [], state);
  assert.deepEqual(planSequenceReplies([msg], [member({ sentAt: null })]), []);
});

test("the same Contact in two Sequences moves both members", () => {
  const plan = planSequenceReplies([inbound("jonathan@guess.com")], [member({ id: "a" }), member({ id: "b" })]);
  assert.deepEqual(plan.map((p) => p.memberId).sort(), ["a", "b"]);
});

test("the planner never mutates its inputs: the same frozen input twice gives the same plan", () => {
  const messages = Object.freeze([Object.freeze(inbound("jonathan@guess.com", { gid: "x", at: hours(5) })), Object.freeze(inbound("jonathan@guess.com", { gid: "y", at: hours(3) }))]);
  const members = Object.freeze([Object.freeze(member())]);
  const first = planSequenceReplies(messages, members);
  const second = planSequenceReplies(messages, members);
  assert.deepEqual(first, second);
  assert.equal(first[0]!.gmailMessageId, "y");
  assert.equal(messages.length, 2);
});

test("the person set the orchestrator queries is built by the SAME function the planner reads", () => {
  const messages = [inbound("jonathan@guess.com", { gid: "a" }), inbound("jonathan@guess.com", { gid: "auto", headers: AUTO }), inbound("someone@else.com")];
  assert.deepEqual([...genuineRepliesByPerson(messages).keys()], [JONATHAN]);
});

function fakePorts(members: ReplyMember[]) {
  const calls = { find: [] as string[][], apply: [] as unknown[] };
  const ports: ReplyPorts = {
    async findMembers(personIds) { calls.find.push([...personIds]); return members.filter((m) => personIds.includes(m.personId)); },
    async applyReplies(updates) { calls.apply.push(updates); return updates.length; },
  };
  return { ports, calls };
}

test("applySequenceReplies costs no round trip when nothing in the batch could be a reply", async () => {
  const { ports, calls } = fakePorts([member()]);
  const result = await applySequenceReplies([inbound("jonathan@guess.com", { headers: AUTO }), outbound("jonathan@guess.com"), inbound("x@else.com")], ports);
  assert.deepEqual(result, { replied: 0 });
  assert.deepEqual(calls, { find: [], apply: [] });
});

test("applySequenceReplies reads members once and writes once for the whole batch", async () => {
  const { ports, calls } = fakePorts([member(), member({ id: "m2", personId: MARIA })]);
  const result = await applySequenceReplies([inbound("jonathan@guess.com", { gid: "a" }), inbound("maria@guess.com", { gid: "b" })], ports);
  assert.deepEqual(result, { replied: 2 });
  assert.equal(calls.find.length, 1);
  assert.equal(calls.apply.length, 1);
});

test("reply handling never touches follow_up_queue_item: the Seguimientos queue is owned by the existing sync", () => {
  for (const file of ["applyReplies.ts", "replyQueries.ts"]) {
    const source = readFileSync(join(__dirname, "..", "..", "src", "lib", "sequences", file), "utf8");
    assert.doesNotMatch(source, /follow_up_queue_item|followUpQueueItem/, file);
  }
});
