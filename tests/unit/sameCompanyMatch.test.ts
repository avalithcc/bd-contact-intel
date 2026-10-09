import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompanyKeyIndex, findSameCompany, MIN_PREFIX_LEN } from "@/lib/companyMerge/sameCompany";

const index = (keys: string[]) => buildCompanyKeyIndex(keys);

test("exact squash: the spellings the repair was built for resolve to the existing company", () => {
  const idx = index(["pedidosya", "naranja x", "vortex", "mercado libre"]);
  assert.deepEqual(findSameCompany("pedidos ya", idx), { kind: "match", to: "pedidosya" });
  assert.deepEqual(findSameCompany("naranjax", idx), { kind: "match", to: "naranja x" });
  assert.deepEqual(findSameCompany("vor-tex", idx), { kind: "match", to: "vortex" });
});

// The 2026-10-09 finding: squash("日本") is "", and "anything".startsWith("") is true, so the first row the
// unordered SELECT returned became the repoint target of a Japanese employer.
test("a key that squashes to nothing never matches, whatever the index holds", () => {
  const idx = index(["zzz-first", "globant", "pedidosya"]);
  for (const key of ["АО «Системы управления»", "مؤسسه تراتيل", "日本", "서울", "Ελλάδα", "---"]) {
    assert.deepEqual(findSameCompany(key, idx, { prefix: true }), { kind: "none" }, key);
  }
});

test("companies whose own key squashes to nothing are not in the index", () => {
  const idx = index(["日本", "---", "globant"]);
  assert.deepEqual(findSameCompany("globant", idx), { kind: "match", to: "globant" });
  assert.equal(idx.entries.length, 1);
});

test("exact mode (the repair script) never matches by prefix", () => {
  const idx = index(["bunkerdb"]);
  assert.deepEqual(findSameCompany("bunker", idx), { kind: "none" });
  assert.deepEqual(findSameCompany("bunker db", idx), { kind: "match", to: "bunkerdb" });
});

test("prefix mode matches in both directions", () => {
  const idx = index(["globantsa", "mercado"]);
  assert.deepEqual(findSameCompany("globant", idx, { prefix: true }), { kind: "match", to: "globantsa" });
  assert.deepEqual(findSameCompany("mercadolibre", idx, { prefix: true }), { kind: "match", to: "mercado" });
});

test("two candidates is ambiguous, never a pick, and the answer does not depend on index order", () => {
  const keys = ["globant sa", "globant inc", "other"];
  const a = findSameCompany("globant", index(keys), { prefix: true });
  const b = findSameCompany("globant", index([...keys].reverse()), { prefix: true });
  assert.deepEqual(a, { kind: "ambiguous", candidates: ["globant inc", "globant sa"] });
  assert.deepEqual(b, a);
});

test("two companies that squash alike are ambiguous in exact mode too", () => {
  const idx = index(["bunker db", "bunkerdb"]);
  assert.deepEqual(findSameCompany("bunker-db", idx), { kind: "ambiguous", candidates: ["bunker db", "bunkerdb"] });
});

test("an exact squash hit wins over prefix candidates", () => {
  const idx = index(["globant", "globantsa", "globantinc"]);
  assert.deepEqual(findSameCompany("globant", idx, { prefix: true }), { kind: "match", to: "globant" });
});

test(`a prefix shorter than ${MIN_PREFIX_LEN} characters is not evidence of the same company`, () => {
  const idx = index(["techmahindra", "ypfluz"]);
  assert.deepEqual(findSameCompany("tech", idx, { prefix: true }), { kind: "none" });
  assert.deepEqual(findSameCompany("ypf", idx, { prefix: true }), { kind: "none" });
  // ...but an exact squash is still honoured at any length.
  assert.deepEqual(findSameCompany("y-p-f", index(["ypf"]), { prefix: true }), { kind: "match", to: "ypf" });
});

test("the prefix floor applies to the SHORTER side, so a long orphan key cannot match a short company", () => {
  const idx = index(["tech"]);
  assert.deepEqual(findSameCompany("technologies", idx, { prefix: true }), { kind: "none" });
});

test("pure: the same input twice gives the same answer and the index is not mutated", () => {
  const keys = ["globant sa", "globant inc", "pedidosya"];
  const idx = index(keys);
  const before = JSON.stringify(idx.entries);
  const first = findSameCompany("globant", idx, { prefix: true });
  const second = findSameCompany("globant", idx, { prefix: true });
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(idx.entries), before);
  assert.deepEqual(keys, ["globant sa", "globant inc", "pedidosya"]);
});
