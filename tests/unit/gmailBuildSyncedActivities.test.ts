/**
 * Unit tests for src/lib/gmail/buildSyncedActivities.ts — the pure planner
 * that turns one classified, newly-inserted email_message into the activity
 * row(s) to write (fresh-review design change, 2026-09-30: one activity per
 * synced message per matched person, dated by the message via
 * metadata.occurredAt).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSyncedActivityRows,
  syncedActivityIdempotencyKey,
  type BuildSyncedActivityRowsInput,
} from "@/lib/gmail/buildSyncedActivities";
import { classifyGmailMessage, type KnownPersonEmail } from "@/lib/gmail/classify";
import { parseGmailMessage, type GmailApiMessage } from "@/lib/gmail/parseMessage";

const BD_EMAIL = "cristian@avalith.net";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fixtureMessage(overrides: Partial<GmailApiMessage> = {}): GmailApiMessage {
  return {
    id: "msg-automated-1",
    threadId: "thread-automated-1",
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: "sistemas@decreditos.com" },
        { name: "To", value: "operaciones@decreditos.com" },
        { name: "Cc", value: "rcrescentini@decreditos.com" },
        { name: "Subject", value: "Transferencia exitosa" },
      ],
      mimeType: "text/plain",
      body: { data: b64url("Comprobante adjunto.") },
    },
    ...overrides,
  };
}

function baseInput(overrides: Partial<BuildSyncedActivityRowsInput> = {}): BuildSyncedActivityRowsInput {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    direction: "inbound",
    fromAddress: "jane@prospect.com",
    toAddresses: ["cristian@avalith.net"],
    subject: "Re: intro",
    sentAt: new Date("2026-07-01T12:00:00.000Z"),
    isPlatformSent: false,
    matches: [{ personId: "person-1", matchedEmail: "jane@prospect.com", matchConfidence: "exact" }],
    ...overrides,
  };
}

test("inbound message builds a reply_received row with the sender address and occurredAt", () => {
  const [row] = buildSyncedActivityRows(baseInput());
  assert.equal(row?.type, "reply_received");
  assert.equal(row?.personId, "person-1");
  assert.equal(row?.metadata.from, "jane@prospect.com");
  assert.equal(row?.metadata.to, undefined);
  assert.equal(row?.metadata.occurredAt, "2026-07-01T12:00:00.000Z");
  assert.equal(row?.metadata.source, "gmail_sync");
  assert.equal(row?.metadata.subject, "Re: intro");
  assert.equal(row?.metadata.gmailMessageId, "msg-1");
  assert.equal(row?.metadata.gmailThreadId, "thread-1");
});

test("outbound message (not platform-sent) builds an email_sent row with the recipient addresses", () => {
  const [row] = buildSyncedActivityRows(
    baseInput({ direction: "outbound", fromAddress: "cristian@avalith.net", toAddresses: ["jane@prospect.com"] }),
  );
  assert.equal(row?.type, "email_sent");
  assert.deepEqual(row?.metadata.to, ["jane@prospect.com"]);
  assert.equal(row?.metadata.from, undefined);
});

test("a platform-sent outbound message produces no activity rows (already linked to the existing email_sent activity)", () => {
  const rows = buildSyncedActivityRows(baseInput({ direction: "outbound", isPlatformSent: true }));
  assert.deepEqual(rows, []);
});

test("a message matching two persons produces one row per person", () => {
  const rows = buildSyncedActivityRows(
    baseInput({
      matches: [
        { personId: "person-1", matchedEmail: "jane@prospect.com", matchConfidence: "exact" },
        { personId: "person-2", matchedEmail: "bob@prospect.com", matchConfidence: "inferred" },
      ],
    }),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.personId),
    ["person-1", "person-2"],
  );
  assert.equal(rows[1]?.metadata.matchConfidence, "inferred");
});

test("idempotency keys are unique per (person, gmailMessageId) even for the same message", () => {
  const rows = buildSyncedActivityRows(
    baseInput({
      matches: [
        { personId: "person-1", matchedEmail: "jane@prospect.com", matchConfidence: "exact" },
        { personId: "person-2", matchedEmail: "bob@prospect.com", matchConfidence: "exact" },
      ],
    }),
  );
  const keys = rows.map(syncedActivityIdempotencyKey);
  assert.deepEqual(keys, ["person-1:msg-1", "person-2:msg-1"]);
  assert.equal(new Set(keys).size, keys.length);
});

test("regression (2026-09-30 misattributed inbound sender match): a CRM contact only in To/Cc of an automated inbound message gets no reply_received activity", () => {
  const knownPersons: KnownPersonEmail[] = [
    { personId: "person-rc", emailNormalized: "rcrescentini@decreditos.com", confidence: "exact" },
  ];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons,
    neverLogRules: [],
  });
  assert.equal(classified.direction, "inbound");
  assert.deepEqual(classified.matches, []);

  const rows = buildSyncedActivityRows({
    gmailMessageId: classified.gmailMessageId,
    gmailThreadId: classified.gmailThreadId,
    direction: classified.direction,
    fromAddress: classified.fromAddress,
    toAddresses: classified.toAddresses,
    subject: classified.subject,
    sentAt: classified.sentAt,
    isPlatformSent: classified.isPlatformSent,
    matches: classified.matches,
  });
  assert.deepEqual(rows, []);
});

test("inbound from a CRM contact with another CRM contact in cc: only the sender gets a reply_received row", () => {
  const knownPersons: KnownPersonEmail[] = [
    { personId: "person-sender", emailNormalized: "sistemas@decreditos.com", confidence: "exact" },
    { personId: "person-rc", emailNormalized: "rcrescentini@decreditos.com", confidence: "exact" },
  ];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons,
    neverLogRules: [],
  });
  assert.equal(classified.direction, "inbound");
  assert.deepEqual(classified.matches, [
    { personId: "person-sender", matchedEmail: "sistemas@decreditos.com", matchConfidence: "exact" },
  ]);

  const rows = buildSyncedActivityRows({
    gmailMessageId: classified.gmailMessageId,
    gmailThreadId: classified.gmailThreadId,
    direction: classified.direction,
    fromAddress: classified.fromAddress,
    toAddresses: classified.toAddresses,
    subject: classified.subject,
    sentAt: classified.sentAt,
    isPlatformSent: classified.isPlatformSent,
    matches: classified.matches,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, "reply_received");
  assert.equal(rows[0]?.personId, "person-sender");
});

test("is a pure planner: calling it twice with the same input yields deepEqual results and never mutates the input", () => {
  const input = baseInput();
  const matchesBefore = JSON.parse(JSON.stringify(input.matches));

  const first = buildSyncedActivityRows(input);
  const second = buildSyncedActivityRows(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input.matches, matchesBefore);
});
