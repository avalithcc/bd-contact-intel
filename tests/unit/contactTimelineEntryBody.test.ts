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
    timelineReplyReceivedDefault: "Reply received.",
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
    actorName: null,
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

// --- email_sent: metadata.to as a string (manually composed) vs. an array
// (synced thread message — buildSyncedActivities.ts's SyncedActivityMetadata
// always writes `to` as string[]) ------------------------------------------

test("entryBody for 'email_sent' with metadata.to as a plain string (manually composed send)", () => {
  const body = entryBody(entry({ type: "email_sent", metadata: { to: "jane@prospect.com" } }), labels());
  assert.equal(body, "Email sent to jane@prospect.com");
});

test("entryBody for 'email_sent' with metadata.to as a string[] (synced thread message) joins every address", () => {
  const body = entryBody(
    entry({ type: "email_sent", metadata: { to: ["jane@prospect.com", "john@prospect.com"] } }),
    labels(),
  );
  assert.equal(body, "Email sent to jane@prospect.com, john@prospect.com");
});

// The owner sent the first real email through the CRM (2026-10-01) and the
// timeline showed only "Correo enviado a <address>" — no subject — while a
// RECEIVED email already showed one. `send.ts` had always written
// `metadata.subject`; it just was not rendered.

test("entryBody for 'email_sent' appends the subject after the recipient", () => {
  const body = entryBody(
    entry({ type: "email_sent", metadata: { to: "jane@prospect.com", subject: "Propuesta Q4" } }),
    labels(),
  );
  assert.equal(body, "Email sent to jane@prospect.com · Propuesta Q4");
});

test("entryBody for 'email_sent' omits the separator when there is no subject", () => {
  const body = entryBody(entry({ type: "email_sent", metadata: { to: "jane@prospect.com" } }), labels());
  assert.equal(body, "Email sent to jane@prospect.com");
});

test("entryBody for 'email_sent' treats an empty-string subject as absent", () => {
  const body = entryBody(
    entry({ type: "email_sent", metadata: { to: "jane@prospect.com", subject: "" } }),
    labels(),
  );
  assert.equal(body, "Email sent to jane@prospect.com");
});

test("entryBody for 'email_sent' renders the subject even with no recipient at all", () => {
  const body = entryBody(entry({ type: "email_sent", metadata: { subject: "Propuesta Q4" } }), labels());
  assert.equal(body, "Email sent to · Propuesta Q4");
});

test("entryBody for 'email_sent' with a single-address array still renders that one address", () => {
  const body = entryBody(entry({ type: "email_sent", metadata: { to: ["jane@prospect.com"] } }), labels());
  assert.equal(body, "Email sent to jane@prospect.com");
});

test("entryBody for 'email_sent' with no usable recipient falls back to the bare prefix", () => {
  assert.equal(entryBody(entry({ type: "email_sent", metadata: {} }), labels()), "Email sent to");
  assert.equal(entryBody(entry({ type: "email_sent", metadata: { to: [] } }), labels()), "Email sent to");
});

// --- reply_received (email-sync brief follow-up review) --------------------

test("entryBody for 'reply_received' shows subject and sender address, same layout email_sent uses", () => {
  const body = entryBody(
    entry({ type: "reply_received", metadata: { subject: "Re: intro", from: "jane@prospect.com" } }),
    labels(),
  );
  assert.equal(body, "Re: intro · jane@prospect.com");
});

test("entryBody for 'reply_received' with only a sender (no subject) shows just the sender", () => {
  const body = entryBody(entry({ type: "reply_received", metadata: { from: "jane@prospect.com" } }), labels());
  assert.equal(body, "jane@prospect.com");
});

test("entryBody for 'reply_received' with neither subject nor sender falls back to the default copy", () => {
  const body = entryBody(entry({ type: "reply_received", metadata: {} }), labels());
  assert.equal(body, "Reply received.");
});

test("entryBody for 'reply_received' shows the locked marker when the entry is not visible to this viewer (privacy)", () => {
  const body = entryBody(
    entry({ type: "reply_received", visible: false, metadata: null }),
    labels(),
  );
  assert.equal(body, "locked");
});
