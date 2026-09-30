/**
 * Unit tests for src/lib/identity/mergedProfileKeys.ts (bugfix: merged
 * person's LinkedIn conversation content, PR #235 review). `resolveMergedProfileKeys`
 * is the pure reference implementation pinning the merge-chain closure
 * semantics; `mergedProfileKeysSql` is the production SQL twin, pinned with a
 * PgDialect render test (schema-only import, no live DATABASE_URL needed,
 * same convention as tests/unit/appShellBadgeCountsQuery.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { mergedProfileKeysSql, resolveMergedProfileKeys, type MergeChainPersonRow } from "@/lib/identity/mergedProfileKeys";

const SURVIVOR = "00000000-0000-0000-0000-000000000001";
const MERGED_DIRECT = "00000000-0000-0000-0000-000000000002";
const MERGED_CHAINED = "00000000-0000-0000-0000-000000000003";
const UNRELATED = "00000000-0000-0000-0000-000000000004";

test("resolveMergedProfileKeys: includes the person's own profileKey with no merges", () => {
  const persons: MergeChainPersonRow[] = [{ id: SURVIVOR, mergedIntoId: null, profileKey: "linkedin.com/in/survivor" }];
  assert.deepEqual(resolveMergedProfileKeys(SURVIVOR, persons), ["linkedin.com/in/survivor"]);
});

test("resolveMergedProfileKeys: includes a directly-merged-away person's profileKey", () => {
  const persons: MergeChainPersonRow[] = [
    { id: SURVIVOR, mergedIntoId: null, profileKey: "linkedin.com/in/survivor" },
    { id: MERGED_DIRECT, mergedIntoId: SURVIVOR, profileKey: "linkedin.com/in/merged-direct" },
  ];
  const keys = resolveMergedProfileKeys(SURVIVOR, persons);
  assert.equal(keys.length, 2);
  assert.ok(keys.includes("linkedin.com/in/survivor"));
  assert.ok(keys.includes("linkedin.com/in/merged-direct"));
});

test("resolveMergedProfileKeys: walks a chained merge (A merged into B, B merged into survivor)", () => {
  const persons: MergeChainPersonRow[] = [
    { id: SURVIVOR, mergedIntoId: null, profileKey: "linkedin.com/in/survivor" },
    { id: MERGED_DIRECT, mergedIntoId: SURVIVOR, profileKey: "linkedin.com/in/merged-direct" },
    { id: MERGED_CHAINED, mergedIntoId: MERGED_DIRECT, profileKey: "linkedin.com/in/merged-chained" },
    { id: UNRELATED, mergedIntoId: null, profileKey: "linkedin.com/in/unrelated" },
  ];
  const keys = resolveMergedProfileKeys(SURVIVOR, persons);
  assert.equal(keys.length, 3);
  assert.ok(keys.includes("linkedin.com/in/merged-chained"), "chained (2-hop) merge must still resolve");
  assert.ok(!keys.includes("linkedin.com/in/unrelated"), "an unrelated person's profileKey must never leak in");
});

test("resolveMergedProfileKeys: drops null profileKeys and dedupes", () => {
  const persons: MergeChainPersonRow[] = [
    { id: SURVIVOR, mergedIntoId: null, profileKey: null },
    { id: MERGED_DIRECT, mergedIntoId: SURVIVOR, profileKey: "linkedin.com/in/dup" },
    { id: MERGED_CHAINED, mergedIntoId: SURVIVOR, profileKey: "linkedin.com/in/dup" },
  ];
  assert.deepEqual(resolveMergedProfileKeys(SURVIVOR, persons), ["linkedin.com/in/dup"]);
});

test("resolveMergedProfileKeys: survivor with no profileKey and no merges returns empty", () => {
  const persons: MergeChainPersonRow[] = [{ id: SURVIVOR, mergedIntoId: null, profileKey: null }];
  assert.deepEqual(resolveMergedProfileKeys(SURVIVOR, persons), []);
});

test("resolveMergedProfileKeys: pure — never mutates its input, same input twice gives the same result", () => {
  const persons: MergeChainPersonRow[] = [
    { id: SURVIVOR, mergedIntoId: null, profileKey: "linkedin.com/in/survivor" },
    { id: MERGED_DIRECT, mergedIntoId: SURVIVOR, profileKey: "linkedin.com/in/merged-direct" },
  ];
  const snapshotBefore = JSON.stringify(persons);
  const first = resolveMergedProfileKeys(SURVIVOR, persons);
  const second = resolveMergedProfileKeys(SURVIVOR, persons);
  assert.deepEqual([...first].sort(), [...second].sort());
  assert.equal(JSON.stringify(persons), snapshotBefore, "input array/rows must not be mutated");
});

const dialect = new PgDialect();

test("mergedProfileKeysSql: renders a recursive CTE walking merged_into_id, filtering out null profile_key", () => {
  const { sql: rendered, params } = dialect.sqlToQuery(mergedProfileKeysSql(SURVIVOR));
  assert.match(rendered, /with recursive mpk_chain/i);
  assert.match(rendered, /merged_into_id = mpk_chain\.mpk_id/i);
  assert.match(rendered, /profile_key is not null/i);
  assert.match(rendered, /id = \$1::uuid/i);
  assert.deepEqual(params, [SURVIVOR]);
});

test("mergedProfileKeysSql: is a single self-contained parenthesized expression (safe to embed in an IN (...) clause)", () => {
  const { sql: rendered } = dialect.sqlToQuery(mergedProfileKeysSql(SURVIVOR));
  assert.ok(rendered.trim().startsWith("("));
  assert.ok(rendered.trim().endsWith(")"));
});
