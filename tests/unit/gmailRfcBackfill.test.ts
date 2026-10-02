/**
 * Planner behind scripts/backfill-rfc-message-ids.ts: turns "stored rows with
 * no Message-ID" + "what Gmail returned for them" into the exact updates to
 * write. Pure; the script owns every I/O.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planRfcBackfill } from "@/lib/gmail/rfcBackfill";
import { parseGmailMessage, type GmailApiMessage } from "@/lib/gmail/parseMessage";

function apiMessage(id: string, headers: { name: string; value: string }[]): GmailApiMessage {
  return { id, threadId: "t", internalDate: "1700000000000", payload: { headers } };
}

test("planRfcBackfill takes Message-ID and References from the same parser the sync uses", () => {
  const candidates = [{ id: "row-1", bdId: "bd-1", gmailMessageId: "g1" }];
  const fetched = new Map([["bd-1:g1", parseGmailMessage(apiMessage("g1", [{ name: "Message-ID", value: "<a@x>" }, { name: "References", value: "<r@x>" }]))]]);
  const plan = planRfcBackfill(candidates, fetched);
  assert.deepEqual(plan.updates, [{ id: "row-1", rfcMessageId: "<a@x>", rfcReferences: "<r@x>" }]);
  assert.deepEqual(plan.counts, { candidates: 1, update: 1, notFoundInGmail: 0, noMessageIdHeader: 0 });
});

test("planRfcBackfill separates deleted-in-Gmail from messages that simply have no Message-ID", () => {
  const candidates = [
    { id: "row-1", bdId: "bd-1", gmailMessageId: "gone" },
    { id: "row-2", bdId: "bd-1", gmailMessageId: "bare" },
  ];
  const fetched = new Map([["bd-1:bare", parseGmailMessage(apiMessage("bare", []))]]);
  const plan = planRfcBackfill(candidates, fetched);
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.counts, { candidates: 2, update: 0, notFoundInGmail: 1, noMessageIdHeader: 1 });
});

test("planRfcBackfill keys by bd + gmail id: two mailboxes may share a Gmail id", () => {
  const candidates = [
    { id: "row-1", bdId: "bd-1", gmailMessageId: "same" },
    { id: "row-2", bdId: "bd-2", gmailMessageId: "same" },
  ];
  const fetched = new Map([
    ["bd-1:same", parseGmailMessage(apiMessage("same", [{ name: "Message-ID", value: "<one@x>" }]))],
    ["bd-2:same", parseGmailMessage(apiMessage("same", [{ name: "Message-ID", value: "<two@x>" }]))],
  ]);
  const plan = planRfcBackfill(candidates, fetched);
  assert.deepEqual(plan.updates.map((u) => u.rfcMessageId), ["<one@x>", "<two@x>"]);
});

test("planRfcBackfill is pure: same input twice, same output, input untouched", () => {
  const candidates = [{ id: "row-1", bdId: "bd-1", gmailMessageId: "g1" }];
  const fetched = new Map([["bd-1:g1", parseGmailMessage(apiMessage("g1", [{ name: "Message-ID", value: "<a@x>" }]))]]);
  const first = planRfcBackfill(candidates, fetched);
  const second = planRfcBackfill(candidates, fetched);
  assert.deepEqual(first, second);
  assert.equal(candidates.length, 1);
  assert.equal(fetched.size, 1);
});
