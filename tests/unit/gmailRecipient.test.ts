import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSingleRecipient, checkRecipientShape } from "@/lib/gmail/recipient";
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
