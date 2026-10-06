import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSenderPhones } from "@/lib/signaturePhones/extract";
import { planSignaturePhones, type ExtractedMessage, type PersonPhoneState } from "@/lib/signaturePhones/plan";

const EMPTY: PersonPhoneState = { phone: null, mobilePhone: null };
// Fixtures come from the real producer, never hand-built.
const msg = (messageId: string, personId: string, body: string): ExtractedMessage => ({ messageId, personId, phones: extractSenderPhones(body).phones });

test("fills an empty person and records how many distinct messages agreed", () => {
  const messages = [msg("m1", "p1", "Cel: 11 5555-0002"), msg("m2", "p1", "Móvil: 11-5555-0002"), msg("m3", "p1", "Gracias")];
  const plan = planSignaturePhones(messages, new Map([["p1", EMPTY]]));
  assert.deepEqual(plan.fills, [{ personId: "p1", column: "mobilePhone", value: "11 5555-0002", supportingMessages: 2 }]);
});

test("a landline label fills `phone`", () => {
  const plan = planSignaturePhones([msg("m1", "p1", "Tel: 4123 4567")], new Map([["p1", EMPTY]]));
  assert.equal(plan.fills[0]?.column, "phone");
});

test("two different numbers means no write and one conflict", () => {
  const messages = [msg("m1", "p1", "Cel: 11 5555-0002"), msg("m2", "p1", "Cel: 11 5555-0003"), msg("m3", "p1", "Cel: 11 5555-0003")];
  const plan = planSignaturePhones(messages, new Map([["p1", EMPTY]]));
  assert.deepEqual(plan.fills, []);
  assert.equal(plan.skippedConflict, 1);
});

test("a person who already has a number is skipped, never overwritten", () => {
  const messages = [msg("m1", "p1", "Cel: 11 5555-0002"), msg("m2", "p2", "Cel: 11 5555-0004")];
  const persons = new Map<string, PersonPhoneState>([["p1", { phone: "4123 4567", mobilePhone: null }], ["p2", { phone: null, mobilePhone: " " }]]);
  const plan = planSignaturePhones(messages, persons);
  assert.deepEqual(plan.fills.map((f) => f.personId), ["p2"]);
  assert.equal(plan.skippedHasNumber, 1);
});

test("messages for an unknown person are ignored", () => {
  const plan = planSignaturePhones([msg("m1", "ghost", "Cel: 11 5555-0002")], new Map());
  assert.deepEqual(plan, { fills: [], skippedHasNumber: 0, skippedConflict: 0, personsWithNumbers: 0 });
});

test("pure: same input twice gives the same plan and the input is untouched", () => {
  const messages = [msg("m2", "p1", "Cel: 11 5555-0002"), msg("m1", "p1", "Cel: 11 5555-0002"), msg("m3", "p2", "Cel: 11 5555-0005")];
  const persons = new Map<string, PersonPhoneState>([["p1", EMPTY], ["p2", { ...EMPTY }]]);
  const before = structuredClone({ messages, persons: [...persons] });
  const a = planSignaturePhones(messages, persons);
  const b = planSignaturePhones(messages, persons);
  assert.deepEqual(a, b);
  assert.deepEqual({ messages, persons: [...persons] }, before);
});
