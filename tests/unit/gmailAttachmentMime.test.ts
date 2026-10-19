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

function build(over: { cc?: string[]; attachments?: ReturnType<typeof pdf>[]; content?: { body: string } | { bodyHtml: string }; to?: string; allowRecipientList?: boolean } = {}) {
  return buildMimeMessage({
    from: "bd@avalith.test",
    to: over.to ?? "a@example.test",
    subject: "Hola",
    content: over.content ?? { body: "Texto" },
    boundaryRandom: counter(),
    allowRecipientList: over.allowRecipientList,
    cc: over.cc,
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
