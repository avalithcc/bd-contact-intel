import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pickEmail, pickPhone, pickPhones } from "../../src/lib/lusha/parse";
import { planRevealedEmailWrite, planRevealedPhoneWrite, planRevealedPhonesWrite, type RevealPerson } from "../../src/lib/lusha/revealPlan";
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
  assert.equal(planRevealedPhoneWrite(person(), phonePick([{ number: "+54 11 5555 5555", type: "mobile" }]), META).personUpdate?.mobilePhone, "+541155555555");
  const direct = planRevealedPhoneWrite(person(), phonePick([{ number: "+54 11 5555 5555", type: "direct" }]), META);
  assert.equal(direct.personUpdate?.phone, "+541155555555");
  assert.equal(direct.personUpdate?.mobilePhone, undefined);
  assert.equal(direct.historyRows[0]?.source, "lusha_reveal");
});

test("phone: the occupied target falls back to the other column when empty", () => {
  const mobile = phonePick([{ number: "+54 11 5555 5555", type: "mobile" }]);
  const plan = planRevealedPhoneWrite(person({ mobilePhone: "+54 11 1111 1111" }), mobile, META);
  assert.equal(plan.personUpdate?.phone, "+541155555555");
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

test("a revealed phone whose digits equal a held phone writes nothing and says it was already held", () => {
  const pick = phonePick([{ number: "+54 (11) 5555-5555", type: "mobile" }]);
  for (const held of [{ phone: "541155555555" }, { mobilePhone: "+54 11 5555 5555" }]) {
    const plan = planRevealedPhoneWrite(person(held), pick, META);
    assert.deepEqual([plan.personUpdate, plan.historyRows, plan.activity, plan.alreadyHeld], [null, [], null, true], JSON.stringify(held));
  }
  // A different number is still placed in the free column.
  assert.equal(planRevealedPhoneWrite(person({ phone: "+54 11 4444 4444" }), pick, META).personUpdate?.mobilePhone, "+541155555555");
});

// --- two numbers from ONE reveal --------------------------------------------------------------------------------------------

const W = { number: "+54 11 4000 0001", type: "work" };
const M = { number: "+54 9 11 5000 0002", type: "mobile" };
const WN = "+541140000001"; // the E.164 form stored for W
const MN = "+5491150000002"; // the E.164 form stored for M
const both = (p: RevealPerson, list: unknown[]) => planRevealedPhonesWrite(p, pickPhones(list), META);
const cols = (plan: ReturnType<typeof both>) => plan.historyRows.map((h) => [h.property, h.newValue, h.source]);

test("phones: work + mobile fill both columns, one history row each, one activity", () => {
  const plan = both(person(), [M, W]);
  assert.deepEqual(plan.personUpdate && [plan.personUpdate.phone, plan.personUpdate.mobilePhone], [WN, MN]);
  assert.deepEqual(cols(plan), [["phone", WN, "lusha_reveal"], ["mobilePhone", MN, "lusha_reveal"]]);
  assert.equal(plan.activity?.metadata.field, "phones");
});

test("phones: only mobile or only work behave as the single write", () => {
  assert.equal(both(person(), [M]).personUpdate?.mobilePhone, MN);
  assert.equal(both(person(), [W]).personUpdate?.phone, WN);
  assert.equal(both(person({ phone: "111 1111111" }), [M]).personUpdate?.mobilePhone, MN);
  assert.equal(both(person({ phone: "111 1111111" }), [W]).personUpdate?.mobilePhone, WN, "single-number fallback is kept");
});

test("phones: two works place only the best one", () => {
  const plan = both(person(), [W, { number: "+54 11 4000 0009", type: "work" }]);
  assert.deepEqual(cols(plan), [["phone", WN, "lusha_reveal"]]);
  assert.equal(plan.personUpdate?.mobilePhone, undefined);
});

test("phones: a number already held (by digits) is skipped and never placed twice", () => {
  const plan = both(person({ phone: "+54 (11) 4000-0001" }), [W, M]);
  assert.deepEqual(cols(plan), [["mobilePhone", MN, "lusha_reveal"]]);
  assert.equal(plan.alreadyHeld, undefined);
  const all = both(person({ phone: "541140000001", mobilePhone: "5491150000002" }), [W, M]);
  assert.deepEqual([all.personUpdate, all.historyRows, all.activity, all.alreadyHeld], [null, [], null, true]);
  const same = planRevealedPhonesWrite(person(), [phonePick([W]), phonePick([{ ...W, number: "541140000001" }])], META);
  assert.deepEqual(cols(same), [["phone", WN, "lusha_reveal"]]);
});

test("phones: a column already full is never overwritten; the other number still lands", () => {
  const phoneFull = both(person({ phone: "111 1111111" }), [W, M]);
  assert.deepEqual(cols(phoneFull), [["mobilePhone", MN, "lusha_reveal"]]);
  const mobileFull = both(person({ mobilePhone: "222 2222222" }), [W, M]);
  assert.deepEqual(cols(mobileFull), [["phone", WN, "lusha_reveal"]]);
  const full = both(person({ phone: "111 1111111", mobilePhone: "222 2222222" }), [W, M]);
  assert.deepEqual([full.personUpdate, full.historyRows], [null, []]);
  assert.equal(full.activity?.metadata.field, "phones");
});

test("phones: the planner is repeatable and mutates nothing", () => {
  const p = Object.freeze(person());
  const picks = pickPhones([M, W]);
  const frozen = JSON.stringify(picks);
  const a = planRevealedPhonesWrite(p, picks, META);
  const b = planRevealedPhonesWrite(p, picks, META);
  assert.equal(JSON.stringify(picks), frozen);
  assert.deepEqual(a.historyRows, b.historyRows);
  assert.deepEqual(a.personUpdate && { ...a.personUpdate, updatedAt: 0 }, b.personUpdate && { ...b.personUpdate, updatedAt: 0 });
});

test("phones: the type is compared case-insensitively end to end (Mobile / MOBILE are mobile)", () => {
  for (const type of ["Mobile", "MOBILE"]) {
    const plan = both(person(), [{ ...M, type }, { ...W, type: "Work" }]);
    assert.deepEqual(plan.personUpdate && [plan.personUpdate.phone, plan.personUpdate.mobilePhone], [WN, MN], type);
    assert.deepEqual(cols(plan).map((c) => c[0]).sort(), ["mobilePhone", "phone"]);
    // The single-number planner agrees.
    assert.equal(planRevealedPhoneWrite(person(), phonePick([{ ...M, type }]), META).personUpdate?.mobilePhone, MN);
  }
});

test("phones: two fresh numbers with one target column already full from another source (mixed-case types)", () => {
  const mobile = { ...M, type: "Mobile" };
  const phoneFull = both(person({ phone: "111 1111111" }), [mobile, W]);
  assert.deepEqual(cols(phoneFull), [["mobilePhone", MN, "lusha_reveal"]]);
  const mobileFull = both(person({ mobilePhone: "222 2222222" }), [mobile, W]);
  assert.deepEqual(cols(mobileFull), [["phone", WN, "lusha_reveal"]]);
});

test("phone: the stored value is E.164 when the provider's layout can be normalized, as received when not", () => {
  const plan = planRevealedPhoneWrite(person(), phonePick([{ number: "+54 (11) 5555-5555", type: "mobile" }]), META);
  assert.equal(plan.personUpdate?.mobilePhone, "+541155555555");
  assert.equal(plan.historyRows[0]?.newValue, "+541155555555");
  assert.equal(planRevealedPhoneWrite(person(), phonePick([{ number: "011 5555-5555", type: "mobile" }]), META).personUpdate?.mobilePhone, "011 5555-5555");
});

test("countryIso2 from the reveal is surfaced on the pick and used as the country context for a local-format number", () => {
  const pick = phonePick([{ number: "(212) 555-0123", type: "mobile", countryIso2: "US" }]);
  assert.equal(pick.ok && pick.countryIso2, "US");
  const plan = planRevealedPhoneWrite(person(), pick, META);
  assert.equal(plan.personUpdate?.mobilePhone, "+12125550123");
  const without = planRevealedPhoneWrite(person(), phonePick([{ number: "(212) 555-0123", type: "mobile" }]), META);
  assert.equal(without.personUpdate?.mobilePhone, "(212) 555-0123", "no country context: stored as sent");
});

test("a lowercase countryIso2 is normalized and a malformed one is ignored", () => {
  const ok = phonePick([{ number: "2125550123", type: "mobile", countryIso2: "us" }]);
  assert.equal(ok.ok && ok.countryIso2, "US");
  const bad = phonePick([{ number: "2125550123", type: "mobile", countryIso2: "USA" }]);
  assert.equal(bad.ok && bad.countryIso2, null);
});

test("planRevealedPhonesWrite uses each number's own country, twice with the same input gives the same plan", () => {
  const picks = pickPhones([
    { number: "(212) 555-0123", type: "mobile", countryIso2: "US" },
    { number: "(212) 555-0199", type: "work", countryIso2: "US" },
  ]);
  const p = Object.freeze(person());
  const a = planRevealedPhonesWrite(p, picks, META);
  const b = planRevealedPhonesWrite(p, picks, META);
  assert.equal(a.personUpdate?.mobilePhone, "+12125550123");
  assert.equal(a.personUpdate?.phone, "+12125550199");
  assert.equal(b.personUpdate?.mobilePhone, a.personUpdate?.mobilePhone);
  assert.equal(b.personUpdate?.phone, a.personUpdate?.phone);
});
