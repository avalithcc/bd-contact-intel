import assert from "node:assert/strict";
import { test } from "node:test";
import {
  columnFor,
  parseResolvedPhonesJson,
  planResolvedPhones,
  ResolvedPhoneError,
  type ResolvedPhoneInput,
  type ResolvedPhonePerson,
} from "@/lib/resolvedPhones/plan";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ok = () => true;
const empty = (id: string): ResolvedPhonePerson => ({ id, phone: null, mobilePhone: null });
const input = (over: Partial<ResolvedPhoneInput> = {}): ResolvedPhoneInput => ({ personId: A, number: "+54 9 11 4993 8553", kind: "mobile", ...over });

test("kind decides the column, never the digits", () => {
  assert.equal(columnFor("mobile"), "mobilePhone");
  assert.equal(columnFor("landline"), "phone");
  // A bare "Tel:" or an unlabelled "+" number: unknown kind lands in phone.
  assert.equal(columnFor("generic"), "phone");
});

test("writes each number into the column its label implies", () => {
  const writes = planResolvedPhones(
    [input(), input({ personId: B, kind: "generic", number: "+54 11 3986-3700" })],
    [empty(A), empty(B)],
    ok,
  );
  assert.deepEqual(writes, [
    { personId: A, column: "mobilePhone", value: "+54 9 11 4993 8553" },
    { personId: B, column: "phone", value: "+54 11 3986-3700" },
  ]);
});

test("a person who already has that column refuses the whole run", () => {
  assert.throws(
    () => planResolvedPhones([input()], [{ id: A, phone: null, mobilePhone: "+54 9 11 0000 0000" }], ok),
    ResolvedPhoneError,
  );
});

test("the other column being taken is not a collision", () => {
  const writes = planResolvedPhones([input()], [{ id: A, phone: "+54 11 4000-0000", mobilePhone: null }], ok);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.column, "mobilePhone");
});

test("whitespace in the target column still counts as empty", () => {
  const writes = planResolvedPhones([input()], [{ id: A, phone: null, mobilePhone: "   " }], ok);
  assert.equal(writes.length, 1);
});

test("an unknown person refuses the run rather than skipping the entry", () => {
  assert.throws(() => planResolvedPhones([input()], [], ok), ResolvedPhoneError);
});

test("a number the validator rejects refuses the whole run", () => {
  assert.throws(() => planResolvedPhones([input()], [empty(A)], () => false), ResolvedPhoneError);
});

test("two entries aiming at the same column are refused", () => {
  assert.throws(() => planResolvedPhones([input(), input({ number: "+54 9 11 1111 1111" })], [empty(A)], ok), ResolvedPhoneError);
});

test("the same person may take both columns", () => {
  const writes = planResolvedPhones([input(), input({ kind: "landline", number: "+54 11 4000-0000" })], [empty(A)], ok);
  assert.deepEqual(writes.map((w) => w.column), ["mobilePhone", "phone"]);
});

test("an empty input list is refused", () => {
  assert.throws(() => planResolvedPhones([], [empty(A)], ok), ResolvedPhoneError);
});

test("the planner does not mutate its inputs and is repeatable", () => {
  const inputs = [input()];
  const persons = [empty(A)];
  const snapshot = JSON.stringify([inputs, persons]);
  assert.deepEqual(planResolvedPhones(inputs, persons, ok), planResolvedPhones(inputs, persons, ok));
  assert.equal(JSON.stringify([inputs, persons]), snapshot);
});

test("json parsing names the offending entry", () => {
  assert.deepEqual(parseResolvedPhonesJson(`[{"personId":"${A}","number":"+54 9 11 4993 8553","kind":"mobile"}]`), [
    { personId: A, number: "+54 9 11 4993 8553", kind: "mobile" },
  ]);
  assert.throws(() => parseResolvedPhonesJson("nope"), /not valid JSON/);
  assert.throws(() => parseResolvedPhonesJson('{"personId":"x"}'), /must be an array/);
  assert.throws(() => parseResolvedPhonesJson('[{"number":"+1","kind":"mobile"}]'), /entry 1: missing "personId"/);
  assert.throws(() => parseResolvedPhonesJson(`[{"personId":"${A}","kind":"mobile"}]`), /entry 1: missing "number"/);
  assert.throws(() => parseResolvedPhonesJson(`[{"personId":"${A}","number":"+1","kind":"cell"}]`), /entry 1: "kind" must be/);
  assert.throws(() => parseResolvedPhonesJson(`[{"personId":"${A}","number":"+1","kind":"mobile"},{"personId":"${B}","number":"+2"}]`), /entry 2/);
});

test("a number containing a colon or comma survives the json input", () => {
  // The reason this takes JSON and not a delimited line format.
  const [entry] = parseResolvedPhonesJson(`[{"personId":"${A}","number":"+54 11 4000-0000 ext: 12,3","kind":"generic"}]`);
  assert.equal(entry!.number, "+54 11 4000-0000 ext: 12,3");
});
