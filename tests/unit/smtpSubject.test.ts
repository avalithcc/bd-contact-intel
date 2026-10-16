import assert from "node:assert/strict";
import { test } from "node:test";
import { singleLine } from "@/lib/mailer/smtpMailer";

test("singleLine collapses CR/LF so a subject can never inject a header", () => {
  assert.equal(singleLine("Ana\r\nBcc: x@y.z sigue sin conectar Gmail"), "Ana Bcc: x@y.z sigue sin conectar Gmail");
  assert.equal(singleLine("a\nb\rc"), "a b c");
  assert.equal(singleLine("Normal"), "Normal");
});
