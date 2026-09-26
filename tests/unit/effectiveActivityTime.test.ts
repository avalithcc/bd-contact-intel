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
import {
  isEffectiveActivityWithinDays,
  resolveEffectiveActivityAt,
} from "@/lib/contacts/effectiveActivityTime";

test("resolveEffectiveActivityAt: a status_backfill row with a valid metadata.originalAt uses that, not createdAt", () => {
  const originalAt = new Date("2026-06-01T00:00:00.000Z");
  const createdAt = new Date("2026-09-26T00:00:00.000Z"); // migration run date
  const at = resolveEffectiveActivityAt({
    id: "a1",
    type: "status_backfill",
    createdAt,
    metadata: { originalAt: originalAt.toISOString() },
  });
  assert.equal(at.getTime(), originalAt.getTime());
});

test("resolveEffectiveActivityAt: a status_backfill row with missing/unparseable originalAt falls back to createdAt", () => {
  const createdAt = new Date("2026-09-26T00:00:00.000Z");
  assert.equal(
    resolveEffectiveActivityAt({ id: "a1", type: "status_backfill", createdAt, metadata: {} }).getTime(),
    createdAt.getTime(),
  );
  assert.equal(
    resolveEffectiveActivityAt({
      id: "a2",
      type: "status_backfill",
      createdAt,
      metadata: { originalAt: "not-a-date" },
    }).getTime(),
    createdAt.getTime(),
  );
});

test("resolveEffectiveActivityAt: every other activity type always uses createdAt, even if metadata has an originalAt-shaped field", () => {
  const createdAt = new Date("2026-09-26T00:00:00.000Z");
  const at = resolveEffectiveActivityAt({
    id: "a3",
    type: "email_sent",
    createdAt,
    metadata: { originalAt: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(at.getTime(), createdAt.getTime());
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
