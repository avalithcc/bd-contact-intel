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
  assert.deepEqual(params, ["developers", "sales_bd", "BUYER-CHAMPION"]);
});

/**
 * Evaluates the built condition against a row with SQL three-valued logic
 * (NULL is not true), so the tests assert row visibility and not just text.
 * Covers exactly the node shapes roleGroupVisibilityCondition emits.
 */
type Row = { roleGroup: string | null; contactType: string | null };

function visible(row: Row, hidden: string[]): boolean {
  const { sql: text, params } = dialect.sqlToQuery(
    sql`select 1 from ${person} where ${roleGroupVisibilityCondition(hidden as never)}`,
  );
  const where = text.split(" where ")[1];
  const inList = params.filter((p) => hidden.includes(p as string));
  const nullRoleGroup = row.roleGroup === null;
  const roleGroupBranch = /"role_group" is null/i.test(where) && nullRoleGroup;
  const notInBranch = nullRoleGroup ? null : !inList.includes(row.roleGroup);
  const buyerBranch =
    /"contact_type" = \$/i.test(where) && row.contactType !== null
      ? row.contactType === params[params.length - 1]
      : null;
  const branches = [roleGroupBranch, notInBranch, buyerBranch];
  return branches.some((b) => b === true);
}

const HIDDEN = ["developers", "sales_bd"];

test("visibility: sales_bd + BUYER-CHAMPION is visible", () => {
  assert.equal(visible({ roleGroup: "sales_bd", contactType: "BUYER-CHAMPION" }, HIDDEN), true);
});

test("visibility: developers + BUYER-CHAMPION is visible", () => {
  assert.equal(visible({ roleGroup: "developers", contactType: "BUYER-CHAMPION" }, HIDDEN), true);
});

test("visibility: sales_bd + INFLUENCER stays hidden (only BUYER-CHAMPION is exempt)", () => {
  assert.equal(visible({ roleGroup: "sales_bd", contactType: "INFLUENCER" }, HIDDEN), false);
});

test("visibility: sales_bd + NULL contact_type stays hidden, exactly as before", () => {
  assert.equal(visible({ roleGroup: "sales_bd", contactType: null }, HIDDEN), false);
});

test("visibility: NULL role_group stays visible whatever the contact_type", () => {
  assert.equal(visible({ roleGroup: null, contactType: null }, HIDDEN), true);
  assert.equal(visible({ roleGroup: null, contactType: "INFLUENCER" }, HIDDEN), true);
});

test("visibility: a non-hidden group stays visible with NULL contact_type", () => {
  assert.equal(visible({ roleGroup: "other", contactType: null }, HIDDEN), true);
});

test("roleGroupVisibilityCondition: the buyer exemption is a positive equality in the OR, never a negation on contact_type", () => {
  const { sql: text, params } = dialect.sqlToQuery(
    sql`select 1 from ${person} where ${roleGroupVisibilityCondition(["developers", "sales_bd"])}`,
  );
  assert.match(text, /"contact_type" = \$3/i);
  assert.doesNotMatch(text, /"contact_type" (not in|<>|!=)/i);
  assert.deepEqual(params, ["developers", "sales_bd", "BUYER-CHAMPION"]);
});
