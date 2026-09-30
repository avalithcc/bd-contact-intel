/**
 * PgDialect render tests for src/lib/identity/mergeDb.ts's new collision-
 * lookup conditions (merge data-loss bugfix: email_message_person /
 * follow_up_queue_item were never repointed on merge — see merge.ts's doc
 * comment). mergeDb.ts itself is "not unit-tested directly" (importing the
 * live `db` throws without DATABASE_URL, per its own header comment), but
 * these two conditions are pure `SQL`-returning functions built from schema
 * table objects only (same convention as
 * src/lib/identity/mergedProfileKeys.ts's `mergedProfileKeysAnyCondition`),
 * so they can be rendered and pinned with no live connection.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { survivorEmailMessagePersonCondition, survivorQueueItemCondition } from "@/lib/identity/mergeDb";

const dialect = new PgDialect();
const SURVIVOR_ID = "00000000-0000-0000-0000-000000000001";

test("survivorEmailMessagePersonCondition: renders person_id = $1 and email_message_id in (...)", () => {
  const { sql: rendered, params } = dialect.sqlToQuery(survivorEmailMessagePersonCondition(SURVIVOR_ID, ["msg-1", "msg-2"]));
  assert.match(rendered, /"email_message_person"\."person_id" = \$1/);
  assert.match(rendered, /"email_message_person"\."email_message_id" in \(\$2, \$3\)/i);
  assert.deepEqual(params, [SURVIVOR_ID, "msg-1", "msg-2"]);
});

test("survivorEmailMessagePersonCondition: an empty emailMessageIds array renders a short-circuiting 'false', never an empty IN()", () => {
  const { sql: rendered } = dialect.sqlToQuery(survivorEmailMessagePersonCondition(SURVIVOR_ID, []));
  assert.match(rendered, /false/i);
  assert.doesNotMatch(rendered, /in \(\)/i, "an empty IN () is invalid SQL — drizzle's inArray must short-circuit instead");
});

test("survivorQueueItemCondition: renders person_id = $1 and bd_id in (...) and queue_date in (...)", () => {
  const { sql: rendered, params } = dialect.sqlToQuery(survivorQueueItemCondition(SURVIVOR_ID, ["bd-1"], ["2026-01-05", "2026-01-06"]));
  assert.match(rendered, /"follow_up_queue_item"\."person_id" = \$1/);
  assert.match(rendered, /"follow_up_queue_item"\."bd_id" in \(\$2\)/i);
  assert.match(rendered, /"follow_up_queue_item"\."queue_date" in \(\$3, \$4\)/i);
  assert.deepEqual(params, [SURVIVOR_ID, "bd-1", "2026-01-05", "2026-01-06"]);
});

test("survivorQueueItemCondition: an empty bdIds array renders a short-circuiting 'false', never an empty IN()", () => {
  const { sql: rendered } = dialect.sqlToQuery(survivorQueueItemCondition(SURVIVOR_ID, [], ["2026-01-05"]));
  assert.match(rendered, /false/i);
});
