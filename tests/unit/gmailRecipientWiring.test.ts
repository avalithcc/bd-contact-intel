import assert from "node:assert/strict";
import { test } from "node:test";
import { contactActionErrorReason } from "@/app/(app)/contacts/actionErrors";
import { contactActionErrorMessage } from "@/lib/contacts/labels";
import { es } from "@/lib/i18n/dictionaries/es";
import { assertSingleRecipient } from "@/lib/gmail/recipient";
import { dispatchScheduledEmails, failureCode, type RunDeps } from "@/lib/scheduledEmail/dispatch";

function thrownBy(to: string): unknown {
  try {
    assertSingleRecipient(to);
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

test("the typed errors map to a Spanish reason shown to the BD", () => {
  assert.equal(contactActionErrorReason(thrownBy("a@x.com, b@y.com")), "multiple_recipients");
  assert.equal(contactActionErrorReason(thrownBy("not-an-email")), "invalid_email");
  const labels = es.contactRecord as never;
  assert.match(contactActionErrorMessage(labels, "multiple_recipients"), /un destinatario/);
  assert.match(contactActionErrorMessage(labels, "invalid_email"), /correo electrónico válido/);
});

test("a stored scheduled row with a bad address fails cleanly: marked failed, the rest of the batch still goes", async () => {
  const calls: string[] = [];
  const deps: RunDeps = {
    holdReplied: async () => 0,
    sweepStale: async () => 0,
    countDue: async () => 2,
    claimDue: async () => [{ id: "bad", toAddress: "a@x.com; b@y.com" }, { id: "ok", toAddress: "c@z.com" }] as never,
    loadSuppression: async () => [],
    send: async (r) => {
      assertSingleRecipient(r.toAddress);
      return { messageId: `m-${r.id}` };
    },
    markSent: async (id) => void calls.push(`sent:${id}`),
    markFailed: async (id, code) => void calls.push(`failed:${id}:${code}`),
    markCancelled: async () => undefined,
    releaseClaimed: async () => undefined,
  };
  const summary = await dispatchScheduledEmails(deps, { dryRun: false });
  assert.deepEqual(calls, ["failed:bad:gmail_unavailable", "sent:ok"]);
  assert.deepEqual([summary.sent, summary.failed], [1, 1]);
  assert.equal(failureCode(thrownBy("nope")), "gmail_unavailable");
});
