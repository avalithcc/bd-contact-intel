/**
 * The Contact record's "Grupo de rol" row shows the STORED group as a
 * dictionary label (never the enum key), and says so when the current Cargo
 * would classify into a different group.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { roleGroupDisplay, roleGroupRowView } from "@/lib/contacts/roleGroupDisplay";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";

const EMPTY = "—";

test("a known key renders its label", () => {
  assert.equal(roleGroupDisplay("engineering_manager", es.roleGroups, EMPTY), "Gerentes de Ingeniería");
});

test("unknown, null, empty and whitespace values render the placeholder, never a raw key", () => {
  for (const v of ["legacy_group", null, "", "   "]) {
    assert.equal(roleGroupDisplay(v, es.roleGroups, EMPTY), EMPTY);
  }
});

test("Object.prototype names are not mistaken for keys", () => {
  for (const v of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(roleGroupDisplay(v, es.roleGroups, EMPTY), EMPTY);
  }
});

const rowFor = (stored: string | null, derived: Parameters<typeof roleGroupRowView>[1]) =>
  roleGroupRowView(stored, derived, es.roleGroups, EMPTY, es.contactRecord.roleGroupDerivedHint, es.contactRecordServer.roleGroupDriftHint);

test("matching stored and derived group keeps the plain hint", () => {
  const row = rowFor("developers", "developers");
  assert.equal(row.text, es.roleGroups.developers);
  assert.equal(row.hint, es.contactRecord.roleGroupDerivedHint);
});

test("differing groups keep showing the STORED label and name both labels in the hint", () => {
  const row = rowFor("developers", "eng_leadership");
  assert.equal(row.text, es.roleGroups.developers);
  assert.ok(row.hint.includes(es.roleGroups.developers));
  assert.ok(row.hint.includes(es.roleGroups.eng_leadership));
  assert.notEqual(row.hint, es.contactRecord.roleGroupDerivedHint);
  assert.ok(!row.hint.includes("eng_leadership") && !row.hint.includes("developers"));
});

test("a null or unknown stored group is a disagreement that names only the derived label", () => {
  for (const stored of [null, "legacy_group"]) {
    const row = rowFor(stored, "eng_leadership");
    assert.equal(row.text, EMPTY);
    assert.ok(row.hint.includes(es.roleGroups.eng_leadership));
    assert.ok(!row.hint.includes("legacy_group"));
    assert.notEqual(row.hint, es.contactRecord.roleGroupDerivedHint);
  }
});

test("both dictionaries carry the hints", () => {
  for (const d of [es, en]) {
    assert.ok(d.contactRecord.roleGroupDerivedHint.length > 0);
    assert.ok(d.contactRecordServer.roleGroupDriftHint("A", "B").includes("B"));
    assert.ok(d.contactRecordServer.roleGroupDriftHint(null, "B").includes("B"));
  }
});
