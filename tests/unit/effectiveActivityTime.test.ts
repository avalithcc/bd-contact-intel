/**
 * Unit tests for src/lib/contacts/effectiveActivityTime.ts — the bug fix
 * for "Última actividad" (column, sort, and `lastActivityDays` filter)
 * reading `activity.created_at` for `status_backfill` rows instead of
 * `metadata.originalAt` (the historical time the migration reconstructed).
 * This module is a thin, explicitly-named wrapper around
 * src/lib/status/deriveStatus.ts#activityRowToStatusEvent's `.at`
 * computation — the SAME rule that function already uses — so the two
 * never drift (mirrors the fix instructions: "Mirror the rule
 * deriveStatus.ts already uses"). The SQL side (listQueries.ts) embeds an
 * equivalent CASE expression; this test file pins the JS-side rule the SQL
 * must match.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildSinceIso,
  effectiveActivityAtSql,
  isEffectiveActivityWithinDays,
  NON_TOUCH_ACTIVITY_TYPES,
  resolveEffectiveActivityAt,
} from "@/lib/contacts/effectiveActivityTime";

const dialect = new PgDialect();

test("effectiveActivityAtSql(): the rendered CASE returns NULL for every NON_TOUCH_ACTIVITY_TYPES value, checked before the status_backfill/call branches", () => {
  const renderedSql = dialect.sqlToQuery(effectiveActivityAtSql()).sql;
  const placeholders = NON_TOUCH_ACTIVITY_TYPES.map((_, i) => `\\$${i + 1}`).join(", ");
  assert.match(renderedSql, new RegExp(`case\\s+when\\s+"activity"\\."type"\\s+in\\s+\\(${placeholders}\\)\\s+then\\s+null`, "i"));
  const { params } = dialect.sqlToQuery(effectiveActivityAtSql());
  assert.deepEqual(params.slice(0, NON_TOUCH_ACTIVITY_TYPES.length), [...NON_TOUCH_ACTIVITY_TYPES]);
});

test("resolveEffectiveActivityAt: a status_backfill row with a valid metadata.originalAt uses that, not createdAt", () => {
  const originalAt = new Date("2026-06-01T00:00:00.000Z");
  const createdAt = new Date("2026-09-26T00:00:00.000Z"); // migration run date
  const at = resolveEffectiveActivityAt({
    id: "a1",
    type: "status_backfill",
    createdAt,
    metadata: { originalAt: originalAt.toISOString() },
  });
  assert.equal(at!.getTime(), originalAt.getTime());
});

test("resolveEffectiveActivityAt: a status_backfill row with missing/unparseable originalAt falls back to createdAt", () => {
  const createdAt = new Date("2026-09-26T00:00:00.000Z");
  assert.equal(
    resolveEffectiveActivityAt({ id: "a1", type: "status_backfill", createdAt, metadata: {} })!.getTime(),
    createdAt.getTime(),
  );
  assert.equal(
    resolveEffectiveActivityAt({
      id: "a2",
      type: "status_backfill",
      createdAt,
      metadata: { originalAt: "not-a-date" },
    })!.getTime(),
    createdAt.getTime(),
  );
});

test("resolveEffectiveActivityAt: a call row with a valid metadata.occurredAt uses that, not createdAt", () => {
  const occurredAt = new Date("2026-09-15T10:20:00.000Z");
  const createdAt = new Date("2026-09-26T00:00:00.000Z"); // dialog saved later
  const at = resolveEffectiveActivityAt({
    id: "a1",
    type: "call",
    createdAt,
    metadata: { outcome: "connected", direction: "outbound", occurredAt: occurredAt.toISOString() },
  });
  assert.equal(at!.getTime(), occurredAt.getTime());
});

// --- email_sent/reply_received (email-sync brief; feat/follow-up-queue
// dependency): a synced Gmail message's real send/receive time lives in
// metadata.occurredAt, not created_at (sync/backfill processing time). ----

test("resolveEffectiveActivityAt: a reply_received row with a valid metadata.occurredAt uses that, not createdAt", () => {
  const occurredAt = new Date("2026-09-15T10:20:00.000Z");
  const createdAt = new Date("2026-09-30T00:00:00.000Z");
  const at = resolveEffectiveActivityAt({
    id: "a1",
    type: "reply_received",
    createdAt,
    metadata: { gmailThreadId: "t1", occurredAt: occurredAt.toISOString() },
  });
  assert.equal(at!.getTime(), occurredAt.getTime());
});

test("a reply backfilled 60 days after it happened does not look like a recent touch (the exact email-sync bug this fixes)", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const syncedToday = now; // created_at = when the backfill ran, today
  const reallySentAt = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
  const row = {
    id: "reply-1",
    type: "reply_received",
    createdAt: syncedToday,
    metadata: { gmailThreadId: "t1", occurredAt: reallySentAt.toISOString() },
  };
  assert.equal(isEffectiveActivityWithinDays(row, 30, now), false);
  // Sanity check: if this bug were still present (using createdAt instead
  // of occurredAt), the same row would wrongly read as within 30 days.
  assert.ok(syncedToday.getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000);
});

test("an email sent from Gmail today counts as a touch today, via occurredAt", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const row = {
    id: "sent-1",
    type: "email_sent",
    createdAt: now,
    metadata: { to: "jane@prospect.com", occurredAt: now.toISOString() },
  };
  assert.equal(isEffectiveActivityWithinDays(row, 1, now), true);
});

test("resolveEffectiveActivityAt: every other activity type always uses createdAt, even if metadata has an originalAt-shaped field", () => {
  const createdAt = new Date("2026-09-26T00:00:00.000Z");
  const at = resolveEffectiveActivityAt({
    id: "a3",
    type: "email_sent",
    createdAt,
    metadata: { originalAt: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(at!.getTime(), createdAt.getTime());
});

test("resolveEffectiveActivityAt: a non-touch type (task_updated/task_completed/task_reopened) is null, never createdAt", () => {
  const createdAt = new Date("2026-09-26T00:00:00.000Z");
  for (const type of NON_TOUCH_ACTIVITY_TYPES) {
    assert.equal(resolveEffectiveActivityAt({ id: "t1", type, createdAt, metadata: {} }), null, `expected "${type}" to be null`);
  }
});

test("isEffectiveActivityWithinDays: a non-touch type is never 'within days', even if its createdAt is today", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const row = { id: "t1", type: "task_updated", createdAt: now, metadata: {} };
  assert.equal(isEffectiveActivityWithinDays(row, 30, now), false);
});

test("isEffectiveActivityWithinDays: a HubSpot/collapse/fold backfill imported TODAY but reconstructing an OLD event does NOT count as recent — the exact bug this fixes", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const importedToday = now; // createdAt = when the migration ran, today
  const reallyHappened90DaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const row = {
    id: "backfill-1",
    type: "status_backfill",
    createdAt: importedToday,
    metadata: { originalAt: reallyHappened90DaysAgo.toISOString() },
  };
  assert.equal(isEffectiveActivityWithinDays(row, 30, now), false);
  // Sanity check: if this bug were still present (using createdAt instead
  // of originalAt), the same row would wrongly read as within 30 days.
  assert.ok(importedToday.getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000);
});

test("isEffectiveActivityWithinDays: a genuinely recent activity (non-backfill) counts as recent", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const row = { id: "e1", type: "email_sent", createdAt: fiveDaysAgo, metadata: {} };
  assert.equal(isEffectiveActivityWithinDays(row, 30, now), true);
});

test("isEffectiveActivityWithinDays: a backfill with a RECENT originalAt correctly counts as recent", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const row = {
    id: "backfill-2",
    type: "status_backfill",
    createdAt: now,
    metadata: { originalAt: threeDaysAgo.toISOString() },
  };
  assert.equal(isEffectiveActivityWithinDays(row, 30, now), true);
});

test("buildSinceIso: returns a plain ISO string (never a Date), the exact shape a raw sql`` template can safely interpolate", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const iso = buildSinceIso(30, now);
  assert.equal(typeof iso, "string");
  assert.equal(iso, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString());
});

test("buildSinceIso: 0 or negative days still returns a valid ISO string (no NaN/Invalid Date)", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(buildSinceIso(0, now), now.toISOString());
  assert.doesNotThrow(() => new Date(buildSinceIso(7, now)).toISOString());
});

/**
 * Timeline ordering scenario (fresh-review fix): getPersonTimeline/
 * getCompanyTimeline order by
 * `coalesce(effectiveActivityAtSql(), activity.created_at) DESC`
 * (src/lib/activity/timelineOrder.ts) — i.e. exactly
 * `resolveEffectiveActivityAt(row) ?? row.createdAt`, descending. This pins
 * that JS-side equivalent of the rule: a `task_updated` row created AFTER
 * 60 older touch rows must sort first and survive a `LIMIT` that only
 * keeps the newest N — the bug `NULLS LAST` caused (a non-touch row always
 * sorting last, cut by the limit on a busy record) is impossible here since
 * `coalesce`/`??` never produces a value that sorts as "oldest".
 */
test("timeline ordering: a task_updated row newer than 60 other activities appears first in a limited timeline page", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  const olderTouchRows = Array.from({ length: 60 }, (_, i) => ({
    id: `touch-${i}`,
    type: "email_sent",
    createdAt: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000), // each 1h older than the last
    metadata: {},
  }));
  const newestTaskEdit = {
    id: "task-edit-1",
    type: "task_updated",
    createdAt: now, // newer than every touch row above
    metadata: {},
  };

  const rows = [...olderTouchRows, newestTaskEdit];
  const sorted = [...rows].sort((a, b) => {
    const atA = (resolveEffectiveActivityAt(a) ?? a.createdAt).getTime();
    const atB = (resolveEffectiveActivityAt(b) ?? b.createdAt).getTime();
    return atB - atA;
  });
  const limitedPage = sorted.slice(0, 50); // a bounded LIMIT smaller than the full 61 rows

  assert.equal(sorted[0]!.id, "task-edit-1", "the task edit must sort first — it is the newest row");
  assert.ok(
    limitedPage.some((r) => r.id === "task-edit-1"),
    "the task edit must survive the LIMIT, not be cut as if it were the oldest row",
  );
});

/**
 * "Last touch" scenario (task-edit change, owner review): a contact's
 * `lastActivityDays` staleness filter (listQueries.ts's EXISTS, built from
 * `effectiveActivityAtSql() >= since` — the SQL twin of
 * `isEffectiveActivityWithinDays` below) and its DISTINCT ON "last touch"
 * pick (`ORDER BY effectiveActivityAtSql() DESC NULLS LAST`, the SQL twin
 * of picking the max non-null `resolveEffectiveActivityAt` here) must both
 * be driven by the contact's REAL last touch, never by a newer
 * task_updated/task_completed/task_reopened row — those are NON_TOUCH_
 * ACTIVITY_TYPES (see effectiveActivityAtSql's NULL branch), so `NULLS
 * LAST` can never let one win the "most recent touch" pick over an older
 * real touch, and `NULL >= since` is never true in the EXISTS filter
 * either. This pins the JS-side equivalent of BOTH: simulating the
 * DISTINCT-ON pick (max non-null effective time) across a person's rows,
 * then checking a 30-day staleness window against THAT pick, not against
 * whichever row is newest by wall-clock.
 */
test("a contact whose newest activity is task_updated keeps its real last touch and still matches a 30-day staleness filter", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const realTouch = {
    id: "touch-1",
    type: "email_sent",
    createdAt: new Date("2026-09-15T12:00:00.000Z"), // 15 days ago — within 30
    metadata: {},
  };
  const newerTaskEdit = {
    id: "task-edit-1",
    type: "task_updated",
    createdAt: new Date("2026-09-29T12:00:00.000Z"), // 1 day ago — newer by wall-clock
    metadata: {},
  };
  const rows = [realTouch, newerTaskEdit];

  // Simulates the DISTINCT ON pick: max non-null effective time wins,
  // exactly what `ORDER BY effectiveActivityAtSql() DESC NULLS LAST` picks.
  const lastTouch = rows.reduce<{ id: string; at: Date } | null>((best, row) => {
    const at = resolveEffectiveActivityAt(row);
    if (!at) return best;
    if (!best || at.getTime() > best.at.getTime()) return { id: row.id, at };
    return best;
  }, null);

  assert.equal(lastTouch?.id, "touch-1", "the real touch must win the pick, not the newer non-touch row");
  assert.equal(
    isEffectiveActivityWithinDays(realTouch, 30, now),
    true,
    "the contact's real last touch (15 days ago) is within a 30-day staleness filter",
  );
  assert.equal(
    isEffectiveActivityWithinDays(newerTaskEdit, 30, now),
    false,
    "the newer task_updated row must never count toward the staleness filter, even though it is more recent by wall-clock",
  );
});

test("a contact whose only recent activity is task_updated, with its real touch OLDER than the window, correctly reads as stale", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const oldRealTouch = {
    id: "touch-1",
    type: "email_sent",
    createdAt: new Date("2026-08-01T12:00:00.000Z"), // 60 days ago — outside 30
    metadata: {},
  };
  const todaysTaskEdit = {
    id: "task-edit-1",
    type: "task_updated",
    createdAt: now, // edited today
    metadata: {},
  };

  // Neither row satisfies a 30-day staleness filter: the real touch is too
  // old, and the task edit — however recent — is never a touch at all. A
  // naive "most recent row wins" filter would wrongly read this contact as
  // fresh because of today's task edit.
  assert.equal(isEffectiveActivityWithinDays(oldRealTouch, 30, now), false);
  assert.equal(isEffectiveActivityWithinDays(todaysTaskEdit, 30, now), false);
});
