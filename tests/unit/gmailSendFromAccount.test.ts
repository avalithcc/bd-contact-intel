/**
 * `sendGmailMessageFromAccount({ accountId })`: the Sequence runner's entry point (design D4). It loads the sending
 * account by `email_account.id` and then goes through the SAME send body as `sendGmailMessage({ bdId })` (pinned in
 * gmailSendCharacterization.test.ts), so only what is specific to the entry point is asserted here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSentRaw, installFakeWorld, makeAccountRow } from "./fixtures/gmailSendHarness";
import { GmailSendError } from "@/lib/gmail/errors";

const OK_TOKEN = { ok: true, body: { access_token: "access-1" } };
const OK_SEND = { ok: true, body: { id: "gmail-msg-1", threadId: "gmail-thread-1" } };

async function sendFromAccount(extra: Record<string, unknown> = {}) {
  const { sendGmailMessageFromAccount } = await import("@/lib/gmail/send");
  return sendGmailMessageFromAccount({
    accountId: "acct-1",
    to: "lead@example.test",
    subject: "Hello",
    body: "Hi there",
    ...extra,
  });
}

test("no account with that id -> not_connected, no network", async () => {
  const w = await installFakeWorld({ accountRows: [] });
  try {
    await assert.rejects(sendFromAccount(), (e: unknown) => e instanceof GmailSendError && e.kind === "not_connected");
    assert.equal(w.fetchCalls.length, 0);
  } finally {
    w.restore();
  }
});

test("the sender address and the actor come from the loaded row, never a literal", async () => {
  const row = await makeAccountRow({ bdId: "bd-owner", emailAddress: "owner.mailbox@avalith.test" });
  const w = await installFakeWorld({ accountRows: [row], token: OK_TOKEN, send: OK_SEND });
  try {
    assert.deepEqual(await sendFromAccount(), { messageId: "gmail-msg-1", threadId: "gmail-thread-1" });
    assert.match(decodeSentRaw(w.fetchCalls[1]).raw, /^From: owner\.mailbox@avalith\.test\r\n/);
    assert.equal(w.insertedActivities[0].actorBdId, "bd-owner");
  } finally {
    w.restore();
  }
});

test("a disconnected account is refused like on the bdId path", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow({ status: "error" })] });
  try {
    await assert.rejects(sendFromAccount(), (e: unknown) => e instanceof GmailSendError && e.kind === "not_connected");
    assert.equal(w.fetchCalls.length, 0);
  } finally {
    w.restore();
  }
});

test("extraHeaders reach the wire", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await sendFromAccount({ extraHeaders: ["List-Unsubscribe: <https://x.test/u?t=1>"] });
    assert.match(decodeSentRaw(w.fetchCalls[1]).raw, /\r\nList-Unsubscribe: <https:\/\/x\.test\/u\?t=1>\r\n/);
  } finally {
    w.restore();
  }
});

test("an extra header with CR/LF fails fast, before any read or network", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await assert.rejects(
      sendFromAccount({ extraHeaders: ["X-A: 1\r\nBcc: evil@x.test"] }),
      (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_header",
    );
    assert.equal(w.selectCalls.length, 0);
    assert.equal(w.fetchCalls.length, 0);
  } finally {
    w.restore();
  }
});

test("Sequence id and step flow into the email_sent activity metadata, beside the standard keys", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await sendFromAccount({ activityMetadata: { sequenceId: "seq-1", step: 1 } });
    assert.deepEqual(w.insertedActivities[0].metadata, {
      sequenceId: "seq-1",
      step: 1,
      to: "lead@example.test",
      subject: "Hello",
      gmailMessageId: "gmail-msg-1",
      gmailThreadId: "gmail-thread-1",
    });
  } finally {
    w.restore();
  }
});

test("caller metadata can never overwrite the standard keys", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await sendFromAccount({ activityMetadata: { gmailMessageId: "forged", to: "forged@x.test" } });
    const meta = w.insertedActivities[0].metadata as Record<string, unknown>;
    assert.equal(meta.gmailMessageId, "gmail-msg-1");
    assert.equal(meta.to, "lead@example.test");
  } finally {
    w.restore();
  }
});

test("a reminder continues the step 1 thread: stored In-Reply-To / References / threadId reach Gmail", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await sendFromAccount({
      subject: "Re: Hello",
      reply: { inReplyTo: "<step1@mail.gmail.com>", references: "<step1@mail.gmail.com>", threadId: "thread-step1" },
    });
    const { raw, threadId } = decodeSentRaw(w.fetchCalls[1]);
    assert.equal(threadId, "thread-step1");
    assert.match(raw, /\r\nIn-Reply-To: <step1@mail\.gmail\.com>\r\n/);
  } finally {
    w.restore();
  }
});

test("a rejected Gmail send carries the HTTP status on the error, with the existing kind and message untouched", async () => {
  for (const status of [400, 429, 503]) {
    const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: { ok: false, status, body: "nope" } });
    try {
      await assert.rejects(sendFromAccount(), (e: unknown) => {
        assert.ok(e instanceof GmailSendError);
        assert.equal(e.kind, "send_failed");
        assert.equal(e.message, "Gmail send failed: nope");
        assert.equal(e.status, status);
        return true;
      });
    } finally {
      w.restore();
    }
  }
});
