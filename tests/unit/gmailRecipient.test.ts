import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRecipients, assertSingleRecipient, checkRecipientShape, MAX_REPLY_RECIPIENTS } from "@/lib/gmail/recipient";
import { encodeSubjectWords, foldSubjectHeader } from "@/lib/gmail/subjectEncoding";
import { buildRawMessage } from "@/lib/gmail/rawMessage";
import { GmailSendError } from "@/lib/gmail/errors";

test("accepts a plain single address", () => {
  for (const a of ["lead@example.com", "  jose.perez+x@sub.example.co.uk "]) assert.deepEqual(checkRecipientShape(a), { ok: true });
});

test("rejects malformed addresses as 'malformed'", () => {
  for (const a of ["", "   ", "plain", "a@", "@x.com", "a@x", "a@@x.com", "a b@x.com", "a@x..com", "a@.x.com", "a@x.com.", "<a@x.com>", "Jane <a@x.com>", '"a"@x.com', "a(b)@x.com", "a@x.c_m"]) {
    assert.deepEqual(checkRecipientShape(a), { ok: false, reason: "malformed" }, JSON.stringify(a));
  }
});

test("rejects several addresses as 'multiple'", () => {
  for (const a of ["a@x.com, b@y.com", "a@x.com,b@y.com", "a@x.com; b@y.com", "a@x.com b@y.com", "a@x.com;"]) {
    assert.deepEqual(checkRecipientShape(a), { ok: false, reason: "multiple" }, JSON.stringify(a));
  }
});

test("assertSingleRecipient throws a typed GmailSendError", () => {
  assert.throws(() => assertSingleRecipient("a@x.com, b@y.com"), (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_recipient" && e.header === "multiple");
  assert.throws(() => assertSingleRecipient("nope"), (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_recipient" && e.header === "malformed");
  assert.doesNotThrow(() => assertSingleRecipient("a@x.com"));
});

test("CR/LF in To is still the header guard's invalid_header, ahead of the shape check", () => {
  assert.throws(
    () => buildRawMessage("f@x.com", "a@x.com\r\nBcc: evil@x.com", "S", { body: "x" }),
    (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_header",
  );
  assert.throws(
    () => buildRawMessage("f@x.com", "a@x.com, b@y.com", "S", { body: "x" }),
    (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_recipient",
  );
});

// ---- RFC 2047 folding ----

function decodeWords(words: string[]): string {
  return words
    .map((w) => {
      const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/.exec(w);
      assert.ok(m, w);
      return Buffer.from(m[1], "base64").toString("utf8");
    })
    .join("");
}

const LONG = [
  "Propuesta técnica para la migración de infraestructura — reunión de seguimiento con el equipo de ingeniería y producto ñandú",
  "🚀".repeat(40),
  "Año nuevo, vida nueva: ¿cómo estás? 🎉 ".repeat(8),
  "日本語のとても長い件名".repeat(10),
];

test("long subjects fold into encoded-words of at most 75 chars that round-trip without splitting a character", () => {
  for (const subject of LONG) {
    const words = encodeSubjectWords(subject);
    assert.ok(words.length > 1);
    for (const w of words) {
      assert.ok(w.length <= 75, `${w.length}`);
      const bytes = Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(w)![1], "base64");
      assert.ok(!bytes.toString("utf8").includes("�"), "each word decodes alone to valid UTF-8");
    }
    assert.equal(decodeWords(words), subject);
  }
});

test("a short subject stays a single inline encoded-word, byte-identical to before", () => {
  const s = "Hola José";
  const expected = `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  assert.deepEqual(encodeSubjectWords(s), [expected]);
  assert.equal(foldSubjectHeader(s), `Subject: ${expected}`);
  assert.deepEqual(encodeSubjectWords(""), ["=?UTF-8?B??="]);
});

test("folded Subject header: lines within 78 chars, continuation lines start with a space, no injection", () => {
  for (const subject of [...LONG, "Hi\r\nBcc: evil@x.com " + "x".repeat(100)]) {
    const header = foldSubjectHeader(subject);
    const lines = header.split("\r\n");
    assert.equal(lines[0], "Subject:");
    for (const l of lines.slice(1)) {
      assert.ok(l.startsWith(" =?UTF-8?B?"));
      assert.ok(l.length <= 78);
    }
    assert.equal(header.includes("Bcc"), false);
  }
});

test("encoding is deterministic", () => {
  assert.deepEqual(encodeSubjectWords(LONG[0]), encodeSubjectWords(LONG[0]));
});

// ---- Thread reply: an explicit opt-in allows a list, each address validated ----

const THREE = "a@x.com, b@y.com; c@z.org";

test("thread reply: 3 valid addresses pass only with allowRecipientList", () => {
  assert.doesNotThrow(() => buildRawMessage("f@x.com", THREE, "Re: S", { body: "x" }, undefined, { inReplyTo: "<m@x>", references: "<m@x>" }, [], true));
  assert.throws(() => buildRawMessage("f@x.com", THREE, "Re: S", { body: "x" }, undefined, { inReplyTo: "<m@x>", references: "<m@x>" }), (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_recipient");
});

test("thread reply: one bad address in the list fails, as does an empty item or a CR/LF", () => {
  for (const bad of ["a@x.com, nope, c@z.org", "a@x.com,,c@z.org", "a@x.com, b@y.com,", "a@x.com, Jane <b@y.com>"]) {
    assert.throws(() => assertRecipients(bad, { allowList: true }), (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_recipient", bad);
  }
  assert.throws(() => buildRawMessage("f@x.com", "a@x.com, b@y.com\r\nBcc: e@x.com", "S", { body: "x" }, undefined, undefined, [], true), (e: unknown) => e instanceof GmailSendError && e.kind === "invalid_header");
});

test("new email: 2 addresses fail; the reply list is capped", () => {
  assert.throws(() => assertRecipients("a@x.com, b@y.com"), (e: unknown) => e instanceof GmailSendError && e.header === "multiple");
  const many = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@x.com`).join(", ");
  assert.doesNotThrow(() => assertRecipients(many(MAX_REPLY_RECIPIENTS), { allowList: true }));
  assert.throws(() => assertRecipients(many(MAX_REPLY_RECIPIENTS + 1), { allowList: true }));
});

test("internationalized domains (punycode labels, even a TLD ending in a digit) are valid; an IP-like or numeric TLD is not", () => {
  for (const a of ["user@xn--80ak6aa92e.com", "a@b.xn--11b4c3d", "a@b.xn--p1ai"]) assert.deepEqual(checkRecipientShape(a), { ok: true }, a);
  for (const a of ["a@1.2.3.4", "a@b.123", "a@-b.com", "a@b-.com"]) assert.deepEqual(checkRecipientShape(a), { ok: false, reason: "malformed" }, a);
});

test("the To header carries the trimmed address", () => {
  const raw = Buffer.from(buildRawMessage("f@x.com", "  a@x.com \t", "S", { body: "x" }), "base64url").toString("utf8");
  assert.match(raw, /\r\nTo: a@x\.com\r\n/);
});
