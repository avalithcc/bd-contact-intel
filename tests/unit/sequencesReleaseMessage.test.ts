import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { buildReleaseMessage, type ReleaseMessageFacts } from "@/lib/sequences/releaseMessage";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
const footed = appendFooter("Hello", COMPLIANCE_CONFIG, "us", URL_OK);
const body = footed.status === "ok" ? footed.body : "";

const facts = (over: Partial<ReleaseMessageFacts> = {}): ReleaseMessageFacts => ({
  id: "m-1", sequenceId: "s-1", personId: "p-1", step: 1, email: " jane@acme.test ", subject: "Hi", body,
  accountEmail: "sender@mailbox.test", step1RfcMessageId: null, step1ThreadId: null, ...over,
});

test("step 1: plain message to the trimmed address, List-Unsubscribe from the body's own link, no threading", () => {
  const m = buildReleaseMessage(facts());
  assert.equal(m.to, "jane@acme.test");
  assert.equal(m.reply, undefined);
  assert.deepEqual(m.extraHeaders, [
    `List-Unsubscribe: <${URL_OK}>, <mailto:sender@mailbox.test?subject=unsubscribe>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  ]);
  assert.deepEqual(m.activityMetadata, { sequenceId: "s-1", sequenceMemberId: "m-1", step: 1 });
  assert.equal(m.personId, "p-1");
});

test("step 2 threads on the stored step 1 Message-ID and Gmail thread", () => {
  const m = buildReleaseMessage(facts({ step: 2, step1RfcMessageId: "<abc@mail.test>", step1ThreadId: "t-9" }));
  assert.deepEqual(m.reply, { inReplyTo: "<abc@mail.test>", references: "<abc@mail.test>", threadId: "t-9" });
  assert.equal(m.activityMetadata.step, 2);
});

test("it refuses to build an unthreaded reminder or a message with no unsubscribe link", () => {
  assert.throws(() => buildReleaseMessage(facts({ step: 2 })), /thread/i);
  assert.throws(() => buildReleaseMessage(facts({ body: "no link" })), /unsubscribe/i);
});
