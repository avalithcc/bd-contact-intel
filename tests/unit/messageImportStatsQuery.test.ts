/**
 * Unit test for src/lib/linkedin/messageImportStatsQuery.ts. Pure builder,
 * no live DATABASE_URL (same convention as
 * tests/unit/appShellBadgeCountsQuery.test.ts). The point of these tests is
 * the privacy rule: message and conversation rows are private per BD, so the
 * stats must be anchored on bd_id and never aggregate across BDs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildMessageImportStatsQuery,
  toMessageImportStats,
} from "@/lib/linkedin/messageImportStatsQuery";

const dialect = new PgDialect();
const BD = "00000000-0000-0000-0000-000000000001";

function render() {
  return dialect.sqlToQuery(buildMessageImportStatsQuery(BD));
}

test("one statement with the three expected columns", () => {
  const { sql } = render();
  assert.match(sql, /as message_count/i);
  assert.match(sql, /as conversation_count/i);
  assert.match(sql, /as last_imported_at/i);
});

test("every table read is filtered by bd_id, and the bd id is bound as a parameter", () => {
  const { sql, params } = render();
  const fromClauses = sql.match(/from "(message|conversation)"/gi) ?? [];
  const bdFilters = sql.match(/"(message|conversation)"\.bd_id = \$\d+::uuid/gi) ?? [];
  assert.equal(fromClauses.length, 3);
  assert.equal(bdFilters.length, 3, "each subquery must filter by bd_id");
  assert.ok(params.length === 3 && params.every((p) => p === BD), "only the signed-in bd id is bound");
  assert.doesNotMatch(sql, new RegExp(BD), "bd id is never inlined in the SQL text");
});

test("message count excludes drafts; last import is max(message.created_at)", () => {
  const { sql } = render();
  assert.match(sql, /count\(\*\) from "message" where[^)]*is_draft = false/i);
  assert.match(sql, /max\("message"\.created_at\)/i);
});

test("toMessageImportStats normalizes aggregates to numbers and the timestamp to a Date", () => {
  const iso = "2026-09-17T15:30:00.000Z";
  const out = toMessageImportStats({
    message_count: "14545",
    conversation_count: 2988,
    last_imported_at: iso,
  });
  assert.deepEqual(out, { messageCount: 14545, conversationCount: 2988, lastImportedAt: new Date(iso) });
});

test("toMessageImportStats: nothing imported yet", () => {
  assert.deepEqual(toMessageImportStats({ message_count: 0, conversation_count: 0, last_imported_at: null }), {
    messageCount: 0,
    conversationCount: 0,
    lastImportedAt: null,
  });
  assert.deepEqual(toMessageImportStats(undefined), {
    messageCount: 0,
    conversationCount: 0,
    lastImportedAt: null,
  });
});

test("toMessageImportStats accepts a Date from the driver", () => {
  const d = new Date("2026-09-17T15:30:00.000Z");
  assert.equal(
    toMessageImportStats({ message_count: 1, conversation_count: 1, last_imported_at: d }).lastImportedAt?.getTime(),
    d.getTime(),
  );
});
