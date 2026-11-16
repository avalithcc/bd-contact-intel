/**
 * The enforcement half of the subject rule. subjectRules.ts proves the CHECK is right; this proves the generator
 * actually acts on it, which is the part that did not exist while 10 of 25 live subjects broke the rule.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { SUBJECT_RETRY_ATTEMPTS, runGenerateOutreachMessage } from "@/lib/outreach/generateMessage";

const input = {
  contact: { firstName: "Ana", lastName: "Lee", jobTitle: "VP Engineering", roleGroup: null, industry: null },
  company: null,
  history: [],
  senderName: "Cristian Civita",
  language: "es",
  channel: "email",
} as unknown as Parameters<typeof runGenerateOutreachMessage>[0];

type Call = { prompt?: string };
const BAD = '{"subject":"Capacidad senior de ingeniería para tu equipo","body":"cuerpo"}';
const GOOD = '{"subject":"Backend en Card y Fraud, sin pisar a RRHH","body":"cuerpo"}';

/** Returns each queued response in turn, repeating the last one once the queue runs out. */
function fakeSequence(responses: string[], calls: Call[] = []) {
  let i = 0;
  return (async (args: Call) => {
    calls.push(args);
    const text = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return { text, finishReason: "stop" };
  }) as unknown as Parameters<typeof runGenerateOutreachMessage>[2];
}

test("a subject that breaks the rule is regenerated instead of shipped", async () => {
  const calls: Call[] = [];
  const r = await runGenerateOutreachMessage(input, 0, fakeSequence([BAD, GOOD], calls));
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.subject, "Backend en Card y Fraud, sin pisar a RRHH");
  assert.equal(calls.length, 2, "one generation plus one retry");
});

test("the retry is TOLD what it broke, rather than asked again blindly", async () => {
  const calls: Call[] = [];
  await runGenerateOutreachMessage(input, 0, fakeSequence([BAD, GOOD], calls));
  const retryPrompt = calls[1]!.prompt ?? "";
  assert.ok(retryPrompt.includes("REJECTED"), retryPrompt.slice(-400));
  assert.ok(retryPrompt.includes("Capacidad senior de ingeniería para tu equipo"), "it must quote the rejected subject");
  assert.ok(retryPrompt.includes("capacidad senior"), "it must name the term that was banned");
});

test("a subject that already obeys the rule costs no extra generation", async () => {
  const calls: Call[] = [];
  const r = await runGenerateOutreachMessage(input, 0, fakeSequence([GOOD], calls));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});

test("retries are capped, and a still-bad draft is returned rather than lost", async () => {
  const calls: Call[] = [];
  const r = await runGenerateOutreachMessage(input, 0, fakeSequence([BAD], calls));
  assert.equal(calls.length, SUBJECT_RETRY_ATTEMPTS + 1, "the first call plus the capped retries, and no more");
  // A BD can edit a flawed subject; a BD cannot edit a draft that was never produced.
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.subject, "Capacidad senior de ingeniería para tu equipo");
});

test("the split form is caught too, so it costs a retry like the exact phrase", async () => {
  const calls: Call[] = [];
  const split = '{"subject":"Capacidad de ingeniería senior para tu equipo","body":"cuerpo"}';
  await runGenerateOutreachMessage(input, 0, fakeSequence([split, GOOD], calls));
  assert.equal(calls.length, 2);
});

test("a subject naming the sender is rejected", async () => {
  const calls: Call[] = [];
  const named = '{"subject":"Cristian sobre los roles de backend","body":"cuerpo"}';
  await runGenerateOutreachMessage(input, 0, fakeSequence([named, GOOD], calls));
  assert.equal(calls.length, 2, "senderName comes from the input, so the check must use it");
});
