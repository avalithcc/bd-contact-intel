import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { bodyHasFooter } from "@/lib/sequences/complianceFooter";
import {
  composeDraft,
  footerRemovedOnSave,
  runDraftBatch,
} from "@/lib/sequences/draftCompose";

const URL = "https://example.test/unsubscribe/tok";
const generated = { subject: "Senior capacity", body: "Hi Ana,\n\nShort pitch.\n\nCristian Civita" };

test("an address gets the footer appended after the body, unmodified", () => {
  const draft = composeDraft(generated, "miami", "en", URL)!;
  assert.ok(draft.body.startsWith(generated.body));
  assert.ok(draft.body.endsWith(URL));
  assert.equal(bodyHasFooter(draft.body, COMPLIANCE_CONFIG, "miami"), true);
});

test("the footer is added by the system even when the model body has no address", () => {
  assert.equal(bodyHasFooter(generated.body, COMPLIANCE_CONFIG, "miami"), false);
  assert.equal(bodyHasFooter(composeDraft(generated, "mdp", "en", URL)!.body, COMPLIANCE_CONFIG, "mdp"), true);
});

test("an address with no config entry has no footer to append: composeDraft yields nothing", () => {
  assert.equal(composeDraft(generated, "nowhere" as never, "en", URL), null);
});

test("saving a body without the footer warns; keeping it does not; another address's footer does not count", () => {
  const withFooter = composeDraft(generated, "miami", "en", URL)!.body;
  assert.equal(footerRemovedOnSave(withFooter, "miami"), false);
  assert.equal(footerRemovedOnSave(generated.body, "miami"), true);
  assert.equal(footerRemovedOnSave(withFooter, "mdp"), true);
});

test("one generator failure among ten leaves nine drafts and a retryable member", async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const calls: string[] = [];
  const result = await runDraftBatch(ids, async (id) => {
    calls.push(id);
    if (id === "m4") throw new Error("gateway down");
    return id === "m7" ? "skipped" : "generated";
  });
  assert.deepEqual(calls, ids, "sequential and in order, every member attempted");
  assert.equal(result.generated.length, 8);
  assert.deepEqual(result.skipped, ["m7"]);
  assert.deepEqual(result.failed, ["m4"]);
});

test("the batch never runs two generations at once", async () => {
  let inFlight = 0;
  let peak = 0;
  await runDraftBatch(["a", "b", "c"], async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    return "generated";
  });
  assert.equal(peak, 1);
});

test("a failed member's reason is kept next to its id so a caller can show why", async () => {
  const result = await runDraftBatch(["a", "b"], async (id) => {
    if (id === "b") throw new Error("generation failed: gatewayNotConfigured");
    return "generated";
  });
  assert.deepEqual(result.failed, ["b"]);
  assert.deepEqual(result.reasons, { b: "generation failed: gatewayNotConfigured" });
});

test("a non-Error throw is recorded as its string form", async () => {
  const result = await runDraftBatch(["a"], async () => {
    throw "plain string failure";
  });
  assert.deepEqual(result.reasons, { a: "plain string failure" });
});

test("a long reason is capped and a credential-looking blob is redacted", async () => {
  const result = await runDraftBatch(["a", "b"], async (id) => {
    throw new Error(id === "a" ? "x ".repeat(1000) : "auth failed Bearer abcdefghijklmnopqrstuvwxyz0123456789");
  });
  assert.ok(result.reasons.a.length <= 300);
  assert.ok(!result.reasons.b.includes("abcdefghij"));
});
