/**
 * Unit tests for src/lib/activity/timelineEntry.ts — pure per-row mapping
 * for the Contact record's timeline pane (bug fix, prod smoke test): a
 * HubSpot-imported `status_backfill` activity must sort and display by its
 * real historical time (`metadata.originalAt`), not `created_at` (when the
 * migration ran).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimelineEntry } from "@/lib/activity/timelineEntry";

test("a status_backfill row whose originalAt is 6 months ago exposes `at` = 6 months ago, not createdAt = today (the exact bug this fixes)", () => {
  const createdAt = new Date("2026-09-26T14:32:00.000Z"); // migration/import run date
  const originalAt = new Date("2026-03-26T00:00:00.000Z"); // 6 months earlier — the real event
  const entry = buildTimelineEntry(
    {
      id: "a1",
      type: "status_backfill",
      createdAt,
      actorBdId: null,
      actorName: null,
      metadata: { status: "contacted", originalAt: originalAt.toISOString() },
    },
    "viewer-1",
  );
  assert.equal(entry.at.getTime(), originalAt.getTime());
  assert.notEqual(entry.at.getTime(), createdAt.getTime());
  // createdAt is still exposed unchanged — callers that genuinely need the
  // import/write time (not the effective one) still have it.
  assert.equal(entry.createdAt.getTime(), createdAt.getTime());
});

test("every other activity type exposes `at` === createdAt (unchanged behavior)", () => {
  const createdAt = new Date("2026-09-26T14:32:00.000Z");
  const entry = buildTimelineEntry(
    { id: "a2", type: "email_sent", createdAt, actorBdId: null, actorName: null, metadata: {} },
    "viewer-1",
  );
  assert.equal(entry.at.getTime(), createdAt.getTime());
});

test("`at` is computed from the RAW metadata even for a locked (not-visible) entry — the date is never sensitive content", () => {
  // email_sent is the only conversation-content type (timelineVisibility.ts)
  // — another BD's email_sent is locked (metadata -> null), but its `at`
  // must still resolve, and for a non-backfill type `at` is always
  // createdAt regardless of metadata, so this also pins that redaction
  // never breaks `at`.
  const createdAt = new Date("2026-09-26T14:32:00.000Z");
  const entry = buildTimelineEntry(
    {
      id: "a3",
      type: "email_sent",
      createdAt,
      actorBdId: "other-bd",
      actorName: "Other BD",
      metadata: { subject: "secret" },
    },
    "viewer-1",
  );
  assert.equal(entry.visible, false);
  assert.equal(entry.metadata, null);
  assert.equal(entry.at.getTime(), createdAt.getTime());
});

test("a reply_received (synced Gmail reply) from another BD's mailbox is locked for a different viewer (email-sync brief follow-up review)", () => {
  const createdAt = new Date("2026-09-30T09:00:00.000Z");
  const occurredAt = new Date("2026-07-01T09:00:00.000Z");
  const entry = buildTimelineEntry(
    {
      id: "a5",
      type: "reply_received",
      createdAt,
      actorBdId: "other-bd",
      actorName: "Other BD",
      metadata: { subject: "Re: intro", from: "jane@prospect.com", occurredAt: occurredAt.toISOString() },
    },
    "viewer-1",
  );
  assert.equal(entry.visible, false);
  assert.equal(entry.metadata, null);
  // `at` still resolves from occurredAt even though metadata is redacted for
  // display (buildTimelineEntry computes it from the RAW row before
  // redaction) — the date itself is never sensitive content.
  assert.equal(entry.at.getTime(), occurredAt.getTime());
});

test("a reply_received synced into the viewer's OWN mailbox is visible, with subject/sender intact", () => {
  const createdAt = new Date("2026-09-30T09:00:00.000Z");
  const entry = buildTimelineEntry(
    {
      id: "a6",
      type: "reply_received",
      createdAt,
      actorBdId: "viewer-1",
      actorName: "Viewer",
      metadata: { subject: "Re: intro", from: "jane@prospect.com" },
    },
    "viewer-1",
  );
  assert.equal(entry.visible, true);
  assert.deepEqual(entry.metadata, { subject: "Re: intro", from: "jane@prospect.com" });
});

test("status_backfill is always visible (never a conversation-content type), so its metadata (and therefore `at`) is never redacted away", () => {
  const createdAt = new Date("2026-09-26T14:32:00.000Z");
  const originalAt = new Date("2026-03-26T00:00:00.000Z");
  const entry = buildTimelineEntry(
    {
      id: "a4",
      type: "status_backfill",
      createdAt,
      actorBdId: "other-bd",
      actorName: "Other BD",
      metadata: { status: "contacted", originalAt: originalAt.toISOString() },
    },
    "viewer-1",
  );
  assert.equal(entry.visible, true);
  assert.notEqual(entry.metadata, null);
  assert.equal(entry.at.getTime(), originalAt.getTime());
});
