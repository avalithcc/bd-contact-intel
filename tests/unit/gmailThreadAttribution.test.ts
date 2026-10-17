// Thread attribution of replies from an address we do not hold. Every message here goes through
// the REAL parseGmailMessage + classifyGmailMessage, never a hand-built ClassifiedMessage, so the
// key the planner reads (thread id, Message-ID, In-Reply-To, References) is the one the
// producer writes. No DB, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGmailMessage, shouldStoreClassifiedMessage, type ClassifiedMessage, type KnownPersonEmail, type NeverLogRule } from "../../src/lib/gmail/classify";
import { parseGmailMessage } from "../../src/lib/gmail/parseMessage";
import { buildEmailMessagePersonRows, buildEmailMessageRow } from "../../src/lib/gmail/emailMessageRows";
import { buildSyncedActivityRows } from "../../src/lib/gmail/buildSyncedActivities";
import { syncAccountIncremental } from "../../src/lib/gmail/syncAccount";
import { executeSyncedMessageWrite, type SyncWriteStore } from "../../src/lib/gmail/syncWriteCore";
import {
  attributeUnmatchedByThread,
  planThreadAttribution,
  referencedMessageIds,
  threadLookupKeys,
  type AttributionContext,
  type OutboundThreadRef,
  type ThreadAttributionPorts,
  type ThreadRefQuery,
} from "../../src/lib/gmail/threadAttribution";

const BD = "bd@avalith.net";
const CTX: AttributionContext = { bdEmail: BD, ownAddresses: [BD, "teammate@avalith.net"], neverLogRules: [] };
const JONATHAN = "00000000-0000-4000-8000-0000000000a1";
const MARIA = "00000000-0000-4000-8000-0000000000a2";
const KNOWN: KnownPersonEmail[] = [
  { personId: JONATHAN, emailNormalized: "jonathan@guess.com", confidence: "inferred" },
  { personId: MARIA, emailNormalized: "maria@guess.com", confidence: "exact" },
];

interface Opts {
  gid: string;
  thread: string;
  mid?: string;
  inReplyTo?: string;
  refs?: string;
  at?: number;
  never?: NeverLogRule[];
  extraHeaders?: { name: string; value: string }[];
  mimeType?: string;
}

function classified(from: string, to: string, o: Opts): ClassifiedMessage {
  const headers = [
    { name: "From", value: from },
    { name: "To", value: to },
    { name: "Subject", value: "s" },
    ...(o.mid ? [{ name: "Message-ID", value: o.mid }] : []),
    ...(o.inReplyTo ? [{ name: "In-Reply-To", value: o.inReplyTo }] : []),
    ...(o.refs ? [{ name: "References", value: o.refs }] : []),
    ...(o.extraHeaders ?? []),
  ];
  const parsed = parseGmailMessage({
    id: o.gid,
    threadId: o.thread,
    internalDate: String(o.at ?? Date.UTC(2026, 9, 10)),
    payload: { mimeType: o.mimeType ?? "text/plain", headers, body: { data: Buffer.from("hi").toString("base64url") } },
  });
  return classifyGmailMessage({ message: parsed, bdEmail: BD, knownPersons: KNOWN, neverLogRules: o.never ?? [], platformSentGmailMessageIds: new Set() });
}

const reply = (from: string, o: Partial<Opts> = {}) => classified(from, BD, { gid: "r1", thread: "t1", at: Date.UTC(2026, 9, 12), ...o });
const ref = (o: Partial<OutboundThreadRef> = {}): OutboundThreadRef => ({
  gmailThreadId: "t1",
  rfcMessageId: "<out1@mail>",
  sentAt: new Date(Date.UTC(2026, 9, 10)),
  personIds: [JONATHAN],
  matchedEmails: ["jonathan@guess.com"],
  ...o,
});

test("an unmatched reply in a thread whose outbound went to ONE person is attributed to them", () => {
  const msg = reply("jonathan.p@otherdomain.com");
  assert.equal(shouldStoreClassifiedMessage(msg), false);
  const [out] = planThreadAttribution([msg], [ref()], CTX);
  assert.deepEqual(out!.matches, [{ personId: JONATHAN, matchedEmail: "jonathan.p@otherdomain.com", matchConfidence: "thread" }]);
  assert.equal(shouldStoreClassifiedMessage(out!), true);
});

test("the planner never mutates its inputs: same input twice gives the same plan", () => {
  const msg = Object.freeze(reply("someone@other.com"));
  const refs = Object.freeze([Object.freeze(ref({ personIds: Object.freeze([JONATHAN]) as unknown as string[] }))]);
  const first = planThreadAttribution([msg], refs, CTX);
  const second = planThreadAttribution([msg], refs, CTX);
  assert.deepEqual(first, second);
  assert.deepEqual(msg.matches, []);
});

test("a thread holding TWO of our contacts is ambiguous: no attribution", () => {
  const [out] = planThreadAttribution([reply("x@other.com")], [ref(), ref({ rfcMessageId: "<out2@mail>", personIds: [MARIA] })], CTX);
  assert.deepEqual(out!.matches, []);
  const [one] = planThreadAttribution([reply("x@other.com")], [ref({ personIds: [JONATHAN, MARIA] })], CTX);
  assert.deepEqual(one!.matches, []);
});

test("two outbound messages to the SAME person are not ambiguous", () => {
  const [out] = planThreadAttribution([reply("x@other.com")], [ref(), ref({ rfcMessageId: "<out2@mail>" })], CTX);
  assert.equal(out!.matches[0]?.personId, JONATHAN);
});

test("an outbound with no attributed person proves nothing", () => {
  const [out] = planThreadAttribution([reply("x@other.com")], [ref({ personIds: [] })], CTX);
  assert.deepEqual(out!.matches, []);
});

test("falls back to In-Reply-To, then References, when no outbound shares the thread id", () => {
  const viaReplyTo = reply("x@other.com", { thread: "unknown", inReplyTo: "<out1@mail>" });
  const viaRefs = reply("x@other.com", { gid: "r2", thread: "unknown", refs: "<root@mail> <out1@mail>" });
  const out = planThreadAttribution([viaReplyTo, viaRefs], [ref({ gmailThreadId: "t-other" })], CTX);
  assert.deepEqual(out.map((m) => m.matches[0]?.personId), [JONATHAN, JONATHAN]);
});

test("the thread id wins over the header chain", () => {
  const msg = reply("x@other.com", { inReplyTo: "<out2@mail>" });
  const [out] = planThreadAttribution([msg], [ref(), ref({ gmailThreadId: "t-other", rfcMessageId: "<out2@mail>", personIds: [MARIA] })], CTX);
  assert.equal(out!.matches[0]?.personId, JONATHAN);
});

test("referencedMessageIds reads both headers, dedupes and keeps the 10 closest ancestors", () => {
  const ids = Array.from({ length: 14 }, (_, i) => `<m${i}@x>`);
  const msg = reply("x@o.com", { inReplyTo: ids[13], refs: ids.join(" ") });
  const got = referencedMessageIds(msg);
  assert.equal(got.length, 10);
  assert.equal(got[0], "<m13@x>");
  assert.equal(new Set(got).size, 10);
});

test("only unmatched inbound messages are touched: matched inbound and outbound pass through", () => {
  const matched = classified("jonathan@guess.com", BD, { gid: "m1", thread: "t1" });
  const outbound = classified(BD, "maria@guess.com", { gid: "o1", thread: "t1" });
  const out = planThreadAttribution([matched, outbound], [ref({ personIds: [MARIA] })], CTX);
  assert.deepEqual(out[0], matched);
  assert.deepEqual(out[1], outbound);
});

test("a never-logged message is not rescued by its thread", () => {
  const msg = reply("x@other.com", { never: [{ kind: "domain", value: "other.com" }] });
  const [out] = planThreadAttribution([msg], [ref()], CTX);
  assert.deepEqual(out!.matches, []);
});

test("bounces, no-reply senders and our own teammates are not replies", () => {
  for (const from of ["mailer-daemon@googlemail.com", "postmaster@guess.com", "no-reply@guess.com", "noreply+x@guess.com", "colleague@avalith.net"]) {
    const [out] = planThreadAttribution([reply(from)], [ref()], CTX);
    assert.deepEqual(out!.matches, [], from);
  }
});

test("an outbound sent AFTER the inbound cannot be what it answers", () => {
  const [out] = planThreadAttribution([reply("x@other.com")], [ref({ sentAt: new Date(Date.UTC(2026, 9, 13)) })], CTX);
  assert.deepEqual(out!.matches, []);
});

test("an outbound earlier in the same batch counts, built from its real classification", () => {
  const sent = classified(BD, "jonathan@guess.com", { gid: "o1", thread: "t9", mid: "<o1@mail>", at: Date.UTC(2026, 9, 10) });
  const back = reply("x@other.com", { thread: "t9" });
  const out = planThreadAttribution([back, sent], [], CTX);
  assert.equal(out[0]!.matches[0]?.personId, JONATHAN);
  assert.deepEqual(out[1], sent);
});

test("lookup keys cover only unmatched inbound candidates", () => {
  const matched = classified("jonathan@guess.com", BD, { gid: "m1", thread: "tm" });
  const unmatched = reply("x@other.com", { thread: "tu", inReplyTo: "<a@x>" });
  const sent = classified(BD, "maria@guess.com", { gid: "o1", thread: "to" });
  assert.deepEqual(threadLookupKeys([matched, unmatched, sent], CTX), { threadIds: ["tu"], rfcMessageIds: [] });
});

const portsOf = (lookup: (q: ThreadRefQuery) => Promise<OutboundThreadRef[]>, own: string[] = [BD]): ThreadAttributionPorts => ({
  getOutboundThreadRefs: lookup,
  getOwnMailboxAddresses: async () => own,
});
const BASE = { bdEmail: BD, neverLogRules: [] as NeverLogRule[] };

test("orchestrator: thread query first, header query only for the messages the thread did not resolve", async () => {
  const byThread = reply("x@other.com", { gid: "r1", thread: "t1" });
  const byHeader = reply("y@other.com", { gid: "r2", thread: "t2", inReplyTo: "<out9@mail>" });
  const calls: ThreadRefQuery[] = [];
  const lookup = async (q: ThreadRefQuery): Promise<OutboundThreadRef[]> => {
    calls.push(q);
    return q.threadIds.length > 0 ? [ref()] : [ref({ gmailThreadId: "t-else", rfcMessageId: "<out9@mail>", personIds: [MARIA] })];
  };
  const out = await attributeUnmatchedByThread([byThread, byHeader], BASE, portsOf(lookup));
  assert.deepEqual(calls, [
    { threadIds: ["t1", "t2"], rfcMessageIds: [] },
    { threadIds: [], rfcMessageIds: ["<out9@mail>"] },
  ]);
  assert.deepEqual(out.map((m) => m.matches[0]?.personId), [JONATHAN, MARIA]);
});

test("orchestrator: no unmatched inbound, no query at all", async () => {
  let calls = 0;
  const ports: ThreadAttributionPorts = {
    getOutboundThreadRefs: async () => {
      calls += 1;
      return [];
    },
    getOwnMailboxAddresses: async () => {
      calls += 1;
      return [];
    },
  };
  await attributeUnmatchedByThread([classified("jonathan@guess.com", BD, { gid: "m1", thread: "t" })], BASE, ports);
  assert.equal(calls, 0);
});

test("orchestrator: a failing read falls back to the address-only result instead of throwing", async () => {
  const msg = reply("x@other.com");
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const out = await attributeUnmatchedByThread([msg], BASE, portsOf(async () => { throw new Error("canceling statement due to statement timeout"); }));
    assert.deepEqual(out, [msg]);
    assert.equal(logged.length, 1);
    const out2 = await attributeUnmatchedByThread([msg], BASE, { getOutboundThreadRefs: async () => [], getOwnMailboxAddresses: async () => { throw new Error("down"); } });
    assert.deepEqual(out2, [msg]);
  } finally {
    console.error = original;
  }
});

test("bounces and automatic replies are refused by protocol signals, whatever the sender is called", () => {
  const cases: [string, Partial<Opts>][] = [
    ["human@guess.com", { extraHeaders: [{ name: "Auto-Submitted", value: "auto-replied" }] }],
    ["human@guess.com", { extraHeaders: [{ name: "X-Failed-Recipients", value: "gone@guess.com" }] }],
    ["MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@tenant.onmicrosoft.com", {}],
    ["human@guess.com", { mimeType: "multipart/report" }],
    ["bounces-12345@mta.guess.com", {}],
    ["bounce_abc@mta.guess.com", {}],
  ];
  for (const [from, o] of cases) {
    const [out] = planThreadAttribution([reply(from, o)], [ref()], CTX);
    assert.deepEqual(out!.matches, [], `${from} ${JSON.stringify(o)}`);
  }
  const [human] = planThreadAttribution([reply("human@guess.com", { extraHeaders: [{ name: "Auto-Submitted", value: "no" }] })], [ref()], CTX);
  assert.equal(human!.matches.length, 1);
});

test("a sender that is one of our connected mailboxes is refused, even on an alias domain or a malformed bdEmail", () => {
  const alias = { ...CTX, ownAddresses: [BD, "boss@avalith-alias.io"] };
  assert.deepEqual(planThreadAttribution([reply("boss@avalith-alias.io")], [ref()], alias)[0]!.matches, []);
  assert.deepEqual(planThreadAttribution([reply("x@other.com")], [ref()], { ...CTX, bdEmail: "not-an-address" })[0]!.matches, []);
});

test("a never-log rule added after we wrote to the contact still blocks a reply from another address", () => {
  const rules: NeverLogRule[] = [{ kind: "address", value: "jonathan@guess.com" }];
  const [out] = planThreadAttribution([reply("jon.personal@other.com")], [ref()], { ...CTX, neverLogRules: rules });
  assert.deepEqual(out!.matches, []);
  const domain: NeverLogRule[] = [{ kind: "domain", value: "guess.com" }];
  assert.deepEqual(planThreadAttribution([reply("jon.personal@other.com")], [ref()], { ...CTX, neverLogRules: domain })[0]!.matches, []);
});

test("sync wiring: an unmatched reply reaches writeMessages through syncAccountIncremental, attributed by thread", async () => {
  const sent = (id: string, from: string, to: string, extra: { name: string; value: string }[]) => ({
    id, threadId: "t-wire", internalDate: String(Date.UTC(2026, 9, 12)),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: to }, ...extra], body: { data: Buffer.from("hi").toString("base64url") } },
  });
  const raw = { "g-wire": sent("g-wire", "x@other.com", BD, []) };
  const client = {
    async historyList() { return { ok: true as const, page: { historyRecords: [{ messagesAdded: [{ message: { id: "g-wire" } }] }], historyId: "2" } }; },
    async listMessages() { return { messageIds: [] }; },
    async getMessage(id: string) { return raw[id as keyof typeof raw] ?? null; },
    async getCurrentHistoryId() { return "2"; },
  };
  let written: ClassifiedMessage[] = [];
  await syncAccountIncremental({
    client: client as never, bdId: "bd", bdEmail: BD, historyId: "1", deadlineAt: Date.now() + 60_000,
    getKnownPersons: async () => [], getNeverLogRules: async () => [], getPlatformSentIds: async () => new Set(),
    threadPorts: portsOf(async () => [ref({ gmailThreadId: "t-wire" })]),
    writeMessages: async (c) => { written = c; return { inserted: c.length }; },
    recordBounces: async () => {},
  });
  assert.deepEqual(written.map((m) => [m.matches[0]?.personId, m.matches[0]?.matchConfidence]), [[JONATHAN, "thread"]]);
});

test("a thread-attributed message is stored as thread confidence with the real sender address", () => {
  const [out] = planThreadAttribution([reply("jonathan.p@otherdomain.com")], [ref()], CTX);
  const row = buildEmailMessageRow("bd", out!);
  assert.equal(row.matchConfidence, "thread");
  assert.equal(row.matchedEmail, "jonathan.p@otherdomain.com");
  assert.equal(row.personId, JONATHAN);
  assert.equal(buildEmailMessagePersonRows("m", out!.matches)[0]?.matchConfidence, "thread");
  const [activity] = buildSyncedActivityRows({ ...out!, isPlatformSent: false, isAutomatic: out!.automated === true });
  assert.equal(activity?.type, "reply_received");
  assert.equal(activity?.personId, JONATHAN);
});

test("a thread match never promotes email_status", async () => {
  const [out] = planThreadAttribution([reply("jonathan.p@otherdomain.com")], [ref()], CTX);
  const verified: unknown[] = [];
  const store: SyncWriteStore = {
    insertMessages: async (rows) => rows.map((r, i) => ({ id: `m${i}`, gmailMessageId: r.gmailMessageId, gmailThreadId: r.gmailThreadId, direction: r.direction, sentAt: r.sentAt })),
    fillRfcIds: async () => 0,
    insertPersonLinks: async () => {},
    linkPlatformActivity: async () => {},
    insertActivities: async () => {},
    verifyRepliedAddresses: async (c) => void verified.push(...c),
  };
  await executeSyncedMessageWrite(store, "bd", [out!]);
  assert.deepEqual(verified, []);
});
