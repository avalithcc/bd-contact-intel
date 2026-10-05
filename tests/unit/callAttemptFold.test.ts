/**
 * The fold predicate shared by the contact timeline and the company Activity
 * tab: an attempt answered with "Hablé" must not show next to its own call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { notFoldedAttemptSql } from "@/lib/activity/callAttemptFold";

test("the fold predicate skips only call attempts that carry callActivityId", () => {
  const { sql: text } = new PgDialect().sqlToQuery(notFoldedAttemptSql());
  assert.match(text, /not \(.*"type" = 'call_attempt' and \(.*->>'callActivityId'\) is not null\)/);
});
