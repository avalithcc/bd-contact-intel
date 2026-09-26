/**
 * Unit tests for src/lib/contacts/savedViewInput.ts (task 12.3 — `saved_view`
 * CRUD for BD-created views, design D7). Pure validation only: the thin DB
 * glue (savedViews.ts) imports `db` and is not unit-tested directly, same
 * convention as propertyEditDb.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SavedViewNameError, planSavedViewInput } from "@/lib/contacts/savedViewInput";

test("planSavedViewInput trims the name and keeps recognized filters", () => {
  const plan = planSavedViewInput({
    name: "  Sin contactar, ingeniería  ",
    filters: { owner: "me", status: ["new"] },
    columns: ["name", "company"],
    sort: { field: "lastActivity", direction: "desc" },
  });
  assert.equal(plan.name, "Sin contactar, ingeniería");
  assert.deepEqual(plan.filters, { owner: "me", status: ["new"] });
  assert.deepEqual(plan.columns, ["name", "company"]);
  assert.deepEqual(plan.sort, { field: "lastActivity", direction: "desc" });
});

test("planSavedViewInput rejects a blank name", () => {
  assert.throws(
    () => planSavedViewInput({ name: "   ", filters: {}, columns: [], sort: {} }),
    SavedViewNameError,
  );
});

test("planSavedViewInput rejects a name over 100 characters", () => {
  assert.throws(
    () => planSavedViewInput({ name: "x".repeat(101), filters: {}, columns: [], sort: {} }),
    SavedViewNameError,
  );
});

test("planSavedViewInput drops non-string column entries", () => {
  const plan = planSavedViewInput({
    name: "Vista",
    filters: {},
    columns: ["name", 42, null, "email"] as unknown as string[],
    sort: {},
  });
  assert.deepEqual(plan.columns, ["name", "email"]);
});

test("planSavedViewInput defaults sort to {} when malformed", () => {
  const plan = planSavedViewInput({ name: "Vista", filters: {}, columns: [], sort: "bogus" as never });
  assert.deepEqual(plan.sort, {});
});
