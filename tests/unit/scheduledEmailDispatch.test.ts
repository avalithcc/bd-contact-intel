import assert from "node:assert/strict";
import { test } from "node:test";
import { GmailSendError } from "@/lib/gmail/errors";
import { failureCode, dispatchScheduledEmails, type RunDeps } from "@/lib/scheduledEmail/dispatch";
import { isSessionExemptPath } from "@/lib/auth/sessionExemptRoutes";
import { isValidBearer } from "@/lib/cronAuth";

test("failure codes are fixed strings: not-connected, provably-unsent, or unknown outcome", () => {
  assert.equal(failureCode(new GmailSendError("reauth_required", "token=SECRET")), "gmail_not_connected");
  assert.equal(failureCode(new GmailSendError("not_connected", "x")), "gmail_not_connected");
  assert.equal(failureCode(new GmailSendError("temporary", "x")), "gmail_unavailable");
  assert.equal(failureCode(new GmailSendError("send_failed", "x", undefined, 403)), "gmail_unavailable");
  assert.equal(failureCode(new GmailSendError("send_failed", "x", undefined, 503)), "outcome_unknown");
  assert.equal(failureCode(new GmailSendError("send_failed", "x")), "outcome_unknown");
  assert.equal(failureCode(new TypeError("fetch failed")), "outcome_unknown");
});

function fakeDeps(over: Partial<RunDeps> = {}) {
  const calls: string[] = [];
  const row = (id: string) => ({ id }) as never;
  const deps: RunDeps = {
    holdReplied: async () => (calls.push("hold"), 0),
    claimDue: async () => (calls.push("claim"), [row("a"), row("b")]),
    countDue: async () => (calls.push("count"), 7),
    sweepStale: async () => (calls.push("sweep"), 0),
    send: async (r) => (calls.push(`send:${r.id}`), { messageId: `m-${r.id}` }),
    markSent: async (id, m) => void calls.push(`sent:${id}:${m}`),
    markFailed: async (id, c) => void calls.push(`failed:${id}:${c}`),
    ...over,
  };
  return { deps, calls };
}

test("a dry run only counts", async () => {
  const { deps, calls } = fakeDeps();
  const summary = await dispatchScheduledEmails(deps, { dryRun: true });
  assert.deepEqual(calls, ["count"]);
  assert.equal(summary.due, 7);
});

test("one failing row does not stop the batch and is marked failed with a code, never retried in the run", async () => {
  const { deps, calls } = fakeDeps({
    send: async (r) => {
      calls2.push(r.id);
      if (r.id === "a") throw new GmailSendError("reauth_required", "boom");
      return { messageId: "m-b" };
    },
  });
  const calls2: string[] = [];
  const summary = await dispatchScheduledEmails(deps, { dryRun: false });
  assert.deepEqual(calls2, ["a", "b"]);
  assert.ok(calls.includes("failed:a:gmail_not_connected"));
  assert.ok(calls.includes("sent:b:m-b"));
  assert.deepEqual([summary.sent, summary.failed], [1, 1]);
});

test("the dispatcher route is session-exempt and an unset secret never authorizes", () => {
  assert.equal(isSessionExemptPath("/api/email/scheduled/run"), true);
  assert.equal(isSessionExemptPath("/api/email/scheduled"), false);
  assert.equal(isValidBearer("Bearer x", undefined), false);
  assert.equal(isValidBearer(null, "x"), false);
});
