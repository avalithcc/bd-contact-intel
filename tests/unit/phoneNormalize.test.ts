import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, normalizePhoneForWrite, isArgentineContext, type PhoneContext } from "../../src/lib/phoneNormalize";

const mobile: PhoneContext = { column: "mobilePhone" };
const phone: PhoneContext = { column: "phone" };
const dffMobile: PhoneContext = { column: "mobilePhone", source: "dff-2026" };
const dffPhone: PhoneContext = { column: "phone", source: "dff-2026" };

function ok(raw: string, ctx: PhoneContext, value: string, rule: string) {
  assert.deepEqual(normalizePhone(raw, ctx), { value, rule }, raw);
}
function flagged(raw: string, ctx: PhoneContext, reason: string) {
  assert.deepEqual(normalizePhone(raw, ctx), { flagged: true, reason }, raw);
}

describe("normalizePhone rule 1: already E.164", () => {
  it("leaves a valid and even an unverifiable +digits value untouched", () => {
    ok("+5491155555555", mobile, "+5491155555555", "already_e164");
    ok("  +34612345678 ", phone, "+34612345678", "already_e164");
  });
});

describe("normalizePhone rule 2: + with separators, and 00", () => {
  it("strips spaces, dashes, parens", () => {
    ok("+54 9 11 5555-5555", mobile, "+5491155555555", "separators_stripped");
    ok("+54 (11) 5555 5555", phone, "+541155555555", "separators_stripped");
  });
  it("strips dots (the 21 dot-separated rows)", () => {
    ok("+54.9.11.5555.5555", mobile, "+5491155555555", "separators_stripped");
  });
  it("reads a country code wrapped in parens", () => {
    ok("(+54) 9 11 5555-5555", mobile, "+5491155555555", "separators_stripped");
    ok("(+ 34) 612 345 678", phone, "+34612345678", "separators_stripped");
  });
  it("reads a leading 00 as +", () => {
    ok("00 34 612 345 678", phone, "+34612345678", "intl_00_prefix");
  });
  it("flags what libphonenumber rejects, with the reason", () => {
    flagged("+54 9 11 5555", mobile, "invalid_number");
    flagged("+54 9 15 5555 1234", mobile, "possible_not_valid");
  });
  it("flags a trunk 0 the library would silently rewrite instead of guessing", () => {
    flagged("+54 011 5555 5555", phone, "needs_review");
  });
});

describe("normalizePhone rule 3: Argentine digits-only", () => {
  it("DFF 10-digit mobile gets +549", () => {
    ok("1155555555", dffMobile, "+5491155555555", "ar_mobile_local");
    ok("3415551234", dffMobile, "+5493415551234", "ar_mobile_local");
    ok("2215551234", dffMobile, "+5492215551234", "ar_mobile_local");
  });
  it("the same shape in phone gets +54 without the 9", () => {
    ok("1155555555", dffPhone, "+541155555555", "ar_phone_local");
  });
  it("applies when the person is in Argentina, whatever the source", () => {
    ok("1155555555", { column: "mobilePhone", source: "csv", country: "Argentina" }, "+5491155555555", "ar_mobile_local");
    ok("1155555555", { column: "mobilePhone", country: "ar" }, "+5491155555555", "ar_mobile_local");
  });
  it("does NOT apply to other sources or countries", () => {
    flagged("1155555555", { column: "mobilePhone", source: "hubspot_import" }, "no_country_code");
    flagged("1155555555", { column: "mobilePhone", source: "hubspot_import", country: "Chile" }, "no_country_code");
    flagged("1155555555", mobile, "no_country_code");
  });
  it("keeps a 15-prefixed number without area code flagged", () => {
    flagged("1555551234", dffMobile, "ar_area_code_unknown");
  });
  it("flags a DFF number of the wrong length", () => {
    flagged("115555555", dffMobile, "no_country_code");
    flagged("0115555555", dffMobile, "no_country_code");
  });
  it("recognises the context", () => {
    assert.equal(isArgentineContext("dff-2026", null), true);
    assert.equal(isArgentineContext(null, " Argentína "), true);
    assert.equal(isArgentineContext("hubspot_import", "Chile"), false);
    assert.equal(isArgentineContext(null, null), false);
  });
});

describe("normalizePhone rule 4: digits-only with an obvious country code", () => {
  it("Chile: 56 + 9 digits", () => {
    ok("56 9 8765 4321", { column: "mobilePhone", source: "hubspot_import" }, "+56987654321", "country_code_prefixed");
  });
  it("Colombia 57+10, Mexico 52+10, Spain 34+9", () => {
    ok("573001234567", mobile, "+573001234567", "country_code_prefixed");
    ok("525512345678", mobile, "+525512345678", "country_code_prefixed");
    ok("34612345678", phone, "+34612345678", "country_code_prefixed");
  });
  it("Argentina with its 54 already present", () => {
    ok("541155555555", phone, "+541155555555", "country_code_prefixed");
    ok("5491155555555", mobile, "+5491155555555", "country_code_prefixed");
  });
  it("flags a DFF value that is not the Argentine local shape instead of guessing a country", () => {
    flagged("14155552671", dffMobile, "ambiguous_country");
    flagged("56987654321", dffMobile, "ambiguous_country");
  });
  it("flags +1 and Peru detections unless the person's country corroborates them", () => {
    flagged("14155552671", { column: "mobilePhone", source: "hubspot_import" }, "ambiguous_country");
    flagged("14155552671", { column: "mobilePhone", country: "Argentina" }, "ambiguous_country");
    flagged("5112345678", phone, "ambiguous_country");
    ok("14155552671", { column: "mobilePhone", country: "United States" }, "+14155552671", "country_code_prefixed");
    ok("5112345678", { column: "phone", country: "Perú" }, "+5112345678", "country_code_prefixed");
  });
  it("flags a wrong length for the code instead of guessing", () => {
    flagged("57300123456", mobile, "no_country_code");
    flagged("5730012345678", mobile, "possible_not_valid");
    flagged("5491555551234", mobile, "possible_not_valid");
  });
});

describe("normalizePhone rule 5: everything else is flagged", () => {
  it("empty and whitespace", () => {
    flagged("", mobile, "empty");
    flagged("   ", mobile, "empty");
  });
  it("a lone 0 and other too-short values", () => {
    flagged("0", phone, "too_few_digits");
    flagged("123", phone, "too_few_digits");
  });
  it("text and extensions", () => {
    flagged("+54 11 5555 5555 ext 12", phone, "text_or_extension");
    flagged("11 5555 5555 int. 4", phone, "text_or_extension");
    flagged("n/a", phone, "text_or_extension");
    flagged("no tiene", phone, "text_or_extension");
  });
  it("two numbers in one cell", () => {
    flagged("+54 11 5555 5555 / +54 11 4444 4444", phone, "multiple_numbers");
    flagged("+5411 55555555 y 11 44444444", phone, "multiple_numbers");
    flagged("+5411555555 +5411444444", phone, "multiple_numbers");
  });
  it("a + that is not first", () => {
    flagged("54+1155555555", phone, "misplaced_plus");
  });
  it("too many digits", () => {
    flagged("+54 9 11 5555 5555 5555 5555", mobile, "too_many_digits");
  });
  it("digits-only without a recognizable code", () => {
    flagged("4444 5555", phone, "no_country_code");
    flagged("0114445555", phone, "no_country_code");
  });
});

describe("normalizePhone purity and idempotence", () => {
  it("returns the same result when called twice with the same input", () => {
    const ctx: PhoneContext = { column: "mobilePhone", source: "dff-2026" };
    const snapshot = JSON.stringify(ctx);
    const a = normalizePhone("1155555555", ctx);
    const b = normalizePhone("1155555555", ctx);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(ctx), snapshot);
  });
  it("is idempotent: a normalized value normalizes to itself", () => {
    for (const raw of ["+54 9 11 5555-5555", "00 34 612 345 678", "573001234567"]) {
      const first = normalizePhone(raw, mobile);
      assert.ok(!("flagged" in first));
      if ("flagged" in first) continue;
      assert.deepEqual(normalizePhone(first.value, mobile), { value: first.value, rule: "already_e164" });
    }
  });
});

describe("normalizePhoneForWrite", () => {
  it("returns the E.164 form when it can", () => {
    assert.equal(normalizePhoneForWrite("+54 9 11 5555-5555", mobile), "+5491155555555");
  });
  it("stores the value as typed when it cannot be normalized", () => {
    assert.equal(normalizePhoneForWrite("011 4123-4567", phone), "011 4123-4567");
    assert.equal(normalizePhoneForWrite("+54 11 5555 5555 ext 12", phone), "+54 11 5555 5555 ext 12");
  });
  it("passes null and undefined through", () => {
    assert.equal(normalizePhoneForWrite(null, phone), null);
    assert.equal(normalizePhoneForWrite(undefined, phone), undefined);
  });
});

describe("DFF source key" , () => {
  it("is the same string the importer stamps on its rows", async () => {
    const { DFF_2026_SOURCE_KEY: imported } = await import("../../src/lib/dff2026/planImport");
    const { DFF_2026_SOURCE_KEY: here } = await import("../../src/lib/phoneNormalize");
    assert.equal(here, imported);
  });
});

describe("provider country (Lusha countryIso2)", () => {
  it("makes a national number valid in that country", () => {
    assert.deepEqual(normalizePhone("(212) 555-0123", { column: "mobilePhone", countryIso2: "US" }), { value: "+12125550123", rule: "provider_country" });
    assert.deepEqual(normalizePhone("11 5555 5555", { column: "phone", countryIso2: "AR" }), { value: "+541155555555", rule: "ar_phone_local" });
    assert.deepEqual(normalizePhone("(212) 555-0123", { column: "phone", countryIso2: "FR" }), { flagged: true, reason: "no_country_code" });
    assert.deepEqual(normalizePhone("(212) 555-0123", { column: "phone" }), { flagged: true, reason: "no_country_code" });
  });
});

describe("provider country outranks the source and the person's country", () => {
  it("a US-reported 10-digit number for an Argentine person (or the DFF source) is +1, never +54", () => {
    const want = { value: "+12125550123", rule: "provider_country" };
    assert.deepEqual(normalizePhone("2125550123", { column: "mobilePhone", country: "Argentina", countryIso2: "US" }), want);
    assert.deepEqual(normalizePhone("2125550123", { column: "mobilePhone", source: "dff-2026", countryIso2: "US" }), want);
  });
  it("is flagged, not guessed, when the number is not valid in the provider country", () => {
    assert.deepEqual(normalizePhone("1155555555", { column: "phone", country: "Argentina", countryIso2: "US" }), { flagged: true, reason: "no_country_code" });
  });
  it("a Peruvian number with a PE provider and a dff-2026 source", () => {
    assert.deepEqual(normalizePhone("987654321", { column: "mobilePhone", source: "dff-2026", countryIso2: "PE" }), { value: "+51987654321", rule: "provider_country" });
  });
  it("an explicit + country code still wins over the provider country", () => {
    assert.deepEqual(normalizePhone("+54 9 11 5555 5555", { column: "mobilePhone", countryIso2: "US" }), { value: "+5491155555555", rule: "separators_stripped" });
  });
  it("an AR provider keeps the Argentine local rules", () => {
    assert.deepEqual(normalizePhone("11 5555 5555", { column: "mobilePhone", countryIso2: "AR" }), { value: "+5491155555555", rule: "ar_mobile_local" });
  });
});
