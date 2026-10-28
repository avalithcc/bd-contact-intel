/**
 * The send path with files, several "Para" contacts and Cc: which Gmail endpoint is called, what the message looks like,
 * and the activities written. Same fake world as the characterization tests (no network, no database).
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { installFakeWorld, makeAccountRow, SEND_URL, TOKEN_URL } from "./fixtures/gmailSendHarness";
import { GmailSendError } from "@/lib/gmail/errors";

// A send that names a person revalidates its record page, which needs Next's request store. There is none in a unit test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
mock.method(require("next/cache"), "revalidatePath", () => undefined);

const UPLOAD_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart";
const OK_TOKEN = { ok: true, body: { access_token: "access-1" } };
const OK_SEND = { ok: true, body: { id: "gmail-msg-1", threadId: "gmail-thread-1" } };
const file = (name = "Propuesta.pdf") => ({ filename: name, contentType: "application/pdf", data: Buffer.from("%PDF-1.7 hola"), size: 13, storagePath: `u/x/${name}` });

async function send(extra: Record<string, unknown>) {
  const { sendGmailMessage } = await import("@/lib/gmail/send");
  return sendGmailMessage({ bdId: "bd-1", to: "lead@example.test", subject: "Hola", body: "Texto", personId: "p-1", ...extra });
}

test("with files the message goes to the media-upload endpoint as multipart/related, not as JSON", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({ attachments: [file()], cc: ["ana@avalith.net"] });
    const call = w.fetchCalls.find((c) => c.url !== TOKEN_URL)!;
    assert.equal(call.url, UPLOAD_URL);
    const headers = call.init.headers as Record<string, string>;
    assert.match(headers["Content-Type"]!, /^multipart\/related; boundary=/);
    assert.equal(headers.Authorization, "Bearer access-1");
    const body = String(call.init.body);
    assert.match(body, /Content-Type: application\/json; charset=UTF-8\r\n\r\n\{\}/);
    assert.match(body, /Content-Type: message\/rfc822/);
    assert.match(body, /\r\nCc: ana@avalith\.net\r\n/);
    assert.match(body, /Content-Type: multipart\/mixed/);
    assert.match(body, /filename="Propuesta\.pdf"/);
  } finally {
    w.restore();
  }
});

test("a reply with files keeps the thread: threadId in the upload metadata and the threading headers in the message", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({ attachments: [file()], allowRecipientList: true, subject: "Re: Hola", reply: { threadId: "t-77", inReplyTo: "<a@b>", references: "<a@b>" } });
    const call = w.fetchCalls.find((c) => c.url !== TOKEN_URL)!;
    const body = String(call.init.body);
    assert.match(body, /\{"threadId":"t-77"\}/);
    assert.match(body, /In-Reply-To: <a@b>/);
  } finally {
    w.restore();
  }
});

test("without files nothing changes: the JSON endpoint is called", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({});
    assert.equal(w.fetchCalls.find((c) => c.url !== TOKEN_URL)!.url, SEND_URL);
  } finally {
    w.restore();
  }
});

test("the activity records names and sizes of the files, the Cc list and the address list", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({
      to: "a@acme.test, b@acme.test",
      allowRecipientList: true,
      attachments: [file()],
      cc: ["ana@avalith.net"],
      recipients: [
        { personId: "p-1", name: "A", email: "a@acme.test" },
        { personId: "p-2", name: "B", email: "b@acme.test" },
      ],
    });
    assert.equal(w.insertedActivities.length, 2, "one email_sent per Para contact");
    assert.deepEqual(w.insertedActivities.map((a) => a.personId), ["p-1", "p-2"]);
    const m = w.insertedActivities[1]!.metadata as Record<string, unknown>;
    assert.deepEqual(m.to, ["a@acme.test", "b@acme.test"]);
    assert.deepEqual(m.cc, ["ana@avalith.net"]);
    assert.deepEqual(m.attachments, [{ filename: "Propuesta.pdf", size: 13 }]);
    assert.equal(m.gmailMessageId, "gmail-msg-1");
    assert.ok(w.insertedActivities.every((a) => a.type === "email_sent" && a.actorBdId === "bd-1"));
    // The bytes of a file never reach the activity.
    assert.doesNotMatch(JSON.stringify(w.insertedActivities), /PDF-1\.7/);
  } finally {
    w.restore();
  }
});

test("a single-recipient send still stores `to` as the one address string and writes one activity", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({});
    assert.equal(w.insertedActivities.length, 1);
    const m = w.insertedActivities[0]!.metadata as Record<string, unknown>;
    assert.equal(m.to, "lead@example.test");
    assert.equal("cc" in m, false);
    assert.equal("attachments" in m, false);
  } finally {
    w.restore();
  }
});

test("a Cc that is not a single bare address is refused before any network call", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    for (const cc of ["a@avalith.net, b@avalith.net", "x@avalith.net\r\nBcc: y@z.test", "no-at"]) {
      await assert.rejects(send({ cc: [cc] }), (e: unknown) => e instanceof GmailSendError);
    }
    assert.equal(w.fetchCalls.length, 0);
  } finally {
    w.restore();
  }
});

/**
 * Reply-To (2026-10-28). It has to reach BOTH send paths: the JSON endpoint and the media upload. Before
 * these two, dropping `replyTo` at either call site in send.ts left every test green.
 */
test("Reply-To reaches the JSON endpoint, as one header with every address", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({ replyTo: ["ana@avalith.net", "beto@avalith.net"] });
    const call = w.fetchCalls.find((c) => c.url === SEND_URL)!;
    const raw = Buffer.from(JSON.parse(String(call.init.body)).raw, "base64url").toString("utf8");
    assert.match(raw, /\r\nReply-To: ana@avalith\.net, beto@avalith\.net\r\n/);
    assert.equal(raw.match(/\r\nReply-To: /g)?.length, 1);
  } finally {
    w.restore();
  }
});

test("Reply-To reaches the media-upload endpoint too", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await send({ attachments: [file()], replyTo: ["ana@avalith.net"] });
    const call = w.fetchCalls.find((c) => c.url === UPLOAD_URL)!;
    assert.match(String(call.init.body), /\r\nReply-To: ana@avalith\.net\r\n/);
  } finally {
    w.restore();
  }
});

test("a malformed Reply-To is refused before the token is ever refreshed", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  try {
    await assert.rejects(() => send({ replyTo: ["no-es-una-direccion"] }), GmailSendError);
    assert.equal(w.fetchCalls.length, 0, "nothing was called: the guard runs before the network");
  } finally {
    w.restore();
  }
});

/**
 * The mail is already gone by the time the cache is revalidated, so a revalidation that throws must not make
 * the send look failed — an owner-run script (scripts/send-as-bd.ts) has no Next request store, and
 * `revalidatePath` threw there, turning a delivered email into exit code 1 and inviting a second send.
 */
test("a send whose cache revalidation throws still resolves", async () => {
  const w = await installFakeWorld({ accountRows: [await makeAccountRow()], token: OK_TOKEN, send: OK_SEND });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cache = require("next/cache");
  mock.method(cache, "revalidatePath", () => {
    throw new Error("Invariant: static generation store missing");
  });
  try {
    const result = await send({});
    assert.equal(result.messageId, "gmail-msg-1");
    assert.ok(w.fetchCalls.some((c) => c.url === SEND_URL), "the message really was sent");
  } finally {
    mock.method(cache, "revalidatePath", () => undefined);
    w.restore();
  }
});
