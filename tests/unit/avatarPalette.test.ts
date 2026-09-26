/**
 * Unit tests for src/components/avatarPalette.ts (tasks.md mockup-parity
 * 2.1). Deterministic mapping from a stable id (contact/BD id) to one of
 * the mockup's 6 avatar palette classes (mockups/styles.css `.a1`..`.a6`,
 * design-system.html's "Avatares y chip de responsable" section) — same
 * input must always produce the same color, so a contact's avatar doesn't
 * change color on every render.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarPaletteClass } from "@/components/avatarPalette";

test("avatarPaletteClass returns one of the 6 palette classes", () => {
  const cls = avatarPaletteClass("contact-123");
  assert.match(cls, /^a[1-6]$/);
});

test("avatarPaletteClass is deterministic for the same id", () => {
  assert.equal(avatarPaletteClass("contact-abc"), avatarPaletteClass("contact-abc"));
});

test("avatarPaletteClass distributes different ids across different classes", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const classes = new Set(ids.map((id) => avatarPaletteClass(id)));
  // Not asserting a specific distribution, just that it isn't a constant
  // function collapsing every id onto the same class.
  assert.ok(classes.size > 1);
});

test("avatarPaletteClass throws on an empty id", () => {
  assert.throws(() => avatarPaletteClass(""), TypeError);
});
