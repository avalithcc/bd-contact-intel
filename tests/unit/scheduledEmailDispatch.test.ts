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
  const row = (id: string) => ({ id, toAddress: `${id}@prospect.test` }) as never;
  const deps: RunDeps = {
    holdReplied: async () => (calls.push("hold"), 0),
    claimDue: async () => (calls.push("claim"), [row("a"), row("b")]),
    countDue: async () => (calls.push("count"), 7),
    sweepStale: async () => (calls.push("sweep"), 0),
    send: async (r) => (calls.push(`send:${r.id}`), { messageId: `m-${r.id}` }),
    markSent: async (id, m) => void calls.push(`sent:${id}:${m}`),
    markFailed: async (id, c) => void calls.push(`failed:${id}:${c}`),
    loadSuppression: async () => (calls.push("rules"), []),
    markCancelled: async (id, c) => void calls.push(`cancelled:${id}:${c}`),
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

test("a sent mail whose bookkeeping throws is never marked failed: it is counted and left as is", async () => {
  const { deps, calls } = fakeDeps({
    markSent: async (id) => {
      calls.push(`sent-attempt:${id}`);
      if (id === "a") throw new Error("db down");
    },
  });
  const summary = await dispatchScheduledEmails(deps, { dryRun: false });
  assert.ok(!calls.some((c) => c.startsWith("failed:")), "no markFailed after a successful send");
  assert.ok(calls.includes("sent-attempt:b"), "the batch carries on");
  assert.deepEqual([summary.sent, summary.failed, summary.unrecorded], [1, 0, 1]);
});

test("a suppressed recipient is cancelled right before sending, never sent, and does not stop the batch", async () => {
  const rows = [{ id: "a", toAddress: "Out@Prospect.test" }, { id: "b", toAddress: "ok@prospect.test" }, { id: "c", toAddress: "x@blocked.test" }];
  const { deps, calls } = fakeDeps({
    claimDue: async () => rows as never,
    loadSuppression: async () => [
      { ruleKind: "address", value: "out@prospect.test" },
      { ruleKind: "domain", value: "blocked.test" },
    ],
  });
  const summary = await dispatchScheduledEmails(deps, { dryRun: false });
  assert.deepEqual(calls.filter((c) => c.startsWith("send:")), ["send:b"]);
  assert.ok(calls.includes("cancelled:a:recipient_suppressed"));
  assert.ok(calls.includes("cancelled:c:recipient_suppressed"));
  assert.deepEqual([summary.sent, summary.cancelled, summary.failed], [1, 2, 0]);
});

test("the suppression list is read once per run, and not at all when nothing is due", async () => {
  const many = fakeDeps({ claimDue: async () => [{ id: "a", toAddress: "a@x.test" }, { id: "b", toAddress: "b@x.test" }] as never });
  await dispatchScheduledEmails(many.deps, { dryRun: false });
  assert.equal(many.calls.filter((c) => c === "rules").length, 1);
  const none = fakeDeps({ claimDue: async () => [] });
  await dispatchScheduledEmails(none.deps, { dryRun: false });
  assert.equal(none.calls.includes("rules"), false);
});

test("a failing suppression read fails closed: nothing is sent and the claimed rows are failed with a provably-unsent code", async () => {
  const { deps, calls } = fakeDeps({
    claimDue: async () => [{ id: "a", toAddress: "a@x.test" }] as never,
    loadSuppression: async () => { throw new Error("db down"); },
  });
  const summary = await dispatchScheduledEmails(deps, { dryRun: false });
  assert.equal(calls.some((c) => c.startsWith("send:")), false);
  assert.ok(calls.includes("failed:a:gmail_unavailable"));
  assert.equal(summary.failed, 1);
});
