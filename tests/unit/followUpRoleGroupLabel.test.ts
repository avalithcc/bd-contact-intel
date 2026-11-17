/**
 * The badge the `follow-up-role-groups` mockup drew and the implementation never shipped — the gap the first
 * ux-auditor run found, with no decision recorded either way.
 *
 * What it must not do is render an empty chip. `person.role_group` is free-form text in the database: it holds a
 * `RoleGroupKey` today, but a row written before the taxonomy existed, or by an import, can hold anything. A blank
 * badge beside a contact's name says less than no badge at all.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { roleGroupLabel } from "@/lib/followUp/roleGroupLabel";
import { ROLE_GROUPS } from "@/lib/roleGroups";
import { es } from "@/lib/i18n/dictionaries/es";

const L = es.roleGroups;

describe("roleGroupLabel", () => {
  it("labels every group in the taxonomy, so no card can show a blank badge for a valid key", () => {
    for (const { key } of ROLE_GROUPS) {
      const label = roleGroupLabel(key, L);
      assert.ok(label && label.length > 0, `${key} has no label`);
    }
  });

  it("reads the label from the dictionary rather than the key", () => {
    assert.equal(roleGroupLabel("developers", L), L.developers);
    assert.equal(roleGroupLabel("c_level_tech", L), L.c_level_tech);
  });

  it("shows nothing for a contact that was never classified", () => {
    assert.equal(roleGroupLabel(null, L), null);
    assert.equal(roleGroupLabel("", L), null);
  });

  it("shows nothing for a stored value outside the taxonomy, rather than the raw key", () => {
    assert.equal(roleGroupLabel("vp_of_vibes", L), null);
    assert.equal(roleGroupLabel("DEVELOPERS", L), null, "the match is exact: a key is not a display string");
  });

  it("labels no_position, which is a real classification and not the absence of one", () => {
    // "Sin cargo" means we looked and the title was blank; null means nobody classified the contact at all.
    assert.equal(roleGroupLabel("no_position", L), L.no_position);
    assert.notEqual(roleGroupLabel("no_position", L), roleGroupLabel(null, L));
  });
});
