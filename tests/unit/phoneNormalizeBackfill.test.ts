import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskPhoneShape, newTally, planPhonePage, valuesByPerson, tallyKey, type PersonPhoneRow } from "../../src/lib/phoneNormalizeBackfill";

const rows = (): PersonPhoneRow[] => [
  { id: "p1", sourceKey: "dff-2026", country: null, phone: null, mobilePhone: "1155555555" },
  { id: "p2", sourceKey: "hubspot_import", country: null, phone: "+54 11 5555-5555", mobilePhone: "+34612345678" },
  { id: "p3", sourceKey: null, country: null, phone: "0", mobilePhone: "call Ana 555" },
  { id: "p4", sourceKey: null, country: null, phone: null, mobilePhone: null },
];

describe("planPhonePage", () => {
  it("plans changes, leaves already-E.164 alone and flags the rest", () => {
    const tally = newTally();
    const { changes, flags } = planPhonePage(rows(), tally);
    assert.deepEqual(changes.map((c) => [c.id, c.column, c.newValue, c.rule]), [
      ["p1", "mobilePhone", "+5491155555555", "ar_mobile_local"],
      ["p2", "phone", "+541155555555", "separators_stripped"],
    ]);
    assert.deepEqual(flags.map((f) => [f.id, f.column, f.reason, f.masked]), [
      ["p3", "phone", "too_few_digits", "9"],
      ["p3", "mobilePhone", "text_or_extension", "aaaa aaa 999"],
    ]);
    assert.equal(tally.scanned, 4);
    assert.equal(tally.rules[tallyKey("mobilePhone", "already_e164")], 1);
    assert.equal(tally.rules[tallyKey("mobilePhone", "ar_mobile_local")], 1);
    assert.equal(tally.flagged[tallyKey("phone", "too_few_digits")], 1);
  });

  it("does not mutate its input and gives the same result on a second call", () => {
    const input = rows();
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = planPhonePage(input, newTally());
    const second = planPhonePage(input, newTally());
    assert.deepEqual(input, snapshot);
    assert.deepEqual(first, second);
  });

  it("is idempotent: planning the rewritten values yields no change", () => {
    const first = planPhonePage(rows(), newTally());
    const rewritten = rows().map((r) => {
      const next = { ...r };
      for (const c of first.changes) if (c.id === r.id) next[c.column] = c.newValue;
      return next;
    });
    assert.deepEqual(planPhonePage(rewritten, newTally()).changes, []);
  });
});

describe("valuesByPerson and masking", () => {
  it("keys old values by person id then column", () => {
    const { changes } = planPhonePage(rows(), newTally());
    assert.deepEqual(valuesByPerson(changes, "oldValue"), { p1: { mobilePhone: "1155555555" }, p2: { phone: "+54 11 5555-5555" } });
    assert.deepEqual(valuesByPerson(changes, "newValue"), { p1: { mobilePhone: "+5491155555555" }, p2: { phone: "+541155555555" } });
  });
  it("masks digits and letters, keeps punctuation", () => {
    assert.equal(maskPhoneShape("+54.9.11 Ana"), "+99.9.99 aaa");
  });
});
