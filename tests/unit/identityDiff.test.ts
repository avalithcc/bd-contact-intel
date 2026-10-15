import assert from "node:assert/strict";
import { test } from "node:test";
import { diffIdentity } from "@/lib/contacts/identityDiff";

const crm = { name: "Julián Marchetti", company: "Aument", domain: "aument.io", linkedin: "https://www.linkedin.com/in/julian-marchetti-aument" };

test("the mockup probe case: only the accent is noise, company, domain and LinkedIn differ", () => {
  const lusha = { name: "Julian Marchetti", company: "Aumenta GT", domain: "www.aumenta.do", linkedin: "linkedin.com/in/jmarchetti-gt" };
  assert.deepEqual(diffIdentity(crm, lusha).map((r) => [r.key, r.same]), [["name", true], ["company", false], ["domain", false], ["linkedin", false]]);
});

test("case, www., protocol and a trailing slash do not count as a difference", () => {
  const lusha = { name: "JULIÁN marchetti", company: "aument", domain: "WWW.Aument.io", linkedin: "linkedin.com/in/julian-marchetti-aument/" };
  assert.ok(diffIdentity(crm, lusha).every((r) => r.same));
});

test("a sub-domain of the same organisation is still marked different (informs, never blocks)", () => {
  const row = diffIdentity({ ...crm, domain: "mercadolibre.com" }, { ...crm, domain: "careers-meli.mercadolibre.com" }).find((r) => r.key === "domain");
  assert.equal(row?.same, false);
});

test("a value on one side only is a difference; nothing on both sides is not", () => {
  const rows = diffIdentity({ ...crm, linkedin: null, domain: null }, { ...crm, domain: null, linkedin: "linkedin.com/in/x" });
  assert.deepEqual(rows.filter((r) => r.key === "domain" || r.key === "linkedin").map((r) => r.same), [true, false]);
});
