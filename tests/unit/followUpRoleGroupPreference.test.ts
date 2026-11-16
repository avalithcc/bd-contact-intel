/**
 * follow-up-role-groups: the per-BD role-group deny-list. Query tests render the REAL producers (buildFollowUpInsertQuery,
 * buildFollowUpVerificationQuery, buildFollowUpRoleGroupCountsQuery) through PgDialect, never a hand-built fragment.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildFollowUpInsertQuery,
  buildFollowUpRoleGroupCountsQuery,
  buildFollowUpVerificationQuery,
  ROLE_GROUP_COUNT_COLUMNS,
} from "@/lib/followUp/candidateQuery";
import { openCycleRowSql } from "@/lib/followUp/openCycle";
import { readFileSync } from "node:fs";
import { parseExcludedRoleGroups, roleGroupCountsFromRows, roleGroupLeftOutCount } from "@/lib/followUp/roleGroupPreference";
import { ROLE_GROUPS } from "@/lib/roleGroups";

const dialect = new PgDialect();
const BD_ID = "00000000-0000-0000-0000-000000000001";
const renderInsert = () => dialect.sqlToQuery(buildFollowUpInsertQuery(BD_ID, "2026-11-16")).sql;
const EXCLUSION = /not exists\s*\(\s*select 1 from "bd"\s+where bd\.id = \$\d+::uuid\s+and fuq_role_group = any\(bd\.follow_up_excluded_role_groups\)\s*\)/i;

test("buildFollowUpInsertQuery: reads the BD's deny-list in the same statement via a correlated NOT EXISTS on bd", () => {
  assert.match(renderInsert(), EXCLUSION);
});

test("buildFollowUpInsertQuery: the exclusion is applied before the limit, so the cap fills with kept roles", () => {
  const sqlText = renderInsert();
  assert.ok(sqlText.search(EXCLUSION) !== -1 && sqlText.search(EXCLUSION) < sqlText.search(/limit greatest/i));
});

test("buildFollowUpInsertQuery: the predicate compares the stored column as-is, so a NULL role_group is never excluded", () => {
  const sqlText = renderInsert();
  assert.match(sqlText, /person\.role_group as fuq_role_group/);
  // NULL = any(...) is NULL, and NOT EXISTS over zero rows is true: no coalesce to 'no_position' anywhere.
  assert.doesNotMatch(sqlText, /coalesce\(\s*person\.role_group|coalesce\(\s*fuq_role_group/i);
});

test("buildFollowUpInsertQuery: the SQL never branches on the deny-list's size, so an empty one rides on = any('{}') being false", () => {
  assert.doesNotMatch(renderInsert(), /cardinality|array_length/i);
});

test("buildFollowUpVerificationQuery: applies the same exclusion per owner BD", () => {
  const sqlText = dialect.sqlToQuery(buildFollowUpVerificationQuery()).sql;
  assert.match(sqlText, /from "bd"\s+where bd\.id = fuq_owner_bd_id\s+and fuq_role_group = any\(bd\.follow_up_excluded_role_groups\)/i);
});

test("openCycleRowSql: does NOT read the preference, so saving never evicts a row already in the queue", () => {
  const sqlText = dialect.sqlToQuery(openCycleRowSql()).sql;
  assert.doesNotMatch(sqlText, /follow_up_excluded_role_groups|role_group/i);
});

test("buildFollowUpRoleGroupCountsQuery: counts the due set (fuq_due) of one BD grouped by role group, without the exclusion", () => {
  const sqlText = dialect.sqlToQuery(buildFollowUpRoleGroupCountsQuery(BD_ID)).sql;
  assert.match(sqlText, /from fuq_due\s+where fuq_owner_bd_id = \$\d+::uuid\s+group by fuq_role_group/i);
  assert.match(sqlText, new RegExp(`fuq_role_group as ${ROLE_GROUP_COUNT_COLUMNS.group}`));
  assert.match(sqlText, new RegExp(`count\\(\\*\\)::int as ${ROLE_GROUP_COUNT_COLUMNS.count}`));
  assert.doesNotMatch(sqlText, /follow_up_excluded_role_groups/);
});

test("roleGroupCountsFromRows: returns every group, zero when the query had no row, and numbers even when postgres-js sends strings", () => {
  const { group, count } = ROLE_GROUP_COUNT_COLUMNS;
  const counts = roleGroupCountsFromRows([
    { [group]: "developers", [count]: "23" },
    { [group]: "product", [count]: 5 },
    { [group]: null, [count]: 4 },
  ] as never);
  assert.deepEqual(Object.keys(counts).sort(), ROLE_GROUPS.map((g) => g.key).sort());
  assert.equal(counts.developers, 23);
  assert.equal(counts.product, 5);
  assert.equal(counts.sales_bd, 0);
  assert.equal(counts.no_position, 0, "a NULL role_group is not Sin cargo: it is in no group and is never excluded");
});

test("parseExcludedRoleGroups: accepts known keys and returns them once each in display order", () => {
  const r = parseExcludedRoleGroups(["sales_bd", "developers", "developers"]);
  assert.deepEqual(r, { ok: true, groups: ["developers", "sales_bd"] });
});

test("parseExcludedRoleGroups: an empty list is valid (include everything)", () => {
  assert.deepEqual(parseExcludedRoleGroups([]), { ok: true, groups: [] });
});

test("parseExcludedRoleGroups: rejects an unknown key", () => {
  assert.deepEqual(parseExcludedRoleGroups(["developers", "ceo_of_mars"]), { ok: false, error: "unknown_group" });
});

test("parseExcludedRoleGroups: rejects a non-array and non-string entries", () => {
  assert.deepEqual(parseExcludedRoleGroups("developers"), { ok: false, error: "invalid" });
  assert.deepEqual(parseExcludedRoleGroups([1]), { ok: false, error: "invalid" });
});

test("parseExcludedRoleGroups: rejects excluding every group", () => {
  const all = ROLE_GROUPS.map((g) => g.key);
  assert.deepEqual(parseExcludedRoleGroups(all), { ok: false, error: "all_excluded" });
});

test("parseExcludedRoleGroups: all but one excluded is accepted", () => {
  const allButOne = ROLE_GROUPS.slice(1).map((g) => g.key);
  assert.equal(parseExcludedRoleGroups(allButOne).ok, true);
});

test("parseExcludedRoleGroups: called twice with the same input gives the same result and leaves the input untouched", () => {
  const input = ["sales_bd", "developers", "sales_bd"];
  const snapshot = [...input];
  assert.deepEqual(parseExcludedRoleGroups(input), parseExcludedRoleGroups(input));
  assert.deepEqual(input, snapshot);
});

test("roleGroupLeftOutCount: sums the due counts of the saved excluded groups only", () => {
  const counts = roleGroupCountsFromRows([
    { [ROLE_GROUP_COUNT_COLUMNS.group]: "developers", [ROLE_GROUP_COUNT_COLUMNS.count]: 23 },
    { [ROLE_GROUP_COUNT_COLUMNS.group]: "sales_bd", [ROLE_GROUP_COUNT_COLUMNS.count]: 12 },
    { [ROLE_GROUP_COUNT_COLUMNS.group]: "product", [ROLE_GROUP_COUNT_COLUMNS.count]: 5 },
  ]);
  assert.equal(roleGroupLeftOutCount(counts, ["developers", "sales_bd"]), 35);
  assert.equal(roleGroupLeftOutCount(counts, []), 0);
});

test("/follow-ups page source does not call the counts read, so the aggregate is not paid on page load", () => {
  const page = readFileSync("src/app/(app)/follow-ups/page.tsx", "utf8");
  assert.doesNotMatch(page, /getFollowUpRoleGroupCounts|buildFollowUpRoleGroupCountsQuery/);
});

test("the lazy counts action reads the counts for the signed-in BD's own id", () => {
  const actions = readFileSync("src/app/(app)/follow-ups/actions.ts", "utf8");
  assert.match(actions, /getFollowUpRoleGroupCountsAction[\s\S]*getFollowUpRoleGroupCounts\(me\.id\)/);
});
