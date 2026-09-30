/**
 * Unit tests for src/lib/followUp/queueSelection.ts's "worked today" time
 * resolver (email-sync brief follow-up: a synced email_sent/reply_received
 * row's created_at is when the sync ran, not when the BD did anything — see
 * resolveWorkedTodayAt's doc comment for why `call` is deliberately
 * excluded from this treatment).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveWorkedTodayAt, workedTodayAtSql } from "@/lib/followUp/queueSelection";

const dialect = new PgDialect();

test("resolveWorkedTodayAt: a platform email_sent (no occurredAt) uses createdAt", () => {
  const createdAt = new Date("2026-09-30T09:00:00.000Z");
  const at = resolveWorkedTodayAt({
    id: "a1",
    type: "email_sent",
    createdAt,
    metadata: { to: "jane@prospect.com", subject: "hi" },
  });
  assert.equal(at.getTime(), createdAt.getTime());
});

test("an email sent from Gmail TODAY counts as worked today (occurredAt = createdAt = today)", () => {
  const now = new Date("2026-09-30T09:00:00.000Z");
  const at = resolveWorkedTodayAt({
    id: "a1",
    type: "email_sent",
    createdAt: now,
    metadata: { occurredAt: now.toISOString() },
  });
  assert.equal(at.getTime(), now.getTime());
});

test("a backfilled reply from 60 days ago does NOT count as worked today, even though it was synced (created_at) today", () => {
  const syncedToday = new Date("2026-09-30T09:00:00.000Z");
  const reallyReceivedAt = new Date(syncedToday.getTime() - 60 * 24 * 60 * 60 * 1000);
  const at = resolveWorkedTodayAt({
    id: "a1",
    type: "reply_received",
    createdAt: syncedToday,
    metadata: { occurredAt: reallyReceivedAt.toISOString() },
  });
  assert.equal(at.getTime(), reallyReceivedAt.getTime());
  assert.notEqual(at.getTime(), syncedToday.getTime());
});

test("a call ALWAYS uses createdAt, never metadata.occurredAt — logging it today is the BD action that counts as worked today", () => {
  const createdAt = new Date("2026-09-30T09:00:00.000Z");
  const occurredYesterday = new Date(createdAt.getTime() - 24 * 60 * 60 * 1000);
  const at = resolveWorkedTodayAt({
    id: "a1",
    type: "call",
    createdAt,
    metadata: { outcome: "connected", direction: "outbound", occurredAt: occurredYesterday.toISOString() },
  });
  assert.equal(at.getTime(), createdAt.getTime());
});

test("note/meeting_logged/discarded always use createdAt (no occurredAt concept)", () => {
  const createdAt = new Date("2026-09-30T09:00:00.000Z");
  for (const type of ["note", "meeting_logged", "discarded"]) {
    const at = resolveWorkedTodayAt({ id: "a1", type, createdAt, metadata: {} });
    assert.equal(at.getTime(), createdAt.getTime(), type);
  }
});

test("workedTodayAtSql(): a dedicated 'call' branch always resolves to created_at, checked before the occurredAt branch", () => {
  const renderedSql = dialect.sqlToQuery(workedTodayAtSql()).sql;
  assert.match(renderedSql, /case\s+when\s+"activity"\."type"\s+=\s+'call'\s+then\s+"activity"\."created_at"/i);
});

test("workedTodayAtSql(): the occurredAt branch's IN-list is exactly email_sent and reply_received, never 'call'", () => {
  const { params } = dialect.sqlToQuery(workedTodayAtSql());
  assert.deepEqual(params, ["email_sent", "reply_received"]);
});
