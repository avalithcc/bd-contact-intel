/**
 * The sync fills a NULL `rfc_message_id` on a message the send path stored
 * without one (read-back failed), via a separate NULL-guarded statement — never
 * `ON CONFLICT DO UPDATE`, which would make the insert RETURN the row and
 * duplicate the activity and link rows. The fake store below models the
 * unique key, `DO NOTHING` returning nothing on conflict, and the NULL guard.
 * Fixtures come from the real producers. No network, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGmailMessage, type ClassifiedMessage, type KnownPersonEmail } from "@/lib/gmail/classify";
import { parseGmailMessage } from "@/lib/gmail/parseMessage";
import { plainTextPart, type MessageContent } from "@/lib/gmail/rawMessage";
import { classifySentMessage } from "@/lib/gmail/sentMessage";
import { storeSentEmailMessage, type SentEmailStore } from "@/lib/gmail/storeSentEmail";
import { executeSyncedMessageWrite, planRfcFills, type SyncWriteStore } from "@/lib/gmail/syncWriteCore";
import type { NewEmailMessage, NewEmailMessagePerson } from "@/db/schema";

const BD_ID = "11111111-1111-4111-8111-111111111111";
const BD_EMAIL = "mariel@avalith.net";
const PERSON: KnownPersonEmail = { personId: "22222222-2222-4222-8222-222222222222", emailNormalized: "jane@prospect.com", confidence: "exact" };
const SENT_AT = new Date("2026-10-02T13:50:31.000Z");
const CONTENT: MessageContent = { body: "Hola Jane" };

function fakeDb() {
  const messages = new Map<string, { id: string; row: NewEmailMessage }>();
  const links: NewEmailMessagePerson[] = [];
  const activities: unknown[] = [];
  let seq = 0;
  const sent: SentEmailStore = {
    async insertMessage(row) {
      const key = `${row.bdId}|${row.gmailMessageId}`;
      if (messages.has(key)) return null;
      const id = `msg-${++seq}`;
      messages.set(key, { id, row: { ...row } });
      return id;
    },
    async findMessageId(bdId, gid) {
      return messages.get(`${bdId}|${gid}`)!.id;
    },
    async insertPersonLinks(rows) {
      links.push(...rows);
    },
  };
  const sync: SyncWriteStore = {
    async insertMessages(rows) {
      const out = [];
      for (const row of rows) {
        const id = await sent.insertMessage(row);
        if (id) out.push({ id, gmailMessageId: row.gmailMessageId, gmailThreadId: row.gmailThreadId, direction: row.direction, sentAt: row.sentAt });
      }
      return out;
    },
    async fillRfcIds(bdId, fills) {
      let changed = 0;
      for (const f of fills) {
        const m = messages.get(`${bdId}|${f.gmailMessageId}`);
        if (m && m.row.rfcMessageId == null) {
          m.row.rfcMessageId = f.rfcMessageId;
          m.row.rfcReferences = f.rfcReferences;
          changed++;
        }
      }
      return changed;
    },
    async insertPersonLinks(rows) {
      links.push(...rows);
    },
    async linkPlatformActivity() {},
    async insertActivities(_bdId, rows) {
      activities.push(...rows);
    },
  };
  return { messages, links, activities, sent, sync };
}

function sentWithoutReadback(): ClassifiedMessage {
  return classifySentMessage({
    bdEmail: BD_EMAIL, to: "jane@prospect.com", subject: "Prueba", content: CONTENT,
    gmailMessageId: "gm-1", gmailThreadId: "gt-1", metadata: null, now: SENT_AT,
    knownPersons: [PERSON], neverLogRules: [],
  });
}

function syncSees(rfc: string | null, platformSent = true): ClassifiedMessage {
  const headers = [
    { name: "From", value: BD_EMAIL },
    { name: "To", value: "jane@prospect.com" },
    { name: "Subject", value: "Prueba" },
    ...(rfc ? [{ name: "Message-ID", value: rfc }] : []),
  ];
  const parsed = parseGmailMessage({
    id: "gm-1", threadId: "gt-1", internalDate: String(SENT_AT.getTime()),
    payload: { mimeType: "text/plain", headers, body: { data: Buffer.from(plainTextPart(CONTENT)).toString("base64url") } },
  });
  return classifyGmailMessage({
    message: parsed, bdEmail: BD_EMAIL, knownPersons: [PERSON], neverLogRules: [],
    platformSentGmailMessageIds: platformSent ? new Set(["gm-1"]) : new Set(),
  });
}

const row = (db: ReturnType<typeof fakeDb>) => db.messages.get(`${BD_ID}|gm-1`)!.row;

test("send without a Message-ID, then a sync that has it: the row is filled, no second activity, no duplicate links", async () => {
  const db = fakeDb();
  await storeSentEmailMessage(db.sent, BD_ID, sentWithoutReadback());
  assert.equal(row(db).rfcMessageId, null);
  const linksBefore = db.links.length;

  const result = await executeSyncedMessageWrite(db.sync, BD_ID, [syncSees("<abc@mail.gmail.com>")]);

  assert.equal(result.inserted, 0);
  assert.equal(row(db).rfcMessageId, "<abc@mail.gmail.com>");
  assert.equal(db.messages.size, 1);
  assert.equal(db.links.length, linksBefore);
  assert.equal(db.activities.length, 0);
});

test("the same sequence run twice: the second sync changes nothing", async () => {
  const db = fakeDb();
  await storeSentEmailMessage(db.sent, BD_ID, sentWithoutReadback());
  await executeSyncedMessageWrite(db.sync, BD_ID, [syncSees("<abc@x>")]);
  const after = structuredClone(row(db));
  const linksAfter = db.links.length;
  await executeSyncedMessageWrite(db.sync, BD_ID, [syncSees("<abc@x>")]);
  assert.deepEqual(row(db), after);
  assert.equal(db.links.length, linksAfter);
  assert.equal(db.activities.length, 0);
});

test("a row that already has an rfc_message_id is never overwritten by a later sync", async () => {
  const db = fakeDb();
  const withRfc = classifySentMessage({
    bdEmail: BD_EMAIL, to: "jane@prospect.com", subject: "Prueba", content: CONTENT,
    gmailMessageId: "gm-1", gmailThreadId: "gt-1",
    metadata: { rfcMessageId: "<original@x>", references: "<r@x>", sentAt: SENT_AT }, now: SENT_AT,
    knownPersons: [PERSON], neverLogRules: [],
  });
  await storeSentEmailMessage(db.sent, BD_ID, withRfc);
  await executeSyncedMessageWrite(db.sync, BD_ID, [syncSees("<different@x>")]);
  assert.equal(row(db).rfcMessageId, "<original@x>");
  assert.equal(row(db).rfcReferences, "<r@x>");
});

test("a sync message without a Message-ID fills nothing", async () => {
  const db = fakeDb();
  await storeSentEmailMessage(db.sent, BD_ID, sentWithoutReadback());
  await executeSyncedMessageWrite(db.sync, BD_ID, [syncSees(null)]);
  assert.equal(row(db).rfcMessageId, null);
});

test("a genuinely new message still gets its links and activity from the sync (insert path unchanged)", async () => {
  const db = fakeDb();
  const result = await executeSyncedMessageWrite(db.sync, BD_ID, [syncSees("<n@x>", false)]);
  assert.equal(result.inserted, 1);
  assert.equal(db.links.length, 1);
  assert.equal(db.activities.length, 1);
  assert.equal(row(db).rfcMessageId, "<n@x>");
});

test("planRfcFills keeps only messages with a Message-ID, deduplicates, and never mutates its input", () => {
  const a = syncSees("<a@x>");
  const b = syncSees(null);
  const input = Object.freeze([a, b, a]);
  const first = planRfcFills(input);
  assert.deepEqual(first, planRfcFills(input));
  assert.deepEqual(first, [{ gmailMessageId: "gm-1", rfcMessageId: "<a@x>", rfcReferences: null }]);
});
