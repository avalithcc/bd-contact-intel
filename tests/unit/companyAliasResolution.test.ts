/**
 * Unit tests for src/lib/companies/aliasResolution.ts — the canonical-key ->
 * match-keys builder and the per-company count fold used by the `/companies`
 * list. Pure, no DB: alias fixtures have the shape `getCompanyAliasRows`
 * returns, and every count fixture is built by feeding the real
 * `buildCompanyMatchKeys` output into `sumCountsByCompany` (never a
 * hand-built map).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompanyMatchKeys, sumCountsByCompany, type CompanyAliasRow } from "@/lib/companies/aliasResolution";

test("a company with no aliases matches only its own canonical key", () => {
  const map = buildCompanyMatchKeys(["acme"], []);
  assert.deepEqual(map.get("acme"), ["acme"]);
});

test("a company with one alias matches its canonical key plus the alias", () => {
  const aliasRows: CompanyAliasRow[] = [{ aliasKey: "acme-legal-entity", companyKey: "acme" }];
  const map = buildCompanyMatchKeys(["acme"], aliasRows);
  assert.deepEqual(map.get("acme"), ["acme", "acme-legal-entity"]);
});

test("multiple aliases for the same company all aggregate under it", () => {
  const aliasRows: CompanyAliasRow[] = [
    { aliasKey: "acme-legal-entity", companyKey: "acme" },
    { aliasKey: "acme-brand-name", companyKey: "acme" },
  ];
  const map = buildCompanyMatchKeys(["acme"], aliasRows);
  assert.deepEqual(map.get("acme"), ["acme", "acme-brand-name", "acme-legal-entity"]);
});

test("an alias pointing at a company outside the requested canonical keys is ignored", () => {
  const aliasRows: CompanyAliasRow[] = [{ aliasKey: "globex-legal", companyKey: "globex" }];
  const map = buildCompanyMatchKeys(["acme"], aliasRows);
  assert.deepEqual(map.get("acme"), ["acme"]);
  assert.equal(map.has("globex"), false);
});

test("each requested canonical key gets its own entry, aliases never cross over", () => {
  const aliasRows: CompanyAliasRow[] = [
    { aliasKey: "acme-legal", companyKey: "acme" },
    { aliasKey: "globex-legal", companyKey: "globex" },
  ];
  const map = buildCompanyMatchKeys(["acme", "globex"], aliasRows);
  assert.deepEqual(map.get("acme"), ["acme", "acme-legal"]);
  assert.deepEqual(map.get("globex"), ["globex", "globex-legal"]);
});

test("pure: never mutates its inputs and calling it twice with the same input gives the same result", () => {
  const canonicalKeys = ["acme"];
  const aliasRows: CompanyAliasRow[] = [{ aliasKey: "acme-legal", companyKey: "acme" }];
  const canonicalKeysSnapshot = [...canonicalKeys];
  const aliasRowsSnapshot = aliasRows.map((r) => ({ ...r }));

  const first = buildCompanyMatchKeys(canonicalKeys, aliasRows);
  const second = buildCompanyMatchKeys(canonicalKeys, aliasRows);

  assert.deepEqual(canonicalKeys, canonicalKeysSnapshot);
  assert.deepEqual(aliasRows, aliasRowsSnapshot);
  assert.deepEqual([...first.entries()], [...second.entries()]);
});

test("the result does not depend on the order of the alias rows", () => {
  const rows: CompanyAliasRow[] = [
    { aliasKey: "acme-b", companyKey: "acme" },
    { aliasKey: "globex-a", companyKey: "globex" },
    { aliasKey: "acme-a", companyKey: "acme" },
  ];
  const forward = buildCompanyMatchKeys(["acme", "globex"], rows);
  const backward = buildCompanyMatchKeys(["globex", "acme"], [...rows].reverse());
  assert.deepEqual(forward.get("acme"), ["acme", "acme-a", "acme-b"]);
  assert.deepEqual(forward.get("acme"), backward.get("acme"));
  assert.deepEqual(forward.get("globex"), backward.get("globex"));
});

test("a duplicated alias row is listed once", () => {
  const rows: CompanyAliasRow[] = [
    { aliasKey: "acme-a", companyKey: "acme" },
    { aliasKey: "acme-a", companyKey: "acme" },
  ];
  assert.deepEqual(buildCompanyMatchKeys(["acme"], rows).get("acme"), ["acme", "acme-a"]);
});

test("an alias that is another requested company's own key never steals its contacts", () => {
  const rows: CompanyAliasRow[] = [{ aliasKey: "globex", companyKey: "acme" }];
  const map = buildCompanyMatchKeys(["acme", "globex"], rows);
  assert.deepEqual(map.get("acme"), ["acme"]);
  assert.deepEqual(map.get("globex"), ["globex"]);
});

test("counts on a company's own key and on its aliases are summed under the canonical key", () => {
  const map = buildCompanyMatchKeys(["acme", "globex", "initech"], [
    { aliasKey: "acme-a", companyKey: "acme" },
    { aliasKey: "acme-b", companyKey: "acme" },
    { aliasKey: "globex-a", companyKey: "globex" },
  ]);
  const totals = sumCountsByCompany(map, [
    { companyKey: "acme", count: 4 },
    { companyKey: "acme-a", count: 2 },
    { companyKey: "acme-b", count: 1 },
    { companyKey: "globex-a", count: 3 },
  ]);
  assert.equal(totals.get("acme"), 7);
  assert.equal(totals.get("globex"), 3);
  assert.equal(totals.get("initech"), 0);
});

test("a count row with a null or unrelated key is ignored", () => {
  const map = buildCompanyMatchKeys(["acme"], []);
  const totals = sumCountsByCompany(map, [
    { companyKey: null, count: 9 },
    { companyKey: "somewhere-else", count: 5 },
    { companyKey: "acme", count: 1 },
  ]);
  assert.equal(totals.get("acme"), 1);
  assert.equal(totals.size, 1);
});

test("summing is order-independent and never mutates its inputs", () => {
  const map = buildCompanyMatchKeys(["acme"], [{ aliasKey: "acme-a", companyKey: "acme" }]);
  const rows = [
    { companyKey: "acme-a", count: 2 },
    { companyKey: "acme", count: 4 },
  ];
  const snapshot = rows.map((r) => ({ ...r }));
  const first = sumCountsByCompany(map, rows);
  const second = sumCountsByCompany(map, [...rows].reverse());
  assert.deepEqual(rows, snapshot);
  assert.deepEqual([...first.entries()], [...second.entries()]);
});
