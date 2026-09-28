/**
 * Unit tests for src/lib/contacts/statusBadge.ts (mockup-port r02).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";

test("every known PersonStatus maps to its own badge-{status} class", () => {
  assert.equal(statusBadgeClass("new"), "badge badge-new");
  assert.equal(statusBadgeClass("contacted"), "badge badge-contacted");
  assert.equal(statusBadgeClass("replied"), "badge badge-replied");
  assert.equal(statusBadgeClass("meeting"), "badge badge-meeting");
  assert.equal(statusBadgeClass("discarded"), "badge badge-discarded");
});

test("an unknown status falls back to a neutral badge instead of throwing", () => {
  assert.equal(statusBadgeClass("something_unexpected"), "badge badge-neutral");
});
