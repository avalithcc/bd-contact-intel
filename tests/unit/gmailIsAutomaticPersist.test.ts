// Task 10.1 + 10.4: the sync stores the detector's verdict on email_message.is_automatic, and
// everything that existed before (the reply_received activity, the status it derives) is unchanged.
// Fixtures come from the real producers (parseGmailMessage -> classifyGmailMessage). No DB, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { emailMessage, type NewEmailMessage } from "../../src/db/schema";
import { classifyGmailMessage, type KnownPersonEmail } from "../../src/lib/gmail/classify";
import { buildEmailMessageRow } from "../../src/lib/gmail/emailMessageRows";
import { parseGmailMessage, type GmailApiHeader } from "../../src/lib/gmail/parseMessage";
import { executeSyncedMessageWrite, type SyncWriteStore } from "../../src/lib/gmail/syncWriteCore";
import type { SyncedActivityRow } from "../../src/lib/gmail/buildSyncedActivities";

const BD_ID = "11111111-1111-4111-8111-111111111111";
const PERSON: KnownPersonEmail = { personId: "22222222-2222-4222-8222-222222222222", emailNormalized: "jane@prospect.com", confidence: "exact" };

function classifiedFrom(from: string, extra: GmailApiHeader[], gid = "g1") {
  const message = parseGmailMessage({
    id: gid,
    threadId: "t1",
    internalDate: String(Date.UTC(2026, 9, 10)),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: from }, { name: "To", value: "bd@avalith.net" }, { name: "Subject", value: "Re: hello" }, ...extra],
      body: { data: Buffer.from("hi").toString("base64url") },
    },
  });
  return classifyGmailMessage({ message, bdEmail: "bd@avalith.net", knownPersons: [PERSON], neverLogRules: [] });
}

const AUTO = [{ name: "Auto-Submitted", value: "auto-replied" }];

test("the stored row carries the detector's verdict: true for an auto-reply, false for a human and for our own mail", () => {
  assert.equal(buildEmailMessageRow(BD_ID, classifiedFrom("Jane <jane@prospect.com>", AUTO)).isAutomatic, true);
  assert.equal(buildEmailMessageRow(BD_ID, classifiedFrom("Jane <jane@prospect.com>", [])).isAutomatic, false);
  const outbound = classifyGmailMessage({
    message: parseGmailMessage({
      id: "g2", threadId: "t1", internalDate: String(Date.UTC(2026, 9, 10)),
      payload: { mimeType: "text/plain", headers: [{ name: "From", value: "bd@avalith.net" }, { name: "To", value: "jane@prospect.com" }, { name: "Subject", value: "hello" }] },
    }),
    bdEmail: "bd@avalith.net", knownPersons: [PERSON], neverLogRules: [],
  });
  assert.equal(buildEmailMessageRow(BD_ID, outbound).isAutomatic, false);
});

// Superseded on purpose (auto-reply-status change): the activity is now auto_reply_received, so it cannot move the stage.
// Address verification is unchanged: a message from the exact stored address still proves the mailbox exists.
test("an auto-reply from a known Contact writes auto_reply_received (not reply_received) and still verifies the address", async () => {
  const c = classifiedFrom("Jane <jane@prospect.com>", AUTO);
  const rows: NewEmailMessage[] = [];
  const activities: SyncedActivityRow[] = [];
  let verified = 0;
  const store: SyncWriteStore = {
    async insertMessages(r) { rows.push(...r); return r.map((x, i) => ({ id: `m${i}`, gmailMessageId: x.gmailMessageId, gmailThreadId: x.gmailThreadId, direction: x.direction, sentAt: x.sentAt })); },
    async fillRfcIds() { return 0; },
    async insertPersonLinks() {},
    async linkPlatformActivity() {},
    async insertActivities(_b, r) { activities.push(...r); },
    async verifyRepliedAddresses(c2) { verified += c2.length; },
  };
  await executeSyncedMessageWrite(store, BD_ID, [c]);
  assert.deepEqual(activities.map((a) => [a.personId, a.type]), [[PERSON.personId, "auto_reply_received"]]);
  assert.equal(verified, 1);
  assert.equal(rows[0]!.isAutomatic, true);
});

test("email_message.is_automatic is declared NOT NULL DEFAULT false", () => {
  const col = getTableConfig(emailMessage).columns.find((c) => c.name === "is_automatic");
  assert.ok(col, "column declared");
  assert.equal(col.notNull, true);
  assert.equal(col.default, false);
});

test("0044 is additive only: one ADD COLUMN IF NOT EXISTS, no backfill, no drop, no rewrite of existing rows", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "drizzle", "0044_email_message_is_automatic.sql"), "utf8");
  const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(statements[0]!, /^ALTER TABLE "email_message" ADD COLUMN IF NOT EXISTS "is_automatic" boolean DEFAULT false NOT NULL$/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(DROP|UPDATE|DELETE|TRUNCATE|CREATE|INSERT)\b/i);
});
