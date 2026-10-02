import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NULL_GROUP_LABEL,
  planRoleGroupPage,
  summarizeTally,
  type RoleGroupTally,
} from "../../src/lib/contacts/personRoleGroupBackfill";

const emptyTally = (): RoleGroupTally => ({ before: {}, after: {}, transitions: {} });

test("planRoleGroupPage reports only rows whose group changes", () => {
  const tally = emptyTally();
  const changes = planRoleGroupPage(
    [
      { id: "a", jobTitle: "Director General", roleGroup: "other" },
      { id: "b", jobTitle: "Director General", roleGroup: "c_level_business" },
      { id: "c", jobTitle: null, roleGroup: null },
    ],
    tally,
  );
  assert.deepEqual(changes, [
    { id: "a", roleGroup: "c_level_business" },
    { id: "c", roleGroup: "no_position" },
  ]);
  assert.equal(tally.transitions[`other -> c_level_business`], 1);
  assert.equal(tally.transitions[`${NULL_GROUP_LABEL} -> no_position`], 1);
  assert.equal(tally.before.other, 1);
  assert.equal(tally.after.c_level_business, 2);
});

test("planRoleGroupPage is pure: same input twice gives the same result and input is untouched", () => {
  const rows = [
    { id: "a", jobTitle: "Hotel Manager", roleGroup: "other" },
    { id: "b", jobTitle: "Revenue Manager", roleGroup: "other" },
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const first = planRoleGroupPage(rows, emptyTally());
  const second = planRoleGroupPage(rows, emptyTally());
  assert.deepEqual(first, second);
  assert.deepEqual(rows, snapshot);
});

test("a second pass over already-updated rows reports zero transitions", () => {
  const tally = emptyTally();
  const changes = planRoleGroupPage([{ id: "a", jobTitle: "Hotel Manager", roleGroup: "c_level_business" }], tally);
  assert.deepEqual(changes, []);
  assert.deepEqual(summarizeTally(tally).transitions, []);
});

test("summarizeTally sorts by count desc and excludes unchanged pairs", () => {
  const tally = emptyTally();
  planRoleGroupPage(
    [
      { id: "a", jobTitle: "Hotel Manager", roleGroup: "other" },
      { id: "b", jobTitle: "Hotel Manager", roleGroup: "other" },
      { id: "c", jobTitle: "Hotel Manager", roleGroup: "sales_bd" },
      { id: "d", jobTitle: "Hotel Manager", roleGroup: "c_level_business" },
    ],
    tally,
  );
  assert.deepEqual(summarizeTally(tally).transitions, [
    { transition: "other -> c_level_business", count: 2 },
    { transition: "sales_bd -> c_level_business", count: 1 },
  ]);
});
