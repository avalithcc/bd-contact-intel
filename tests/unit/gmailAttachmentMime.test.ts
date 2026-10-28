import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMimeMessage, buildRawMessage, buildSendPayload, buildUploadRequest } from "@/lib/gmail/rawMessage";
import { GmailSendError } from "@/lib/gmail/errors";

// Captured from the implementation BEFORE attachments existed: a message without attachments or Cc must not change by one byte.
const GOLDEN = {
  text: "RnJvbTogYmRAYXZhbGl0aC50ZXN0DQpUbzogbGVhZEBleGFtcGxlLnRlc3QNClN1YmplY3Q6ID0_VVRGLTg_Qj9TRzlzWVNERHNXRnVaTU82Pz0NCk1JTUUtVmVyc2lvbjogMS4wDQpDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9IlVURi04Ig0KQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZzogYmFzZTY0DQoNClNHa05DblJvWlhKbA",
  html: "RnJvbTogYmRAYXZhbGl0aC50ZXN0DQpUbzogbGVhZEBleGFtcGxlLnRlc3QNClN1YmplY3Q6ID0_VVRGLTg_Qj9TR1ZzYkc4PT89DQpNSU1FLVZlcnNpb246IDEuMA0KQ29udGVudC1UeXBlOiBtdWx0aXBhcnQvYWx0ZXJuYXRpdmU7IGJvdW5kYXJ5PSI9X2JkX2ZpeGVkYm91bmRhcnkiDQoNCi0tPV9iZF9maXhlZGJvdW5kYXJ5DQpDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9IlVURi04Ig0KQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZzogYmFzZTY0DQoNClNHa2dkR2hsY21VPQ0KLS09X2JkX2ZpeGVkYm91bmRhcnkNCkNvbnRlbnQtVHlwZTogdGV4dC9odG1sOyBjaGFyc2V0PSJVVEYtOCINCkNvbnRlbnQtVHJhbnNmZXItRW5jb2Rpbmc6IGJhc2U2NA0KDQpQSEErU0drZ1BHSStkR2hsY21VOEwySStQQzl3UGc9PQ0KLS09X2JkX2ZpeGVkYm91bmRhcnktLQ0K",
  reply:
    '{"raw":"RnJvbTogYmRAYXZhbGl0aC50ZXN0DQpUbzogbGVhZEBleGFtcGxlLnRlc3QNClN1YmplY3Q6ID0_VVRGLTg_Qj9VbVU2SUVobGJHeHY_PQ0KSW4tUmVwbHktVG86IDxhQGI-DQpSZWZlcmVuY2VzOiA8YUBiPg0KTUlNRS1WZXJzaW9uOiAxLjANCkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpbjsgY2hhcnNldD0iVVRGLTgiDQpDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nOiBiYXNlNjQNCg0KV1c4PQ","threadId":"t1"}',
};

const fixed = () => "fixedboundary";
const counter = () => {
  let n = 0;
  return () => `b${n++}`;
};

test("no attachments, no Cc: output is byte-identical to the pre-attachment builder", () => {
  assert.equal(buildRawMessage("bd@avalith.test", "lead@example.test", "Hola ñandú", { body: "Hi\nthere" }, fixed), GOLDEN.text);
  assert.equal(buildRawMessage("bd@avalith.test", "lead@example.test", "Hello", { bodyHtml: "<p>Hi <b>there</b></p>" }, fixed), GOLDEN.html);
  assert.equal(
    buildSendPayload("bd@avalith.test", "lead@example.test", "Re: Hello", { body: "Yo" }, { threadId: "t1", inReplyTo: "<a@b>", references: "<a@b>" }),
    GOLDEN.reply,
  );
});

const pdf = (name = "Propuesta.pdf", bytes = Buffer.from("%PDF-1.7 hello")) => ({ filename: name, contentType: "application/pdf", data: bytes });

function build(over: { cc?: string[]; replyTo?: string[]; attachments?: ReturnType<typeof pdf>[]; content?: { body: string } | { bodyHtml: string }; to?: string; allowRecipientList?: boolean } = {}) {
  return buildMimeMessage({
    from: "bd@avalith.test",
    to: over.to ?? "a@example.test",
    subject: "Hola",
    content: over.content ?? { body: "Texto" },
    boundaryRandom: counter(),
    allowRecipientList: over.allowRecipientList,
    cc: over.cc,
    replyTo: over.replyTo,
    attachments: over.attachments,
  });
}

test("Cc header goes after To; absent when there is no Cc", () => {
  const withCc = build({ cc: ["ana@avalith.net"] });
  assert.match(withCc, /^From: bd@avalith\.test\r\nTo: a@example\.test\r\nCc: ana@avalith\.net\r\nSubject: /);
  assert.doesNotMatch(build(), /\r\nCc:/);
});

test("several recipients in To when the list is allowed", () => {
  const m = build({ to: "a@example.test, b@example.test", allowRecipientList: true });
  assert.match(m, /\r\nTo: a@example\.test, b@example\.test\r\n/);
});

test("a malformed or injected Cc is refused before anything is built", () => {
  for (const cc of ["x@avalith.net\r\nBcc: evil@x.test", "not-an-address", "a@b.test, c@d.test"]) {
    assert.throws(() => build({ cc: [cc] }), (e: unknown) => e instanceof GmailSendError);
  }
});

test("text + attachment is multipart/mixed with the body first and the file last", () => {
  const m = build({ attachments: [pdf()] });
  const boundary = /Content-Type: multipart\/mixed; boundary="([^"]+)"/.exec(m)![1]!;
  const parts = m.split(`--${boundary}`);
  assert.equal(parts.length, 4); // preamble, body, attachment, closing "--"
  assert.match(parts[1]!, /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
  assert.match(parts[2]!, /Content-Type: application\/pdf; name="Propuesta\.pdf"/);
  assert.match(parts[2]!, /Content-Disposition: attachment;\s+filename="Propuesta\.pdf"/);
  assert.match(parts[2]!, /Content-Transfer-Encoding: base64\r\n\r\n/);
  assert.ok(parts[3]!.startsWith("--"));
  const b64 = parts[2]!.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
  assert.equal(Buffer.from(b64, "base64").toString(), "%PDF-1.7 hello");
});

test("html body stays multipart/alternative nested inside multipart/mixed, with a different boundary", () => {
  const m = build({ content: { bodyHtml: "<p>Hola</p>" }, attachments: [pdf()] });
  const mixed = /multipart\/mixed; boundary="([^"]+)"/.exec(m)![1]!;
  const alt = /multipart\/alternative; boundary="([^"]+)"/.exec(m)![1]!;
  assert.notEqual(mixed, alt);
  assert.ok(m.indexOf("multipart/mixed") < m.indexOf("multipart/alternative"));
  assert.ok(m.indexOf(`--${alt}--`) < m.indexOf("application/pdf"));
  assert.ok(m.trimEnd().endsWith(`--${mixed}--`));
});

test("attachment base64 is wrapped at 76 columns with CRLF", () => {
  const m = build({ attachments: [pdf("big.pdf", Buffer.alloc(5000, 7))] });
  const lines = m.split("\r\n");
  assert.ok(lines.every((l) => l.length <= 998));
  const body = lines.filter((l) => /^[A-Za-z0-9+/]+=*$/.test(l));
  assert.ok(body.length > 50);
  assert.ok(body.every((l) => l.length <= 76));
});

test("non-ASCII filename: ASCII fallback plus RFC 2231 filename*", () => {
  const m = build({ attachments: [pdf("Propuesta ñandú.pdf")] });
  assert.match(m, /filename="Propuesta _and_\.pdf"/);
  assert.match(m, /filename\*=UTF-8''Propuesta%20%C3%B1and%C3%BA\.pdf/);
  assert.match(m, /name\*=UTF-8''Propuesta%20%C3%B1and%C3%BA\.pdf/);
  assert.ok(m.split("\r\n").every((l) => l.length <= 998));
});

test("quotes and backslashes in a filename cannot break out of the quoted-string", () => {
  const m = build({ attachments: [pdf('a"b\\c.pdf')] });
  assert.match(m, /filename="a_b_c\.pdf"/);
  assert.match(m, /filename\*=UTF-8''a%22b%5Cc\.pdf/);
});

test("CR, LF or NUL in a filename is rejected, not stripped", () => {
  for (const name of ["a\r\nBcc: x@y.test.pdf", "a\0.pdf", "a\n.pdf"]) {
    assert.throws(() => build({ attachments: [pdf(name)] }), (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_header");
  }
});

test("a very long non-ASCII filename still yields header lines under the RFC 998 limit", () => {
  const m = build({ attachments: [pdf(`${"日".repeat(110)}.pdf`)] });
  assert.ok(m.split("\r\n").every((l) => l.length <= 998));
  assert.match(m, /\.pdf/);
});

test("upload request wraps the message as multipart/related with threadId metadata", () => {
  const message = build({ attachments: [pdf()] });
  const { contentType, body } = buildUploadRequest(message, "thread-9");
  const boundary = /^multipart\/related; boundary="([^"]+)"$/.exec(contentType)![1]!;
  const text = body;
  const parts = text.split(`--${boundary}`);
  assert.equal(parts.length, 4);
  assert.match(parts[1]!, /Content-Type: application\/json; charset=UTF-8\r\n\r\n\{"threadId":"thread-9"\}\r\n$/);
  assert.match(parts[2]!, /^\r\nContent-Type: message\/rfc822\r\n\r\n/);
  assert.ok(parts[2]!.includes(message));
  assert.ok(parts[3]!.startsWith("--"));
});

test("upload request without a thread sends empty metadata", () => {
  const { body } = buildUploadRequest(build({ attachments: [pdf()] }));
  assert.match(body, /Content-Type: application\/json; charset=UTF-8\r\n\r\n\{\}\r\n/);
});

/**
 * Reply-To: added 2026-10-28, for a mail sent from a colleague's mailbox while they are away — the answers
 * have to reach whoever is actually handling the thread. `reply-to` was already in RESERVED_HEADER_NAMES but
 * nothing ever emitted it, so the header could not be set at all: an extra header line was refused and there
 * was no field. The GOLDEN test above is the regression guard that a message without one is unchanged.
 */
test("Reply-To is emitted after Cc, and several addresses share one header", () => {
  const one = build({ replyTo: ["ana@avalith.net"] });
  assert.match(one, /^From: bd@avalith\.test\r\nTo: a@example\.test\r\nReply-To: ana@avalith\.net\r\nSubject: /);

  const many = build({ cc: ["cc@avalith.net"], replyTo: ["ana@avalith.net", "beto@avalith.net", "caro@avalith.net"] });
  assert.match(
    many,
    /^From: bd@avalith\.test\r\nTo: a@example\.test\r\nCc: cc@avalith\.net\r\nReply-To: ana@avalith\.net, beto@avalith\.net, caro@avalith\.net\r\nSubject: /,
  );
  assert.equal(many.match(/\r\nReply-To: /g)?.length, 1, "one header line, not one per address");
});

test("no Reply-To field means no Reply-To header at all", () => {
  assert.ok(!build().includes("Reply-To:"));
  assert.ok(!build({ replyTo: [] }).includes("Reply-To:"));
});

// Asserted on the MESSAGE, not just the class: both guards throw GmailSendError, so a test that only checks
// the class would still pass with the control-character check deleted.
test("a CR/LF in a Reply-To address is refused as a control character, before any shape check", () => {
  assert.throws(
    () => build({ replyTo: ["ana@avalith.net\r\nBcc: evil@example.test"] }),
    (err: unknown) => err instanceof GmailSendError && /control character/i.test(err.message),
  );
});

test("a Reply-To address must be one well-formed address: not malformed, not a list in one string", () => {
  assert.throws(
    () => build({ replyTo: ["no-es-una-direccion"] }),
    (err: unknown) => err instanceof GmailSendError && /malformed/i.test(err.message),
  );
  // Two addresses in a single element would otherwise reach the header as a hand-made list.
  assert.throws(() => build({ replyTo: ["ana@avalith.net, beto@avalith.net"] }), GmailSendError);
  assert.throws(() => build({ replyTo: [""] }), GmailSendError);
  // Surrounding whitespace is trimmed, like Cc.
  assert.match(build({ replyTo: ["  ana@avalith.net  "] }), /\r\nReply-To: ana@avalith\.net\r\n/);
});

// The field is the only way in: `reply-to` stays reserved so a caller cannot add a second one by hand.
test("Reply-To cannot also arrive as an extra header", () => {
  assert.throws(
    () => buildMimeMessage({ from: "bd@avalith.test", to: "a@example.test", subject: "Hola", content: { body: "T" }, extraHeaders: ["Reply-To: evil@example.test"] }),
    (err: unknown) => err instanceof GmailSendError && /cannot be added as an extra header/i.test(err.message),
  );
});

test("Reply-To travels through the raw and payload builders too", () => {
  const raw = Buffer.from(
    buildRawMessage("bd@avalith.test", "a@example.test", "Hola", { body: "Texto" }, fixed, undefined, [], false, [], ["ana@avalith.net"]),
    "base64url",
  ).toString("utf8");
  assert.match(raw, /\r\nReply-To: ana@avalith\.net\r\n/);

  const payload = buildSendPayload("bd@avalith.test", "a@example.test", "Hola", { body: "Texto" }, undefined, [], false, [], ["ana@avalith.net"]);
  const decoded = Buffer.from(JSON.parse(payload).raw, "base64url").toString("utf8");
  assert.match(decoded, /\r\nReply-To: ana@avalith\.net\r\n/);
});
