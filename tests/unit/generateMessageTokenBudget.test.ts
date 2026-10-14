import { test } from "node:test";
import assert from "node:assert/strict";
import { runGenerateOutreachMessage } from "@/lib/outreach/generateMessage";

const input = {
  contact: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null },
  company: null,
  history: [],
  senderName: "Cristian Civita",
  language: "en",
  channel: "email",
} as unknown as Parameters<typeof runGenerateOutreachMessage>[0];

type Call = { maxOutputTokens?: number };
const fake = (text: string, finishReason: string, calls: Call[] = []) =>
  (async (args: Call) => {
    calls.push(args);
    return { text, finishReason };
  }) as unknown as Parameters<typeof runGenerateOutreachMessage>[2];

test("the output cap leaves room for the model's reasoning tokens (reasoning alone reached 500)", async () => {
  const calls: Call[] = [];
  await runGenerateOutreachMessage(input, 0, fake('{"subject":"s","body":"b"}', "stop", calls));
  assert.ok(calls[0]!.maxOutputTokens! >= 1500);
});

test("a cut-off generation is invalid output even when the truncated text happens to parse", async () => {
  const r = await runGenerateOutreachMessage(input, 0, fake('{"subject":"s","body":"b"}', "length"));
  assert.deepEqual(r, { ok: false, errorKey: "invalidModelOutput" });
});

test("a complete generation still parses", async () => {
  const r = await runGenerateOutreachMessage(input, 0, fake('{"subject":"s","body":"b"}', "stop"));
  assert.equal(r.ok, true);
});
