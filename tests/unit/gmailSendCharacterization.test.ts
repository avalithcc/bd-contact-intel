/**
 * Characterization tests for `sendGmailMessage({ bdId })`: they pin TODAY's behaviour of the live send path
 * (account gate, config gate, token refresh, error classification, the send call, `recordSentEmail`) so the
 * outreach-sequences refactor (design D4: body extracted into `sendFromAccountRow`) provably changes none of it.
 * They must stay green, unchanged, through the whole refactor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeSentRaw,
  installFakeWorld,
  makeAccountRow,
  SEND_URL,
  TOKEN_URL,
} from "./fixtures/gmailSendHarness";
import { GmailSendError } from "@/lib/gmail/errors";

const OK_TOKEN = { ok: true, body: { access_token: "access-1" } };
const OK_SEND = { ok: true, body: { id: "gmail-msg-1", threadId: "gmail-thread-1" } };

async function send(extra: Record<string, unknown> = {}) {
  const { sendGmailMessage } = await import("@/lib/gmail/send");
  return sendGmailMessage({ bdId: "bd-1", to: "lead@example.test", subject: "Hello", body: "Hi there", ...extra });
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof GmailSendError, `expected GmailSendError, got ${String(e)}`);
    return e.kind;
  }
  assert.fail("expected the send to throw");
}

test("no account row -> not_connected, no network", async () => {
  const w = await installFakeWorld({ accountRows: [] });
  try {
    assert.equal(await kindOf(send()), "not_connected");
    assert.equal(w.fetchCalls.length, 0);
  } finally {
    w.restore();
  }
});

test("account not connected, or without a refresh token -> not_connected", async () => {
  for (const over of [{ status: "error" }, { refreshTokenEncrypted: null }]) {
    const w = await installFakeWorld({ accountRows: [await makeAccountRow(over)] });
    try {
      assert.equal(await kindOf(send()), "not_connected");
      assert.equal(w.fetchCalls.length, 0);
      assert.equal(w.updates.length, 0);
    } finally {
      w.restore();
    }
  }
});

test("missing server config -> not_configured, records the missing var NAME, no network", async () => {
  const saved = process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()] });
  try {
    assert.equal(await kindOf(send()), "not_configured");
    assert.equal(w.fetchCalls.length, 0);
    assert.deepEqual(w.updates, [
      { lastErrorMessage: "Gmail is not configured on the server (missing: GOOGLE_OAUTH_CLIENT_ID)." },
    ]);
  } finally {
    w.restore();
    process.env.GOOGLE_OAUTH_CLIENT_ID = saved;
  }
});

test("token refresh: invalid_grant -> reauth_required and the account is flagged error", async () => {
  const w = await installFakeWorld({
    accountRows: [await makeAccountRow()],
    token: { ok: false, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
  });
  try {
    assert.equal(await kindOf(send()), "reauth_required");
    assert.deepEqual(w.updates, [
      {
        status: "error",
        lastErrorMessage: "Gmail authorization was revoked or expired (invalid_grant: Token has been expired or revoked.)",
      },
    ]);
    assert.equal(w.fetchCalls.length, 1, "the send call is never reached");
  } finally {
    w.restore();
  }
});

test("token refresh: invalid_client -> not_configured, status untouched", async () => {
  const w = await installFakeWorld({
    accountRows: [await makeAccountRow()],
    token: { ok: false, body: { error: "invalid_client" } },
  });
  try {
    assert.equal(await kindOf(send()), "not_configured");
    assert.deepEqual(w.updates, [{ lastErrorMessage: "Gmail OAuth is misconfigured (invalid_client)" }]);
  } finally {
    w.restore();
  }
});

test("token refresh: anything else -> temporary, status untouched", async () => {
  const w = await installFakeWorld({
    accountRows: [await makeAccountRow()],
    token: { ok: false, body: "<html>502</html>" },
  });
  try {
    assert.equal(await kindOf(send()), "temporary");
    assert.deepEqual(w.updates, [{ lastErrorMessage: "Gmail token refresh failed (unknown_error)" }]);
  } finally {
    w.restore();
  }
});

test("send call rejected -> send_failed, detail stored truncated to 300 chars, nothing recorded", async () => {
  const detail = "x".repeat(500);
  const w = await installFakeWorld({
    accountRows: [await makeAccountRow()],
    token: OK_TOKEN,
    send: { ok: false, body: detail },
  });
  try {
    await assert.rejects(send(), (e: unknown) => {
      assert.ok(e instanceof GmailSendError);
      assert.equal(e.kind, "send_failed");
      assert.equal(e.message, `Gmail send failed: ${detail}`);
      return true;
    });
    assert.deepEqual(w.updates, [{ lastErrorMessage: `Gmail send failed: ${"x".repeat(300)}` }]);
    assert.equal(w.insertedActivities.length, 0);
  } finally {
    w.restore();
  }
});

test("success: refreshes the token, sends as the account address, clears the error, records email_sent", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    const result = await send();
    assert.deepEqual(result, { messageId: "gmail-msg-1", threadId: "gmail-thread-1" });

    const [tokenCall, sendCall] = w.fetchCalls;
    assert.equal(tokenCall.url, TOKEN_URL);
    const form = new URLSearchParams(String(tokenCall.init.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "refresh-token-1");
    assert.equal(form.get("client_id"), process.env.GOOGLE_OAUTH_CLIENT_ID);

    assert.equal(sendCall.url, SEND_URL);
    assert.equal((sendCall.init.headers as Record<string, string>).Authorization, "Bearer access-1");
    const { raw, threadId } = decodeSentRaw(sendCall);
    assert.equal(threadId, undefined, "a new email carries no threadId");
    assert.match(raw, /^From: sender@avalith\.test\r\n/);
    assert.match(raw, /\r\nTo: lead@example\.test\r\n/);

    assert.deepEqual(w.updates, [{ lastErrorMessage: null }]);
    assert.equal(w.insertedActivities.length, 1);
    assert.deepEqual(w.insertedActivities[0], {
      type: "email_sent",
      leadId: undefined,
      companyKey: undefined,
      personId: undefined,
      actorBdId: "bd-1",
      metadata: { to: "lead@example.test", subject: "Hello", gmailMessageId: "gmail-msg-1", gmailThreadId: "gmail-thread-1" },
    });
  } finally {
    w.restore();
  }
});

test("reply: threading headers and threadId reach Gmail", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({ reply: { inReplyTo: "<a@x>", references: "<a@x>", threadId: "thread-9" } });
    const { raw, threadId } = decodeSentRaw(w.fetchCalls[1]);
    assert.equal(threadId, "thread-9");
    assert.match(raw, /\r\nIn-Reply-To: <a@x>\r\n/);
    assert.match(raw, /\r\nReferences: <a@x>\r\n/);
  } finally {
    w.restore();
  }
});

test("a control character in To fails fast, before any read", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    assert.equal(await kindOf(send({ to: "a@x.test\r\nBcc: evil@x.test" })), "invalid_header");
    assert.equal(w.selectCalls.length, 0);
    assert.equal(w.fetchCalls.length, 0);
  } finally {
    w.restore();
  }
});
