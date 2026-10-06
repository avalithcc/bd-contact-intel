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

test("a bare Tel label (kind not stated) fills `phone`", () => {
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
  assert.deepEqual(plan, { fills: [], skippedHasNumber: 0, skippedConflict: 0, skippedConflictKindUnstated: 0, bothWritten: 0, personsWithNumbers: 0 });
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

const PAIR = [msg("m1", "p1", "Tel fijo: 4123 4567\nCel: 11 5555-0002")];

test("a labelled landline plus a labelled mobile are two facts, both written", () => {
  const plan = planSignaturePhones(PAIR, new Map([["p1", EMPTY]]));
  assert.deepEqual(plan.fills.map((f) => [f.column, f.value]), [["phone", "4123 4567"], ["mobilePhone", "11 5555-0002"]]);
  assert.equal(plan.bothWritten, 1);
  assert.equal(plan.skippedConflict, 0);
});

test("the same pair with one column already filled fills only the empty one", () => {
  const hasLandline = planSignaturePhones(PAIR, new Map([["p1", { phone: "4000 0000", mobilePhone: null }]]));
  assert.deepEqual(hasLandline.fills.map((f) => f.column), ["mobilePhone"]);
  const hasMobile = planSignaturePhones(PAIR, new Map([["p1", { phone: null, mobilePhone: "11 1111 1111" }]]));
  assert.deepEqual(hasMobile.fills.map((f) => f.column), ["phone"]);
  assert.equal(hasMobile.bothWritten, 0);
  const both = planSignaturePhones(PAIR, new Map([["p1", { phone: "4000 0000", mobilePhone: "11 1111 1111" }]]));
  assert.deepEqual([both.fills.length, both.skippedHasNumber], [0, 1]);
});

test("a number already stored in the other column is not duplicated", () => {
  const plan = planSignaturePhones(PAIR, new Map([["p1", { phone: "11-5555 0002", mobilePhone: null }]]));
  assert.deepEqual(plan.fills, []);
});

test("two different mobiles still refuse, even next to a landline column that is free", () => {
  const messages = [msg("m1", "p1", "Cel: 11 5555-0002"), msg("m2", "p1", "Móvil: 11 5555-0003")];
  const plan = planSignaturePhones(messages, new Map([["p1", EMPTY]]));
  assert.deepEqual([plan.fills.length, plan.skippedConflict], [0, 1]);
});

test("two different landlines still refuse", () => {
  const messages = [msg("m1", "p1", "Tel fijo: 4123 4567"), msg("m2", "p1", "Landline: 4123 9999")];
  const plan = planSignaturePhones(messages, new Map([["p1", EMPTY]]));
  assert.deepEqual([plan.fills.length, plan.skippedConflict], [0, 1]);
});

test("a conflicting mobile does not block an unrelated single landline", () => {
  const messages = [msg("m1", "p1", "Cel: 11 5555-0002\nTel fijo: 4123 4567"), msg("m2", "p1", "Cel: 11 5555-0003")];
  const plan = planSignaturePhones(messages, new Map([["p1", EMPTY]]));
  assert.deepEqual(plan.fills.map((f) => f.column), ["phone"]);
  assert.equal(plan.skippedConflict, 1);
});

test("a mix with an unlabelled-kind number is treated as one ambiguous set: no write", () => {
  const messages = [msg("m1", "p1", "Tel: 4123 4567\nCel: 11 5555-0002"), msg("m2", "p2", "Tel fijo: 4123 4567\n+54 11 5555 0002")];
  const plan = planSignaturePhones(messages, new Map([["p1", EMPTY], ["p2", EMPTY]]));
  assert.deepEqual([plan.fills.length, plan.skippedConflict, plan.skippedConflictKindUnstated], [0, 0, 2]);
});
