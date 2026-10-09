/**
 * scripts/seed-target-companies.ts upserts a hand-written `aliases` list into
 * company_alias. An alias key that is a live company key (or one this very run
 * creates) is not an alias for anyone (aliasRule.ts); the seed must refuse it
 * and report, never drop it silently (a typo must not pass as a no-op).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allSeedAliasKeys, findAliasCollisions, seedCompanyKeys, type SeedAliasRow } from "@/lib/companies/seedAliasGuard";

const rows: SeedAliasRow[] = [
  { companyKey: "acme", aliases: ["acme-sa", "globex"] },
  { companyKey: "initech", aliases: ["initech-ar"] },
  { companyKey: "hooli" },
];

test("no collisions when no alias is a live company key", () => {
  assert.deepEqual(findAliasCollisions(rows, new Set(["unrelated"])), []);
});

test("an alias that is a live company key is reported with the company it was meant for", () => {
  assert.deepEqual(findAliasCollisions(rows, new Set(["globex"])), [{ aliasKey: "globex", companyKey: "acme", reason: "live-company" }]);
});

test("an alias equal to another row's company key collides, because this run creates that company", () => {
  const withGlobex: SeedAliasRow[] = [...rows, { companyKey: "globex", aliases: ["globex-sa"] }];
  assert.deepEqual(findAliasCollisions(withGlobex, new Set()), [{ aliasKey: "globex", companyKey: "acme", reason: "created-by-this-run" }]);
});

test("a row without aliases creates no company, so naming its key as an alias is fine", () => {
  const r: SeedAliasRow[] = [{ companyKey: "acme", aliases: ["hooli"] }, { companyKey: "hooli" }];
  assert.deepEqual(findAliasCollisions(r, new Set()), []);
});

test("an alias equal to its own row's company key collides", () => {
  assert.deepEqual(findAliasCollisions([{ companyKey: "acme", aliases: ["acme"] }], new Set()), [
    { aliasKey: "acme", companyKey: "acme", reason: "created-by-this-run" },
  ]);
});

test("live-company wins over created-by-this-run, and the report order does not depend on input order", () => {
  const live = new Set(["globex", "zeta"]);
  const input: SeedAliasRow[] = [
    { companyKey: "acme", aliases: ["zeta", "globex"] },
    { companyKey: "globex", aliases: ["g"] },
  ];
  const forward = findAliasCollisions(input, live);
  const backward = findAliasCollisions([...input].reverse(), live);
  assert.deepEqual(forward.map((c) => c.aliasKey), ["globex", "zeta"]);
  assert.equal(forward[0]!.reason, "live-company");
  assert.deepEqual(forward, backward);
});

test("pure: never mutates its inputs and gives the same answer twice", () => {
  const input: SeedAliasRow[] = [{ companyKey: "acme", aliases: ["globex"] }];
  const live = new Set(["globex"]);
  const snapshot = JSON.stringify(input);
  const first = findAliasCollisions(input, live);
  assert.deepEqual(findAliasCollisions(input, live), first);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual([...live], ["globex"]);
});

test("a row whose key is already an alias would shadow it: the seed creates that company, which silences the alias", () => {
  const r: SeedAliasRow[] = [{ companyKey: "globex", aliases: ["globex-sa"] }];
  assert.deepEqual(findAliasCollisions(r, new Set(), new Map([["globex", "acme"]])), [
    { aliasKey: "globex", companyKey: "globex", reason: "would-shadow-existing-alias", existingTarget: "acme" },
  ]);
});

test("a row key that is already a live company creates nothing, so an existing alias on it is not shadowed by this run", () => {
  const r: SeedAliasRow[] = [{ companyKey: "globex", aliases: ["globex-sa"] }];
  assert.deepEqual(findAliasCollisions(r, new Set(["globex"]), new Map([["globex", "acme"]])), []);
});

test("a row without aliases creates no company, so it cannot shadow an alias", () => {
  assert.deepEqual(findAliasCollisions([{ companyKey: "globex" }], new Set(), new Map([["globex", "acme"]])), []);
});

test("the keys the script must look up are exactly the alias keys, and the keys of rows that will create a company", () => {
  const r: SeedAliasRow[] = [{ companyKey: "b", aliases: ["z", "y", "z"] }, { companyKey: "a" }, { companyKey: "c", aliases: ["x"] }];
  assert.deepEqual(allSeedAliasKeys(r), ["x", "y", "z"]);
  assert.deepEqual(seedCompanyKeys(r), ["b", "c"]);
});

test("the seed script checks for collisions before its first write and exits non-zero on one", () => {
  const src = readFileSync("scripts/seed-target-companies.ts", "utf8");
  const check = src.indexOf("findAliasCollisions(");
  assert.ok(check >= 0, "script must call findAliasCollisions");
  assert.ok(check < src.indexOf(".insert("), "the check must run before any insert");
  // Both directions are read before the first write: alias keys vs company, and company-to-be keys vs company_alias.
  assert.ok(src.indexOf("inArray(company.companyKey") >= 0 && src.indexOf("inArray(companyAlias.aliasKey") >= 0);
  assert.ok(src.indexOf("inArray(companyAlias.aliasKey") < src.indexOf(".insert("));
  assert.match(src.slice(check, src.indexOf(".insert(")), /process\.exit\(1\)|process\.exitCode = 1|throw /);
});
