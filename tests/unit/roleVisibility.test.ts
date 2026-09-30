/**
 * Unit tests for src/lib/contacts/roleVisibility.ts (owner decision
 * 2026-09-30, "opción A": hide the role-guide's "No priorizar" groups from
 * `/contacts` by default, reversibly).
 *
 * `roleGroupVisibilityCondition` is a pure SQL-condition builder — schema-
 * only import (`@/db/schema`), no `@/db`, no live DATABASE_URL needed (same
 * convention as tests/unit/appShellBadgeCountsQuery.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { person } from "@/db/schema";
import { NOT_WORTH_PRIORITIZING } from "@/lib/roleGroupPlaybook";
import {
  resolveRoleVisibility,
  roleGroupVisibilityCondition,
  SHOW_ALL_ROLES_PARAM_VALUE,
} from "@/lib/contacts/roleVisibility";

const dialect = new PgDialect();

test("resolveRoleVisibility: default (no ?roles=, no explicit roleGroup filter) hides exactly the guide's No-priorizar keys", () => {
  const result = resolveRoleVisibility(undefined, undefined);
  assert.deepEqual(result.hiddenRoleGroups, NOT_WORTH_PRIORITIZING.noPriorizar.keys);
  assert.equal(result.isDefaultActive, true);
});

test("resolveRoleVisibility: ?roles=all shows everything", () => {
  const result = resolveRoleVisibility(SHOW_ALL_ROLES_PARAM_VALUE, undefined);
  assert.deepEqual(result.hiddenRoleGroups, []);
  assert.equal(result.isDefaultActive, false);
});

test("resolveRoleVisibility: an explicit roleGroup ad-hoc filter overrides the default, even for a hidden group", () => {
  const result = resolveRoleVisibility(undefined, "developers");
  assert.deepEqual(result.hiddenRoleGroups, []);
  assert.equal(result.isDefaultActive, false);
});

test("resolveRoleVisibility: an unrecognized ?roles= value falls back to the hidden default (never throws)", () => {
  const result = resolveRoleVisibility("bogus", undefined);
  assert.deepEqual(result.hiddenRoleGroups, NOT_WORTH_PRIORITIZING.noPriorizar.keys);
  assert.equal(result.isDefaultActive, true);
});

test("resolveRoleVisibility: an empty-string explicit roleGroup (ad-hoc 'cleared' sentinel) does NOT override the default", () => {
  const result = resolveRoleVisibility(undefined, "");
  assert.deepEqual(result.hiddenRoleGroups, NOT_WORTH_PRIORITIZING.noPriorizar.keys);
  assert.equal(result.isDefaultActive, true);
});

test("roleGroupVisibilityCondition: empty hidden list adds no condition", () => {
  assert.equal(roleGroupVisibilityCondition([]), undefined);
});

test("roleGroupVisibilityCondition: excludes the hidden groups but keeps a null role_group visible", () => {
  const condition = roleGroupVisibilityCondition(["developers", "sales_bd"]);
  const { sql: text, params } = dialect.sqlToQuery(sql`select 1 from ${person} where ${condition}`);
  // Guards the classic `NOT IN` + NULL trap: `role_group NOT IN (...)` alone
  // evaluates to NULL (excluded by WHERE) for a NULL row, so the null branch
  // must be explicit, not implied.
  assert.match(text, /"role_group" is null/i);
  assert.match(text, /"role_group" not in \(\$1, \$2\)/i);
  assert.deepEqual(params, ["developers", "sales_bd"]);
});
