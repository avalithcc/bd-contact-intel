/**
 * Unit test for the record page's discard-reason display (hubspot-import
 * spec "Discard evidence preserves the historical date" — "Record page
 * shows the discard reason for an imported row"): a `status_backfill`
 * activity with `status: 'discarded'` must display its `reason` the same
 * way a plain `discarded` activity does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { entryBody, type TimelineEntryForBody } from "@/lib/contacts/timelineEntryBody";

function labels(): ContactRecordLabels {
  return {
    timelineLockedContent: "locked",
    timelineEmailSentPrefix: "Email sent to",
    timelineHunterPrefix: "Hunter",
    timelineStatusChangedPrefix: "Status changed:",
    timelineStatusBackfillPrefix: "Status recorded before the migration:",
    timelineMeetingLoggedDefault: "Meeting logged",
    timelineDiscardedDefault: "Contact discarded.",
    leadStatuses: { new: "New", contacted: "Contacted", replied: "Replied", meeting: "Meeting", discarded: "Discarded" },
  } as unknown as ContactRecordLabels;
}

function entry(overrides: Partial<TimelineEntryForBody> = {}): TimelineEntryForBody {
  return {
    type: "status_backfill",
    metadata: {},
    visible: true,
    ...overrides,
  };
}

test("a plain 'discarded' activity shows its reason", () => {
  const body = entryBody(entry({ type: "discarded", metadata: { reason: "wrong_profile", note: null } }), labels());
  assert.equal(body, "wrong_profile");
});

test("a status_backfill activity with status 'discarded' ALSO shows its reason, same as a plain discarded activity", () => {
  const body = entryBody(
    entry({ type: "status_backfill", metadata: { status: "discarded", reason: "wrong_profile" } }),
    labels(),
  );
  assert.equal(body, "wrong_profile");
});

test("a status_backfill activity with a non-discarded status still shows the status label prefix, unaffected", () => {
  const body = entryBody(entry({ type: "status_backfill", metadata: { status: "contacted" } }), labels());
  assert.equal(body, "Status recorded before the migration: Contacted");
});

test("a status_backfill discarded with no reason falls back to the default discarded copy", () => {
  const body = entryBody(entry({ type: "status_backfill", metadata: { status: "discarded" } }), labels());
  assert.equal(body, "Contact discarded.");
});
