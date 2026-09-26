/**
 * Unit tests for src/lib/contacts/columnOrder.ts — the "Columnas" picker's
 * drag-and-drop / keyboard reorder (mockups/contacts.html: "arrastrar para
 * reordenar", `.drag` handles). Pure array reordering only — no DOM, no DB
 * — ColumnPicker.tsx (client component) calls these on drag/keyboard events.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildColumnOrder, moveColumn, reorderColumn } from "@/lib/contacts/columnOrder";
import { ALL_CONTACT_COLUMNS } from "@/lib/contacts/columns";

test("buildColumnOrder puts the visible columns first, in their given order, then every remaining column", () => {
  const order = buildColumnOrder(ALL_CONTACT_COLUMNS, ["status", "company"]);
  assert.deepEqual(order.slice(0, 2), ["status", "company"]);
  assert.equal(order.length, ALL_CONTACT_COLUMNS.length);
  assert.ok(new Set(order).size === ALL_CONTACT_COLUMNS.length);
});

test("buildColumnOrder with no visible columns returns ALL_CONTACT_COLUMNS unchanged", () => {
  assert.deepEqual(buildColumnOrder(ALL_CONTACT_COLUMNS, []), ALL_CONTACT_COLUMNS);
});

test("moveColumn swaps a key with its neighbor in the given direction", () => {
  const order = moveColumn(["company", "owner", "status"], "owner", -1);
  assert.deepEqual(order, ["owner", "company", "status"]);
  const order2 = moveColumn(["company", "owner", "status"], "owner", 1);
  assert.deepEqual(order2, ["company", "status", "owner"]);
});

test("moveColumn is a no-op at either boundary", () => {
  const order = ["company", "owner", "status"] as const;
  assert.deepEqual(moveColumn([...order], "company", -1), order);
  assert.deepEqual(moveColumn([...order], "status", 1), order);
});

test("moveColumn is a no-op for an unknown key (never throws)", () => {
  const order = ["company", "owner"] as const;
  assert.deepEqual(moveColumn([...order], "seniority", 1), order);
});

test("reorderColumn moves the dragged key to just before the drop target", () => {
  const order = reorderColumn(["company", "owner", "status", "email"], "email", "owner");
  assert.deepEqual(order, ["company", "email", "owner", "status"]);
});

test("reorderColumn dragging onto itself is a no-op", () => {
  const order = ["company", "owner"] as const;
  assert.deepEqual(reorderColumn([...order], "company", "company"), order);
});

test("reorderColumn is a no-op when the drop target isn't in the order (never throws)", () => {
  const order = ["company", "owner"] as const;
  assert.deepEqual(reorderColumn([...order], "company", "seniority"), order);
});
