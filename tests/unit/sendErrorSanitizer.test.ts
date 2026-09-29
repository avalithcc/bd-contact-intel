/**
 * Unit tests for src/lib/tasks/sendErrorSanitizer.ts — the digest cron never
 * writes a raw SMTP error to task_digest_send.error, since nodemailer can
 * echo back the AUTH LOGIN base64 exchange (which encodes SMTP_USER /
 * SMTP_PASSWORD) in its `response`/`command` fields.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeSendError } from "@/lib/tasks/sendErrorSanitizer";

test("sanitizeSendError extracts a plain message from an Error", () => {
  assert.equal(sanitizeSendError(new Error("Connection timed out")), "Connection timed out");
});

test("sanitizeSendError stringifies non-Error values", () => {
  assert.equal(sanitizeSendError("plain string failure"), "plain string failure");
});

test("sanitizeSendError redacts a Basic/Bearer auth header", () => {
  const message = "535 Authentication failed, header: Basic dXNlcjpwYXNzd29yZDEyMzQ=";
  const result = sanitizeSendError(new Error(message));
  assert.doesNotMatch(result, /dXNlcjpwYXNzd29yZDEyMzQ=/);
  assert.match(result, /\[redacted\]/);
});

test("sanitizeSendError redacts a long base64-looking blob (AUTH LOGIN credential)", () => {
  const message = "534-5.7.9 Application-specific password required QWxhZGRpbjpvcGVuc2VzYW1lMTIzNDU2Nzg5";
  const result = sanitizeSendError(new Error(message));
  assert.doesNotMatch(result, /QWxhZGRpbjpvcGVuc2VzYW1lMTIzNDU2Nzg5/);
});

test("sanitizeSendError caps the message length", () => {
  const long = "x".repeat(1000);
  const result = sanitizeSendError(new Error(long));
  assert.ok(result.length <= 501, `expected <= 501 chars, got ${result.length}`);
});
