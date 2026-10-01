import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareSignatureForSave, SIGNATURE_MAX_CHARS } from "../../src/lib/signature/validate";

test("blank input means 'clear the signature'", () => {
  assert.deepEqual(prepareSignatureForSave(""), { ok: true, html: null });
  assert.deepEqual(prepareSignatureForSave("  \n\t "), { ok: true, html: null });
});

test("returns the sanitized html, not what was typed", () => {
  const r = prepareSignatureForSave('<p onclick="x()">Ana</p><script>alert(1)</script>');
  assert.deepEqual(r, { ok: true, html: "<p>Ana</p>" });
});

test("rejects input over the cap before parsing it", () => {
  const r = prepareSignatureForSave("a".repeat(SIGNATURE_MAX_CHARS + 1));
  assert.deepEqual(r, { ok: false, error: "too_long" });
});

test("rejects non-blank input that sanitizes to nothing", () => {
  assert.deepEqual(prepareSignatureForSave("<script>alert(1)</script>"), { ok: false, error: "nothing_left" });
  assert.deepEqual(prepareSignatureForSave('<img src="data:image/png;base64,AAAA">'), { ok: false, error: "nothing_left" });
});

test("rejects a non-string value (server actions receive untrusted input)", () => {
  assert.deepEqual(prepareSignatureForSave(undefined as unknown as string), { ok: false, error: "invalid" });
});
