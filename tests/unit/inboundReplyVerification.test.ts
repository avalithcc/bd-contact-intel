import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGmailMessage, type KnownPersonEmail } from "../../src/lib/gmail/classify";
import { parseGmailMessage } from "../../src/lib/gmail/parseMessage";
import {
  INBOUND_REPLY_SOURCE,
  isGenericMailbox,
  planInboundReplyBatch,
  planInboundReplyVerification,
  type ReplyVerifiablePerson,
} from "../../src/lib/gmail/inboundReplyVerification";
import { executeSyncedMessageWrite, type SyncWriteStore, type ReplyCandidate } from "../../src/lib/gmail/syncWriteCore";

const BD_EMAIL = "mariel@avalith.net";
const person = (over: Partial<ReplyVerifiablePerson> = {}): ReplyVerifiablePerson => ({
  id: "p-1",
  emailNormalized: "jane@prospect.com",
  emailStatus: "probable",
  mergedIntoId: null,
  liveHolders: 1,
  ...over,
});
const inbound = (fromAddress = "jane@prospect.com") => ({ direction: "inbound" as const, fromAddress });

test("an inbound reply from the exact stored address promotes probable -> verified with one history row", () => {
  const plan = planInboundReplyVerification(person(), inbound());
  assert.deepEqual(plan.personUpdate, { emailStatus: "verified" });
  assert.deepEqual(plan.historyRows, [
    { personId: "p-1", property: "emailStatus", oldValue: "probable", newValue: "verified", changedByBdId: null, source: INBOUND_REPLY_SOURCE },
  ]);
  assert.equal(INBOUND_REPLY_SOURCE, "inbound_reply");
});

test("promotes from none too (an address we hold but never confirmed)", () => {
  const plan = planInboundReplyVerification(person({ emailStatus: "none" }), inbound());
  assert.equal(plan.personUpdate?.emailStatus, "verified");
  assert.equal(plan.historyRows[0]?.oldValue, "none");
});

test("already verified is a no-op with no history row", () => {
  const plan = planInboundReplyVerification(person({ emailStatus: "verified" }), inbound());
  assert.deepEqual(plan, { personUpdate: null, historyRows: [] });
});

test("an outbound message never promotes", () => {
  const plan = planInboundReplyVerification(person(), { direction: "outbound", fromAddress: "jane@prospect.com" });
  assert.deepEqual(plan, { personUpdate: null, historyRows: [] });
});

test("a different address never promotes", () => {
  const plan = planInboundReplyVerification(person(), inbound("assistant@prospect.com"));
  assert.deepEqual(plan, { personUpdate: null, historyRows: [] });
});

test("a Contact with no email, or a merged one, never promotes", () => {
  assert.equal(planInboundReplyVerification(person({ emailNormalized: null }), inbound("")).personUpdate, null);
  assert.equal(planInboundReplyVerification(person({ emailNormalized: null }), inbound("jane@prospect.com")).personUpdate, null);
  assert.equal(planInboundReplyVerification(person({ mergedIntoId: "p-2" }), inbound()).personUpdate, null);
});

test("address comparison ignores case and surrounding whitespace", () => {
  assert.equal(planInboundReplyVerification(person(), inbound("  Jane@Prospect.COM ")).personUpdate?.emailStatus, "verified");
});

test("idempotent: same input twice gives the same plan, input untouched; replaying the result is a no-op", () => {
  const p = Object.freeze(person());
  const m = Object.freeze(inbound());
  const first = planInboundReplyVerification(p, m);
  assert.deepEqual(planInboundReplyVerification(p, m), first);
  assert.equal(p.emailStatus, "probable");
  const after = { ...p, ...first.personUpdate } as ReplyVerifiablePerson;
  assert.deepEqual(planInboundReplyVerification(after, m), { personUpdate: null, historyRows: [] });
});

test("batch: one history row per person even when several replies arrive, input not mutated", () => {
  const entries = Object.freeze([
    { person: person(), message: inbound() },
    { person: person(), message: inbound() },
    { person: person({ id: "p-2", emailNormalized: "bob@x.com", emailStatus: "none" }), message: inbound("bob@x.com") },
    { person: person({ id: "p-3", emailStatus: "verified" }), message: inbound() },
  ]);
  const rows = planInboundReplyBatch(entries);
  assert.deepEqual(rows.map((r) => [r.historyRow.personId, r.historyRow.oldValue, r.address]), [["p-1", "probable", "jane@prospect.com"], ["p-2", "none", "bob@x.com"]]);
  assert.deepEqual(planInboundReplyBatch(entries), rows);
});

test("shared / role mailboxes are never promoted: nothing written, even on an exact inbound match", () => {
  for (const a of ["info@acme.com", "ventas@acme.com", "no-reply@acme.com", "noreply@acme.com", "sales.team@acme.com", "info+x@acme.com", "Rrhh@acme.com".toLowerCase()]) {
    const plan = planInboundReplyVerification(person({ emailNormalized: a }), inbound(a));
    assert.deepEqual(plan, { personUpdate: null, historyRows: [] }, a);
  }
  assert.equal(planInboundReplyBatch([{ person: person({ emailNormalized: "info@acme.com" }), message: inbound("info@acme.com") }]).length, 0);
});

test("generic detection keeps personal mailboxes promotable", () => {
  assert.equal(isGenericMailbox("jane.doe@acme.com"), false);
  assert.equal(isGenericMailbox("contactjane@acme.com"), false);
  assert.equal(isGenericMailbox("jane@acme.com"), false);
});

test("an address held by more than one live Contact is never promoted, however personal it looks", () => {
  const plan = planInboundReplyVerification(person({ liveHolders: 2 }), inbound());
  assert.deepEqual(plan, { personUpdate: null, historyRows: [] });
  assert.equal(planInboundReplyVerification(person({ liveHolders: 1 }), inbound()).personUpdate?.emailStatus, "verified");
});

// ---- wiring: the sync hands the store exactly the inbound sender matches, whatever their provenance ----

function classified(from: string, known: KnownPersonEmail[], gid = "gm-1") {
  const parsed = parseGmailMessage({
    id: gid, threadId: "gt-1", internalDate: String(Date.UTC(2026, 9, 2)),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: BD_EMAIL }, { name: "Subject", value: "Re" }], body: { data: Buffer.from("hi").toString("base64url") } },
  });
  return classifyGmailMessage({ message: parsed, bdEmail: BD_EMAIL, knownPersons: known, neverLogRules: [], platformSentGmailMessageIds: new Set() });
}

function capturingStore() {
  const candidates: ReplyCandidate[][] = [];
  let n = 0;
  const store: SyncWriteStore = {
    async insertMessages(rows) {
      return rows.map((r) => ({ id: `m-${++n}`, gmailMessageId: r.gmailMessageId, gmailThreadId: r.gmailThreadId, direction: r.direction, sentAt: r.sentAt }));
    },
    async fillRfcIds() { return 0; },
    async insertPersonLinks() {},
    async linkPlatformActivity() {},
    async insertActivities() {},
    async verifyRepliedAddresses(c) { candidates.push([...c]); },
  };
  return { store, candidates };
}

test("sync hands the store the inbound sender, including an inferred-source match (provenance is not proof of nothing)", async () => {
  const { store, candidates } = capturingStore();
  const known: KnownPersonEmail[] = [{ personId: "p-1", emailNormalized: "jane@prospect.com", confidence: "inferred" }];
  const msg = classified("Jane <jane@prospect.com>", known);
  assert.equal(msg.matches[0]?.matchConfidence, "inferred");
  await executeSyncedMessageWrite(store, "bd-1", [msg]);
  assert.deepEqual(candidates, [[{ personId: "p-1", fromAddress: "jane@prospect.com" }]]);
});

test("sync hands the store nothing for an outbound message", async () => {
  const { store, candidates } = capturingStore();
  const known: KnownPersonEmail[] = [{ personId: "p-1", emailNormalized: "jane@prospect.com", confidence: "exact" }];
  const parsed = parseGmailMessage({
    id: "gm-2", threadId: "gt-2", internalDate: String(Date.UTC(2026, 9, 2)),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: BD_EMAIL }, { name: "To", value: "jane@prospect.com" }, { name: "Subject", value: "Hi" }], body: { data: Buffer.from("hi").toString("base64url") } },
  });
  const msg = classifyGmailMessage({ message: parsed, bdEmail: BD_EMAIL, knownPersons: known, neverLogRules: [], platformSentGmailMessageIds: new Set() });
  await executeSyncedMessageWrite(store, "bd-1", [msg]);
  assert.deepEqual(candidates.flat(), []);
});
