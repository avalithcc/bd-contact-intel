import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pickEmail, pickPhone } from "../../src/lib/lusha/parse";
import { planRevealedEmailWrite, planRevealedPhoneWrite, type RevealPerson } from "../../src/lib/lusha/revealPlan";
import { isReachable } from "../../src/lib/sequences/rosterGuards";

const BD = "bd-1";
const META = { actorBdId: BD, lushaId: "lu-1", creditsCharged: 1 };

const person = (over: Partial<RevealPerson> = {}): RevealPerson => ({
  id: "p-1",
  email: null,
  emailNormalized: null,
  emailStatus: "none",
  emailSource: null,
  emailConfidence: null,
  mergedIntoId: null,
  phone: null,
  mobilePhone: null,
  ...over,
});

const reachable = (p: RevealPerson) =>
  isReachable({ personId: p.id, email: p.email, emailStatus: p.emailStatus, emailSource: p.emailSource, mergedIntoId: p.mergedIntoId, companyKey: null, clientStatus: null });

// Real producer: the pick comes from pickEmail/pickPhone, never a hand-built object.
const emailPick = (list: unknown) => pickEmail(list);
const phonePick = (list: unknown) => pickPhone(list);

test("a revealed email is written probable/lusha and the Contact becomes Sequence-eligible through the real isReachable", () => {
  const p = person();
  assert.equal(reachable(p), false);
  const plan = planRevealedEmailWrite(p, emailPick([{ email: " Ana@Acme.com ", confidence: 90 }]), META);
  assert.ok(plan.personUpdate);
  assert.equal(plan.personUpdate.email, "Ana@Acme.com");
  assert.equal(plan.personUpdate.emailNormalized, "ana@acme.com");
  assert.equal(plan.personUpdate.emailStatus, "probable");
  assert.equal(plan.personUpdate.emailSource, "lusha");
  assert.equal(plan.personUpdate.emailConfidence, 90);
  assert.equal(reachable({ ...p, ...(plan.personUpdate as Partial<RevealPerson>) }), true);
});

test("history rows carry source lusha_reveal and keep the old value", () => {
  const p = person({ email: "guess@acme.com", emailNormalized: "guess@acme.com", emailStatus: "probable", emailSource: "pattern_inferred" });
  const plan = planRevealedEmailWrite(p, emailPick([{ email: "ana@acme.com" }]), META);
  assert.ok(plan.personUpdate, "pattern_inferred is overwritten");
  assert.ok(plan.historyRows.length >= 3);
  assert.ok(plan.historyRows.every((r) => r.source === "lusha_reveal" && r.changedByBdId === BD && r.personId === "p-1"));
  const email = plan.historyRows.find((r) => r.property === "email");
  assert.deepEqual([email?.oldValue, email?.newValue], ["guess@acme.com", "ana@acme.com"]);
  assert.equal(plan.historyRows.find((r) => r.property === "emailSource")?.newValue, "lusha");
});

test("a reachable email is never overwritten (verified, or already probable from a real source)", () => {
  for (const over of [
    { email: "a@b.co", emailNormalized: "a@b.co", emailStatus: "verified", emailSource: "apollo" },
    { email: "a@b.co", emailNormalized: "a@b.co", emailStatus: "probable", emailSource: "lusha" },
  ]) {
    const plan = planRevealedEmailWrite(person(over), emailPick([{ email: "x@y.co" }]), META);
    assert.equal(plan.personUpdate, null);
    assert.equal(plan.activity, null);
  }
});

test("a merged-away Contact is never written", () => {
  const plan = planRevealedEmailWrite(person({ mergedIntoId: "p-2" }), emailPick([{ email: "x@y.co" }]), META);
  assert.equal(plan.personUpdate, null);
});

test("the email activity is lusha_reveal with the actor and the field/credits/lushaId metadata", () => {
  const plan = planRevealedEmailWrite(person(), emailPick([{ email: "x@y.co" }]), META);
  assert.deepEqual(plan.activity, {
    type: "lusha_reveal",
    personId: "p-1",
    actorBdId: BD,
    metadata: { field: "emails", creditsCharged: 1, lushaId: "lu-1" },
  });
});

test("an empty or unparsable email pick writes nothing", () => {
  for (const raw of [[], undefined, "nope", [{ email: "not-an-email" }]]) {
    const plan = planRevealedEmailWrite(person(), emailPick(raw), META);
    assert.deepEqual([plan.personUpdate, plan.historyRows, plan.activity], [null, [], null]);
  }
});

test("the planners never mutate their inputs and are repeatable", () => {
  const p = person({ phone: "111 1111111" });
  const frozen = JSON.stringify(p);
  const pick = phonePick([{ number: "+54 11 5555 5555", type: "mobile" }]);
  const pickFrozen = JSON.stringify(pick);
  const a = planRevealedPhoneWrite(Object.freeze({ ...p }), pick, META);
  const b = planRevealedPhoneWrite(Object.freeze({ ...p }), pick, META);
  assert.equal(JSON.stringify(p), frozen);
  assert.equal(JSON.stringify(pick), pickFrozen);
  assert.deepEqual(a.personUpdate && { ...a.personUpdate, updatedAt: 0 }, b.personUpdate && { ...b.personUpdate, updatedAt: 0 });
  assert.deepEqual(a.historyRows, b.historyRows);
  const e1 = planRevealedEmailWrite(Object.freeze(person()), emailPick([{ email: "x@y.co" }]), META);
  const e2 = planRevealedEmailWrite(Object.freeze(person()), emailPick([{ email: "x@y.co" }]), META);
  assert.deepEqual(e1.historyRows, e2.historyRows);
});

test("phone: mobile goes to mobilePhone, anything else to phone", () => {
  assert.equal(planRevealedPhoneWrite(person(), phonePick([{ number: "+54 11 5555 5555", type: "mobile" }]), META).personUpdate?.mobilePhone, "+54 11 5555 5555");
  const direct = planRevealedPhoneWrite(person(), phonePick([{ number: "+54 11 5555 5555", type: "direct" }]), META);
  assert.equal(direct.personUpdate?.phone, "+54 11 5555 5555");
  assert.equal(direct.personUpdate?.mobilePhone, undefined);
  assert.equal(direct.historyRows[0]?.source, "lusha_reveal");
});

test("phone: the occupied target falls back to the other column when empty", () => {
  const mobile = phonePick([{ number: "+54 11 5555 5555", type: "mobile" }]);
  const plan = planRevealedPhoneWrite(person({ mobilePhone: "+54 11 1111 1111" }), mobile, META);
  assert.equal(plan.personUpdate?.phone, "+54 11 5555 5555");
  assert.equal(plan.personUpdate?.mobilePhone, undefined);
});

test("phone: both columns occupied overwrites nothing, no history, but the reveal is still an activity", () => {
  const plan = planRevealedPhoneWrite(person({ phone: "111 1111111", mobilePhone: "222 2222222" }), phonePick([{ number: "+54 11 5555 5555", type: "mobile" }]), META);
  assert.deepEqual([plan.personUpdate, plan.historyRows], [null, []]);
  assert.equal(plan.activity?.metadata.field, "phones");
});

test("phone: an unexpected shape fails closed, no person write and no activity (D17)", () => {
  for (const raw of [[{ phoneNumber: "+54 11 5555 5555" }], [{ number: 5555555 }], "tel:+54", { number: "+54 11 5555 5555" }]) {
    const pick = phonePick(raw);
    assert.equal(pick.ok, false);
    const plan = planRevealedPhoneWrite(person(), pick, META);
    assert.deepEqual([plan.personUpdate, plan.historyRows, plan.activity], [null, [], null]);
  }
});

test("the planner module does not use the manual edit path", () => {
  const src = readFileSync("src/lib/lusha/revealPlan.ts", "utf8");
  const imports = src.split("\n").filter((l) => l.startsWith("import")).join("\n");
  assert.doesNotMatch(imports, /updateContactProperty|planPropertyEdit|propertyEdit/);
});
