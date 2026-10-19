process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

import assert from "node:assert/strict";
import { test } from "node:test";
import { GmailSendError } from "@/lib/gmail/errors";
import { failureCode } from "@/lib/scheduledEmail/dispatch";
import { stateOf } from "@/lib/scheduledEmail/view";
import { buildFailureTask } from "@/lib/scheduledEmail/failureTask";
import type { SuppressionRule } from "@/lib/sequences/suppression";

const rules: SuppressionRule[] = [
  { ruleKind: "address", value: "optout@acme.test" },
  { ruleKind: "domain", value: "blocked.test" },
];

async function check(addresses: string[]) {
  const { assertNoSuppressedRecipients } = await import("@/lib/scheduledEmail/send");
  try {
    assertNoSuppressedRecipients(addresses, rules);
  } catch (e) {
    return e;
  }
  return null;
}

test("no suppressed address among the Para recipients: nothing thrown", async () => {
  assert.equal(await check(["a@acme.test", "b@acme.test"]), null);
});

test("ANY suppressed Para address stops the whole email, with a code that means 'provably not sent'", async () => {
  for (const list of [["a@acme.test", "optout@acme.test"], ["a@acme.test", "someone@blocked.test"], ["OPTOUT@acme.test"]]) {
    const err = await check(list);
    assert.ok(err instanceof GmailSendError, JSON.stringify(list));
    assert.equal(failureCode(err), "recipient_suppressed");
  }
});

test("the failure is shown as a plain failure and explained to the BD, never a silent drop", () => {
  assert.equal(stateOf({ status: "failed", sendAt: new Date(), error: "recipient_suppressed" }, new Date()), "failed_other");
  const task = buildFailureTask({ id: "s1", bdId: "b", personId: "p", personName: "Ana", subject: "Hola", error: "recipient_suppressed" }, new Date());
  assert.match(task.description, /dio de baja|baja|no quiere recibir/i);
  assert.match(task.description, /no salió/);
});
