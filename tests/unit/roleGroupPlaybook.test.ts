/**
 * Unit tests for src/lib/roleGroupPlaybook.ts (openspec/changes/bd-playbook).
 * Guards the mapping every `RoleGroupKey` -> playbook content: a role group
 * that classifyPosition can return but the playbook has no entry for would
 * render a blank card / crash the "por qué este rol" hint.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_GROUPS } from "@/lib/roleGroups";
import {
  NOT_WORTH_PRIORITIZING,
  PRIORITY_BADGE_CLASS,
  ROLE_GROUP_PLAYBOOK,
} from "@/lib/roleGroupPlaybook";

test("every RoleGroupKey in ROLE_GROUPS has a playbook entry", () => {
  for (const { key } of ROLE_GROUPS) {
    assert.ok(ROLE_GROUP_PLAYBOOK[key], `missing playbook entry for "${key}"`);
  }
});

test("every playbook entry has a badge class for its priority", () => {
  for (const { key } of ROLE_GROUPS) {
    const entry = ROLE_GROUP_PLAYBOOK[key];
    assert.ok(PRIORITY_BADGE_CLASS[entry.priority], `missing badge class for "${key}"'s priority "${entry.priority}"`);
  }
});

test("every entry has either the 3 body fields or a note, never neither", () => {
  for (const { key } of ROLE_GROUPS) {
    const entry = ROLE_GROUP_PLAYBOOK[key];
    const hasBody = !!entry.decides && !!entry.painSolved && !!entry.wrongPerson;
    const hasNote = !!entry.note;
    assert.ok(hasBody || hasNote, `"${key}" has neither body fields nor a note`);
    assert.ok(!(hasBody && hasNote), `"${key}" has both body fields and a note — pick one`);
  }
});

test("NOT_WORTH_PRIORITIZING only references keys that exist in ROLE_GROUPS", () => {
  const validKeys = new Set(ROLE_GROUPS.map((g) => g.key));
  for (const tier of Object.values(NOT_WORTH_PRIORITIZING)) {
    for (const key of tier.keys) {
      assert.ok(validKeys.has(key), `NOT_WORTH_PRIORITIZING references unknown key "${key}"`);
    }
  }
});
