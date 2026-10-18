/**
 * Guards the removal of the dead `task.lead_id` / `task.contact_id` columns
 * (openspec/BACKLOG.md "task.lead_id and task.contact_id"). Pure — schema only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { task } from "@/db/schema";

test("task no longer maps the dead legacy subject columns", () => {
  const columns = Object.keys(getTableColumns(task));
  assert.ok(!columns.includes("leadId"));
  assert.ok(!columns.includes("contactId"));
  assert.ok(columns.includes("personId"));
  assert.ok(columns.includes("companyKey"));
});
