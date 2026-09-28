/**
 * Unit tests for src/lib/companies/aliasResolution.ts — the shared
 * canonical-key -> match-keys builder used by the companies list contact
 * count and the company record's contact count/people reads (bug:
 * company-contact-counts, see openspec/BACKLOG.md). Pure, no DB — fixtures
 * only, built from the same shape `getCompanyAliasRows` returns.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompanyMatchKeys, type CompanyAliasRow } from "@/lib/companies/aliasResolution";

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
  assert.deepEqual(map.get("acme"), ["acme", "acme-legal-entity", "acme-brand-name"]);
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
