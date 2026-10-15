// Task 10.6: the Sequence reply hook rides on the sync's write and can never take the sync down. A throw out of the
// sync means the cursor does not advance and mail sync wedges for every BD (the same shape a fresh review caught in
// thread attribution), so the hook's failure is swallowed and logged once. Fixtures: real parse + classify; the sync
// itself is the real syncAccountIncremental over a fake Gmail client. No DB, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { GmailClient } from "../../src/lib/gmail/client";
import type { ClassifiedMessage } from "../../src/lib/gmail/classify";
import type { GmailApiMessage } from "../../src/lib/gmail/parseMessage";
import { syncAccountIncremental } from "../../src/lib/gmail/syncAccount";
import { withSequenceReplies } from "../../src/lib/gmail/withSequenceReplies";
import { applySequenceReplies, type ReplyMember, type ReplyPorts } from "../../src/lib/sequences/applyReplies";

const PERSON = "00000000-0000-4000-8000-0000000000a1";
const raw = (id: string, from: string): GmailApiMessage => ({
  id, threadId: `t-${id}`, internalDate: String(Date.UTC(2026, 9, 12)),
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: "bd@avalith.net" }, { name: "Subject", value: "Re: hi" }], body: { data: Buffer.from("hi").toString("base64url") } },
});
const client = (messages: GmailApiMessage[]): GmailClient => ({
  async historyList() { return { ok: true, page: { historyRecords: messages.map((m) => ({ messagesAdded: [{ message: { id: m.id } }] })), historyId: "200" } } as never; },
  async listMessages() { return { messageIds: [] }; },
  async getMessage(id: string) { return messages.find((m) => m.id === id) ?? null; },
  async getCurrentHistoryId() { return "200"; },
});
const deps = (write: (c: ClassifiedMessage[]) => Promise<{ inserted: number }>, messages: GmailApiMessage[]) => ({
  client: client(messages), bdId: "bd-1", bdEmail: "bd@avalith.net", historyId: "100", deadlineAt: Date.now() + 10_000,
  getKnownPersons: async () => [{ personId: PERSON, emailNormalized: "jane@prospect.com", confidence: "exact" as const }],
  getNeverLogRules: async () => [], getPlatformSentIds: async () => new Set<string>(),
  threadPorts: { getOutboundThreadRefs: async () => [], getOwnMailboxAddresses: async () => [] },
  writeMessages: write,
});

test("a sync batch where the Sequence hook THROWS still writes its messages and advances the cursor", async () => {
  const written: string[] = [];
  const logged: unknown[][] = [];
  const write = withSequenceReplies(
    async (c) => { written.push(...c.map((m) => m.gmailMessageId)); return { inserted: c.length }; },
    async () => { throw new Error("sequence_member does not exist"); },
    (...args) => logged.push(args),
  );
  const result = await syncAccountIncremental(deps(write, [raw("g1", "jane@prospect.com")]));
  assert.equal(result.status, "ok");
  assert.equal(result.newHistoryId, "200");
  assert.equal(result.messagesStored, 1);
  assert.deepEqual(written, ["g1"]);
  assert.equal(logged.length, 1, "logged once, then carried on");
});

test("the hook runs AFTER the write and sees the stored batch; a failing write is the sync's own error and skips the hook", async () => {
  const order: string[] = [];
  const ok = withSequenceReplies(async () => { order.push("write"); return { inserted: 1 }; }, async (messages) => { order.push(`hook:${messages.length}`); });
  await ok([{ gmailMessageId: "g" } as ClassifiedMessage]);
  assert.deepEqual(order, ["write", "hook:1"]);
  let hooked = false;
  const bad = withSequenceReplies(async () => { throw new Error("db down"); }, async () => { hooked = true; });
  await assert.rejects(bad([{ gmailMessageId: "g" } as ClassifiedMessage]), /db down/);
  assert.equal(hooked, false);
});

function countingPorts(members: ReplyMember[]) {
  const calls = { find: 0, apply: 0 };
  const ports: ReplyPorts = {
    async findMembers() { calls.find++; return members; },
    async applyReplies(u) { calls.apply++; return u.length; },
  };
  return { ports, calls };
}
const run = (ports: ReplyPorts, messages: GmailApiMessage[]) =>
  syncAccountIncremental(deps(withSequenceReplies(async (c) => ({ inserted: c.length }), (m) => applySequenceReplies(m, ports)), messages));

test("a batch with no possible reply issues no Sequence query at all", async () => {
  const { ports, calls } = countingPorts([]);
  await run(ports, []); // nothing synced
  await run(ports, [{ ...raw("g2", "jane@prospect.com"), payload: { ...raw("g2", "").payload!, headers: [{ name: "From", value: "jane@prospect.com" }, { name: "To", value: "bd@avalith.net" }, { name: "Auto-Submitted", value: "auto-replied" }] } }]);
  assert.deepEqual(calls, { find: 0, apply: 0 });
});

test("while sequence_member holds nothing for the sender the cost is ONE read and ZERO writes", async () => {
  const { ports, calls } = countingPorts([]);
  await run(ports, [raw("g3", "jane@prospect.com")]);
  assert.deepEqual(calls, { find: 1, apply: 0 });
});

test("both sync paths use the wrapper: it is installed on the one writeMessages dep they share", () => {
  const source = readFileSync(join(__dirname, "..", "..", "src", "lib", "gmail", "syncOneAccountNow.ts"), "utf8");
  assert.match(source, /writeMessages:\s*withSequenceReplies\(/);
});
