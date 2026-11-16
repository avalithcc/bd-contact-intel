/**
 * admin-role-group-visibility: the read-only "Roles excluidos" cell of the queue-adherence table.
 *
 * The invariant that matters is honesty: this cell qualifies the adherence % next to it, so it must never understate
 * what a BD excludes. The overflow case and the unknown-key case are the two ways it could.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { excludedRoleGroupsCell } from "@/lib/reports/excludedRoleGroupsCell";
import { es } from "@/lib/i18n/dictionaries/es";
import { ROLE_GROUPS } from "@/lib/roleGroups";

const L = es.roleGroups;

describe("excludedRoleGroupsCell", () => {
  it("renders a BD with no exclusions as empty, with nothing to show and no hover text", () => {
    const cell = excludedRoleGroupsCell([], L);
    assert.equal(cell.empty, true);
    assert.deepEqual(cell.shown, []);
    assert.equal(cell.overflow, 0);
    assert.equal(cell.title, "");
  });

  it("shows a single exclusion with no overflow", () => {
    const cell = excludedRoleGroupsCell(["developers"], L);
    assert.equal(cell.empty, false);
    assert.deepEqual(cell.shown, [L.developers]);
    assert.equal(cell.overflow, 0);
    assert.equal(cell.title, L.developers);
  });

  it("shows two and counts the rest as overflow, keeping ALL of them in the hover title", () => {
    const cell = excludedRoleGroupsCell(["developers", "sales_bd", "no_position"], L);
    assert.equal(cell.shown.length, 2);
    assert.equal(cell.overflow, 1);
    // The point of the test: the hidden one is still reachable, so the cell never understates.
    assert.equal(cell.title, [L.developers, L.sales_bd, L.no_position].join(", "));
    assert.ok(cell.title.includes(L.no_position));
  });

  it("orders by ROLE_GROUPS display order, not by the order the BD happened to save", () => {
    const saved = excludedRoleGroupsCell(["no_position", "developers"], L, 2);
    const reversed = excludedRoleGroupsCell(["developers", "no_position"], L, 2);
    assert.deepEqual(saved.shown, reversed.shown, "same exclusions must read identically whatever the stored order");
    assert.deepEqual(saved.shown, [L.developers, L.no_position]);
  });

  it("de-duplicates a repeated key instead of inflating the count", () => {
    const cell = excludedRoleGroupsCell(["developers", "developers"], L, 2);
    assert.deepEqual(cell.shown, [L.developers]);
    assert.equal(cell.overflow, 0);
  });

  it("keeps a stored key that is no longer a role group, shown last by its raw key", () => {
    const cell = excludedRoleGroupsCell(["developers", "retired_group"], L, 2);
    assert.deepEqual(cell.shown, [L.developers, "retired_group"]);
    assert.equal(cell.overflow, 0);
    assert.ok(cell.title.includes("retired_group"), "a dropped group must not vanish from an admin report");
  });

  it("counts every group correctly when a BD excludes all of them", () => {
    const cell = excludedRoleGroupsCell(
      ROLE_GROUPS.map((g) => g.key),
      L,
      2,
    );
    assert.equal(cell.shown.length, 2);
    assert.equal(cell.overflow, ROLE_GROUPS.length - 2);
    assert.equal(cell.title.split(", ").length, ROLE_GROUPS.length);
  });
});
