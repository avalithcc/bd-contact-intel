import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NULL_GROUP_LABEL,
  planRoleGroupPage,
  summarizeTally,
  type RoleGroupTally,
} from "../../src/lib/contacts/personRoleGroupBackfill";

const emptyTally = (): RoleGroupTally => ({ before: {}, after: {}, transitions: {}, skippedHumanEdits: 0 });

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
  assert.deepEqual(
    changes.map((c) => [c.id, c.from, c.roleGroup]),
    [
      ["a", "other", "c_level_business"],
      ["c", null, "no_position"],
    ],
  );
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

test("rows with a human roleGroup edit are never changed, only counted", () => {
  const tally = emptyTally();
  const changes = planRoleGroupPage(
    [
      { id: "a", jobTitle: "Director General", roleGroup: "other", humanEdited: true },
      { id: "b", jobTitle: "Director General", roleGroup: "other" },
    ],
    tally,
  );
  assert.deepEqual(changes.map((c) => c.id), ["b"]);
  assert.equal(tally.skippedHumanEdits, 1);
  assert.equal(tally.before.other, 2);
  assert.equal(tally.after.other, 1);
  assert.equal(tally.after.c_level_business, 1);
});

test("changes carry the owner and contact type the visibility report needs", () => {
  const [c] = planRoleGroupPage(
    [{ id: "a", jobTitle: "Hotel Manager", roleGroup: null, ownerBdId: "bd1", contactType: "INFLUENCER" }],
    emptyTally(),
  );
  assert.deepEqual(c, { id: "a", from: null, roleGroup: "c_level_business", ownerBdId: "bd1", contactType: "INFLUENCER" });
});

test("summarizeTally totals the (null) -> * transitions", () => {
  const tally = emptyTally();
  planRoleGroupPage(
    [
      { id: "a", jobTitle: "Hotel Manager", roleGroup: null },
      { id: "b", jobTitle: "Hotel Manager", roleGroup: null },
      { id: "c", jobTitle: "Hotel Manager", roleGroup: "other" },
    ],
    tally,
  );
  assert.equal(summarizeTally(tally).nullClassified, 2);
});
