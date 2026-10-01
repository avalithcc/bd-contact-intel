import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHotelRows } from "@/lib/hoteles2026/rows";
import {
  assessPhones,
  dialCodeLabel,
  extractDialCode,
  findSharedNumbers,
  summariseRoleGroups,
  type QualityPerson,
} from "@/lib/hoteles2026/dataQuality";
import { BASE, sheetCsv } from "./hoteles2026Fixtures";

const person = (over: Partial<QualityPerson>): QualityPerson => ({
  id: "p1", firstName: "Ana", lastName: "Prueba", company: "Hotel Uno", jobTitle: "Sales Director",
  roleGroup: "sales_bd", country: "Spain", phone: null, mobilePhone: null, ...over,
});

test("extractDialCode reads 1, 2 and 3 digit codes from a +number", () => {
  assert.deepEqual(extractDialCode("+1 402-968-9168"), { dial: "1", national: "4029689168" });
  assert.deepEqual(extractDialCode("+44 79 2162 9961"), { dial: "44", national: "7921629961" });
  assert.deepEqual(extractDialCode("+855 63 961 111"), { dial: "855", national: "63961111" });
  assert.deepEqual(extractDialCode("+376 358 753"), { dial: "376", national: "358753" });
});

test("extractDialCode returns null without a leading plus or for an unknown prefix", () => {
  assert.equal(extractDialCode("952 57 94 00"), null);
  assert.equal(extractDialCode("+999 1234 5678"), null);
  assert.equal(extractDialCode(""), null);
});

test("dialCodeLabel names known codes and falls back to the raw code", () => {
  assert.equal(dialCodeLabel("34"), "España");
  assert.equal(dialCodeLabel("855"), "Camboya");
  assert.equal(dialCodeLabel("998"), "+998");
});

test("assessPhones flags exactly what the importer flagged (same producer)", () => {
  const csv = sheetCsv([
    { ...BASE, "Mobile phone": "+34 616 01 64 75" },
    { ...BASE, "First name": "Bea", "Professional email": "b@x.example", "LinkedIn profile URL": "https://www.linkedin.com/in/bea-2", "Mobile phone": "+44 79 2162 9961" },
  ]);
  const imported = parseHotelRows(csv).rows.filter((r) => r.mobilePhone.dialMismatch).map((r) => r.line);
  const mine = [
    person({ id: "a", mobilePhone: "+34 616 01 64 75" }),
    person({ id: "b", mobilePhone: "+44 79 2162 9961" }),
  ].flatMap((p) => assessPhones(p)).map((f) => f.personId);
  assert.deepEqual(imported, [2]);
  assert.deepEqual(mine, ["b"]);
});

test("assessPhones reports field, dial code, country label and shape", () => {
  const [f] = assessPhones(person({ id: "z", mobilePhone: "+44 79 2162 9961" }));
  assert.equal(f!.field, "mobile");
  assert.equal(f!.dial, "44");
  assert.equal(f!.dialLabel, "Reino Unido");
  assert.equal(f!.shape, "ok");
});

test("assessPhones marks a number whose length is impossible for its code", () => {
  const [f] = assessPhones(person({ id: "z", country: "Italy", phone: "+713920528" }));
  assert.equal(f!.dial, "7");
  assert.equal(f!.shape, "too_short");
});

test("assessPhones ignores countries it has no dial code for and empty phones", () => {
  assert.deepEqual(assessPhones(person({ country: "Narnia", phone: "+44 79 2162 9961" })), []);
  assert.deepEqual(assessPhones(person({ phone: null, mobilePhone: null })), []);
});

test("findSharedNumbers groups equal digit strings across people", () => {
  const shared = findSharedNumbers([
    person({ id: "a", phone: "+855 63 961 111" }),
    person({ id: "b", mobilePhone: "+855 63 961 111" }),
    person({ id: "c", phone: "+34 952 57 94 00" }),
  ]);
  assert.deepEqual(shared.get("85563961111")?.sort(), ["a", "b"]);
  assert.equal(shared.has("34952579400"), false);
});

test("summariseRoleGroups counts hidden groups from the playbook, not a copy", () => {
  const out = summariseRoleGroups([
    person({ id: "1", roleGroup: "sales_bd" }),
    person({ id: "2", roleGroup: "sales_bd" }),
    person({ id: "3", roleGroup: "other", jobTitle: "Director General" }),
    person({ id: "4", roleGroup: "c_level_business" }),
    person({ id: "5", roleGroup: null, jobTitle: null }),
  ]);
  assert.equal(out.total, 5);
  assert.equal(out.byGroup.sales_bd, 2);
  assert.equal(out.hiddenByDefault, 2);
  assert.deepEqual(out.hiddenGroups.sort(), ["developers", "sales_bd"]);
  assert.deepEqual(out.otherTitles, ["Director General"]);
});

test("planners and helpers do not mutate their input (called twice, same result)", () => {
  const input = [person({ id: "a", mobilePhone: "+44 79 2162 9961" }), person({ id: "b", roleGroup: "other" })];
  const snapshot = JSON.stringify(input);
  const a = [assessPhones(input[0]!), summariseRoleGroups(input), [...findSharedNumbers(input)]];
  const b = [assessPhones(input[0]!), summariseRoleGroups(input), [...findSharedNumbers(input)]];
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(a, b);
});
