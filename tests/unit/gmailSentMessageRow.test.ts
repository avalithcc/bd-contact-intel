/**
 * The send path writes its own `email_message` row (instant-sent-mail). The
 * contract: a row written at send time is indistinguishable from the row the
 * Gmail sync writes for the same message. Fixtures here come from the real
 * producers (buildRawMessage's plain-text part, parseGmailMessage,
 * classifyGmailMessage) — never hand-built row shapes. No network, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGmailMessage, type KnownPersonEmail } from "@/lib/gmail/classify";
import { parseGmailMessage, type GmailApiMessage } from "@/lib/gmail/parseMessage";
import { plainTextPart, type MessageContent } from "@/lib/gmail/rawMessage";
import { MAX_BODY_TEXT_BYTES } from "@/lib/gmail/truncateBodyText";
import { buildEmailMessagePersonRows, buildEmailMessageRow } from "@/lib/gmail/emailMessageRows";
import { buildSentParsedMessage, classifySentMessage } from "@/lib/gmail/sentMessage";
import {
  storeSentEmailMessage,
  type SentEmailStore,
} from "@/lib/gmail/storeSentEmail";
import type { NewEmailMessage, NewEmailMessagePerson } from "@/db/schema";

const BD_ID = "11111111-1111-4111-8111-111111111111";
const BD_EMAIL = "Mariel@Avalith.net";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const PERSON: KnownPersonEmail = { personId: PERSON_ID, emailNormalized: "jane@prospect.com", confidence: "exact" };
const SENT_AT = new Date("2026-10-02T13:50:31.000Z");

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** What Gmail returns (format=full) for a message this app sent: the text/plain part is exactly what buildRawMessage encoded. */
function gmailEchoOf(content: MessageContent, extra: { rfc?: string; refs?: string } = {}): GmailApiMessage {
  const headers = [
    { name: "From", value: BD_EMAIL },
    { name: "To", value: "Jane Prospect <jane@prospect.com>" },
    { name: "Subject", value: "Prueba" },
    ...(extra.rfc ? [{ name: "Message-ID", value: extra.rfc }] : []),
    ...(extra.refs ? [{ name: "References", value: extra.refs }] : []),
  ];
  return {
    id: "gm-1",
    threadId: "gt-1",
    internalDate: String(SENT_AT.getTime()),
    payload: { mimeType: "text/plain", headers, body: { data: b64url(plainTextPart(content)) } },
  };
}

function sentClassified(content: MessageContent, meta: { rfcMessageId: string | null; references: string | null; sentAt: Date } | null) {
  return classifySentMessage({
    bdEmail: BD_EMAIL,
    to: "Jane Prospect <jane@prospect.com>",
    subject: "Prueba",
    content,
    gmailMessageId: "gm-1",
    gmailThreadId: "gt-1",
    metadata: meta,
    now: SENT_AT,
    knownPersons: [PERSON],
    neverLogRules: [],
  });
}

function syncClassified(content: MessageContent, extra: { rfc?: string; refs?: string } = {}) {
  return classifyGmailMessage({
    message: parseGmailMessage(gmailEchoOf(content, extra)),
    bdEmail: BD_EMAIL,
    knownPersons: [PERSON],
    neverLogRules: [],
    platformSentGmailMessageIds: new Set(["gm-1"]),
  });
}

test("send-path row is field-for-field identical to the sync row (plain text)", () => {
  const content: MessageContent = { body: "Hola Jane,\nPrueba de correo.\n\nSaludos" };
  const rfc = "<CA+abc@mail.gmail.com>";
  const fromSend = buildEmailMessageRow(BD_ID, sentClassified(content, { rfcMessageId: rfc, references: null, sentAt: SENT_AT }));
  const fromSync = buildEmailMessageRow(BD_ID, syncClassified(content, { rfc }));
  assert.deepEqual(fromSend, fromSync);
  assert.equal(fromSend.direction, "outbound");
  assert.equal(fromSend.fromAddress, "mariel@avalith.net");
  assert.deepEqual(fromSend.toAddresses, ["jane@prospect.com"]);
  assert.equal(fromSend.matchedEmail, "jane@prospect.com");
});

test("send-path row matches the sync row for an HTML (signature) message: body is the text/plain alternative", () => {
  const content: MessageContent = { bodyHtml: "<div>Hola<br>Jane</div><br><div><b>Mariel</b></div>" };
  const fromSend = buildEmailMessageRow(BD_ID, sentClassified(content, { rfcMessageId: null, references: null, sentAt: SENT_AT }));
  const fromSync = buildEmailMessageRow(BD_ID, syncClassified(content));
  assert.deepEqual(fromSend, fromSync);
  assert.ok(!String(fromSend.bodyText).includes("<div>"));
});

test("truncation agrees between the two writers", () => {
  const content: MessageContent = { body: "x".repeat(MAX_BODY_TEXT_BYTES + 500) };
  const fromSend = buildEmailMessageRow(BD_ID, sentClassified(content, null));
  const fromSync = buildEmailMessageRow(BD_ID, syncClassified(content));
  assert.equal(fromSend.bodyTruncated, true);
  assert.equal(fromSend.bodyText, fromSync.bodyText);
  assert.equal(fromSend.bodyTruncated, fromSync.bodyTruncated);
});

test("a failed Message-ID read-back is tolerated: null rfc columns, sentAt falls back to now", () => {
  const row = buildEmailMessageRow(BD_ID, sentClassified({ body: "hi" }, null));
  assert.equal(row.rfcMessageId, null);
  assert.equal(row.rfcReferences, null);
  assert.deepEqual(row.sentAt, SENT_AT);
});

test("read-back metadata fills rfc_message_id, rfc_references and the real sentAt", () => {
  const real = new Date("2026-10-02T13:50:32.000Z");
  const row = buildEmailMessageRow(
    BD_ID,
    sentClassified({ body: "hi" }, { rfcMessageId: "<a@x>", references: "<r1@x> <a@x>", sentAt: real }),
  );
  assert.equal(row.rfcMessageId, "<a@x>");
  assert.equal(row.rfcReferences, "<r1@x> <a@x>");
  assert.deepEqual(row.sentAt, real);
});

test("an empty body is stored as null, like the sync does for an empty text/plain part", () => {
  const fromSend = buildEmailMessageRow(BD_ID, sentClassified({ body: "" }, null));
  assert.equal(fromSend.bodyText, null);
  assert.equal(fromSend.bodyTruncated, false);
});

test("never-log and unmatched recipients produce no matches, so nothing is stored", () => {
  const blocked = classifySentMessage({
    bdEmail: BD_EMAIL, to: "jane@prospect.com", subject: "s", content: { body: "b" },
    gmailMessageId: "gm-1", gmailThreadId: "gt-1", metadata: null, now: SENT_AT,
    knownPersons: [PERSON], neverLogRules: [{ kind: "domain", value: "prospect.com" }],
  });
  assert.equal(blocked.matches.length, 0);
  const unknown = classifySentMessage({
    bdEmail: BD_EMAIL, to: "nobody@else.com", subject: "s", content: { body: "b" },
    gmailMessageId: "gm-1", gmailThreadId: "gt-1", metadata: null, now: SENT_AT,
    knownPersons: [PERSON], neverLogRules: [],
  });
  assert.equal(unknown.matches.length, 0);
});

test("link rows: one email_message_person per match, with the message id", () => {
  const two: KnownPersonEmail = { personId: "33333333-3333-4333-8333-333333333333", emailNormalized: "bob@prospect.com", confidence: "inferred" };
  const classified = classifySentMessage({
    bdEmail: BD_EMAIL, to: "jane@prospect.com, bob@prospect.com", subject: "s", content: { body: "b" },
    gmailMessageId: "gm-1", gmailThreadId: "gt-1", metadata: null, now: SENT_AT,
    knownPersons: [PERSON, two], neverLogRules: [],
  });
  const links = buildEmailMessagePersonRows("msg-uuid", classified.matches);
  assert.deepEqual(links, [
    { emailMessageId: "msg-uuid", personId: PERSON_ID, matchedEmail: "jane@prospect.com", matchConfidence: "exact" },
    { emailMessageId: "msg-uuid", personId: two.personId, matchedEmail: "bob@prospect.com", matchConfidence: "inferred" },
  ]);
  assert.equal(buildEmailMessageRow(BD_ID, classified).personId, PERSON_ID);
});

test("pure builders never mutate their inputs: two calls with the same input agree", () => {
  const input = {
    bdEmail: BD_EMAIL, to: "jane@prospect.com", subject: "Prueba", content: { body: "a\nb" } as MessageContent,
    gmailMessageId: "gm-1", gmailThreadId: "gt-1", metadata: { rfcMessageId: "<a@x>", references: null, sentAt: SENT_AT },
    now: SENT_AT,
  };
  const frozen = Object.freeze({ ...input, content: Object.freeze({ ...input.content }) });
  assert.deepEqual(buildSentParsedMessage(frozen), buildSentParsedMessage(frozen));
  const classified = sentClassified({ body: "hi" }, null);
  const snapshot = structuredClone(classified);
  buildEmailMessageRow(BD_ID, classified);
  buildEmailMessageRow(BD_ID, classified);
  buildEmailMessagePersonRows("m", classified.matches);
  assert.deepEqual(classified, snapshot);
});

/** Fake store that models the `unique(bd_id, gmail_message_id)` constraint + `ON CONFLICT DO NOTHING`. */
function fakeStore() {
  const messages = new Map<string, { id: string; row: NewEmailMessage }>();
  const links: NewEmailMessagePerson[] = [];
  let seq = 0;
  const store: SentEmailStore = {
    async insertMessage(row) {
      const key = `${row.bdId}|${row.gmailMessageId}`;
      if (messages.has(key)) return null;
      const id = `msg-${++seq}`;
      messages.set(key, { id, row });
      return id;
    },
    async findMessageId(bdId, gmailMessageId) {
      return messages.get(`${bdId}|${gmailMessageId}`)!.id;
    },
    async insertPersonLinks(rows) {
      for (const r of rows) {
        if (!links.some((l) => l.emailMessageId === r.emailMessageId && l.personId === r.personId)) links.push(r);
      }
    },
  };
  return { store, messages, links };
}

test("first write inserts the message and its link row", async () => {
  const { store, messages, links } = fakeStore();
  const result = await storeSentEmailMessage(store, BD_ID, sentClassified({ body: "hi" }, null));
  assert.equal(result.inserted, true);
  assert.equal(messages.size, 1);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.emailMessageId, result.emailMessageId);
});

test("conflict-safe: a second write of the same (bd, gmail message) changes nothing and returns the existing id", async () => {
  const { store, messages, links } = fakeStore();
  const first = await storeSentEmailMessage(store, BD_ID, sentClassified({ body: "hi" }, null));
  const again = await storeSentEmailMessage(store, BD_ID, sentClassified({ body: "different body" }, { rfcMessageId: "<z@x>", references: null, sentAt: SENT_AT }));
  assert.equal(again.inserted, false);
  assert.equal(again.emailMessageId, first.emailMessageId);
  assert.equal(messages.size, 1);
  assert.equal(links.length, 1);
  assert.equal([...messages.values()][0]!.row.bodyText, "hi");
});

test("sync after send is a no-op: the sync's own row builder hits the same unique key", async () => {
  const { store, messages } = fakeStore();
  const content: MessageContent = { body: "hola" };
  await storeSentEmailMessage(store, BD_ID, sentClassified(content, null));
  const syncRow = buildEmailMessageRow(BD_ID, syncClassified(content));
  assert.equal(await store.insertMessage(syncRow), null);
  assert.equal(messages.size, 1);
});
