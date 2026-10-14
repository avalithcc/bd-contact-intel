import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { bodyHasFooter } from "@/lib/sequences/complianceFooter";
import {
  composeDraft,
  footerRemovedOnSave,
  isMarketMapped,
  runDraftBatch,
} from "@/lib/sequences/draftCompose";

const URL = "https://example.test/unsubscribe/tok";
const generated = { subject: "Senior capacity", body: "Hi Ana,\n\nShort pitch.\n\nCristian Civita" };

test("a mapped market gets the footer appended after the body, unmodified", () => {
  const draft = composeDraft(generated, "us", URL)!;
  assert.ok(draft.body.startsWith(generated.body));
  assert.ok(draft.body.endsWith(URL));
  assert.equal(bodyHasFooter(draft.body, COMPLIANCE_CONFIG, "us"), true);
});

test("the footer is added by the system even when the model body has no address", () => {
  assert.equal(bodyHasFooter(generated.body, COMPLIANCE_CONFIG, "us"), false);
  assert.equal(bodyHasFooter(composeDraft(generated, "latam", URL)!.body, COMPLIANCE_CONFIG, "latam"), true);
});

test("an unmapped market has no footer to append: composeDraft yields nothing", () => {
  assert.equal(composeDraft(generated, "other", URL), null);
  assert.equal(isMarketMapped("other"), false);
  assert.equal(isMarketMapped("us"), true);
  assert.equal(isMarketMapped("latam"), true);
});

test("saving a body without the footer warns; keeping it does not; an unmapped market never warns here", () => {
  const withFooter = composeDraft(generated, "us", URL)!.body;
  assert.equal(footerRemovedOnSave(withFooter, "us"), false);
  assert.equal(footerRemovedOnSave(generated.body, "us"), true);
  assert.equal(footerRemovedOnSave(generated.body, "other"), false);
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
