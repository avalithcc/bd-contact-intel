import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isSameSubject, repeatsAny } from "@/lib/outreach/subjectDifference";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";

const OLD = "Backend, Salesforce y pagos en LATAM y Madrid";

describe("isSameSubject", () => {
  it("treats an identical string as the same", () => assert.ok(isSameSubject(OLD, OLD)));
  it("treats a reorder of the same words as the same", () => assert.ok(isSameSubject(OLD, "Salesforce, backend y pagos en Madrid y LATAM")));
  it("ignores case and accents", () => assert.ok(isSameSubject("Ingeniería ÁGIL en Córdoba", "ingenieria agil en cordoba")));
  it("ignores a punctuation-only change", () => assert.ok(isSameSubject(OLD, "Backend; Salesforce - pagos... LATAM / Madrid!")));
  it("ignores stopwords in both languages", () => assert.ok(isSameSubject("Payments and the backend in Madrid", "backend, payments Madrid")));
  it("treats a genuinely different subject as different", () => assert.equal(isSameSubject(OLD, "Equipo de ingenieria para Flybondi"), false));
  it("treats one extra significant word as different", () => assert.equal(isSameSubject(OLD, `${OLD} y Java`), false));
  it("handles blank input without throwing", () => {
    assert.equal(isSameSubject("", "  "), true);
    assert.equal(isSameSubject("", OLD), false);
  });
  it("repeatsAny checks every rejected subject", () => {
    assert.ok(repeatsAny("Madrid y LATAM, pagos, Salesforce, backend", ["Otro", OLD]));
    assert.equal(repeatsAny("Algo nuevo", [OLD]), false);
    assert.equal(repeatsAny("Algo", []), false);
  });
});

function find(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v);
      else find(v, key, out);
    }
  }
  return out;
}

describe("toastSubjectUnchanged", () => {
  it("exists in both dictionaries as a plain string, never a function", () => {
    for (const d of [es, en]) {
      const hits = find(d, "toastSubjectUnchanged");
      assert.equal(hits.length, 1);
      assert.equal(typeof hits[0], "string");
      assert.ok((hits[0] as string).length > 10);
    }
  });
});
