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
import { callWhatLabel, entryBody, type TimelineEntryForBody } from "@/lib/contacts/timelineEntryBody";

function labels(): ContactRecordLabels {
  return {
    timelineLockedContent: "locked",
    timelineEmailSentPrefix: "Email sent to",
    timelineHunterPrefix: "Hunter",
    timelineStatusChangedPrefix: "Status changed:",
    timelineStatusBackfillPrefix: "Status recorded before the migration:",
    timelineMeetingLoggedDefault: "Meeting logged",
    timelineDiscardedDefault: "Contact discarded.",
    timelineCallOutboundPrefix: "Outbound call",
    timelineCallInboundPrefix: "Inbound call",
    timelineCallDurationPrefix: "Duration:",
    timelineCallDefault: "Call logged.",
    callOutcomeConnected: "Connected",
    callOutcomeBusy: "Busy",
    callOutcomeNoAnswer: "No answer",
    callOutcomeVoicemail: "Left voicemail",
    callOutcomeWrongNumber: "Wrong number",
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

// --- call activity (migration 0016) -----------------------------------------

test("callWhatLabel composes direction + outcome (contact-record.html 'Llamada saliente · Conectado')", () => {
  assert.equal(callWhatLabel({ direction: "outbound", outcome: "connected" }, labels()), "Outbound call · Connected");
  assert.equal(callWhatLabel({ direction: "inbound", outcome: "no_answer" }, labels()), "Inbound call · No answer");
});

test("callWhatLabel falls back to just the direction when outcome is missing/unrecognized", () => {
  assert.equal(callWhatLabel({ direction: "outbound" }, labels()), "Outbound call");
  assert.equal(callWhatLabel({ direction: "outbound", outcome: "levitated" }, labels()), "Outbound call");
});

test("entryBody for 'call' renders duration and notes (contact-record.html 'Duración: 8 min. ...')", () => {
  const body = entryBody(
    entry({ type: "call", metadata: { durationMinutes: 8, notes: "Talked about Q1" } }),
    labels(),
  );
  assert.equal(body, "Duration: 8 min. Talked about Q1");
});

test("entryBody for 'call' with no duration/notes falls back to the default call-logged copy", () => {
  const body = entryBody(entry({ type: "call", metadata: {} }), labels());
  assert.equal(body, "Call logged.");
});
