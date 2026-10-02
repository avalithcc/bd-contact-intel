/**
 * Unit tests for src/app/(app)/contacts/actionErrors.ts — the pure error ->
 * reason mapper behind the Contact record's server actions (fresh-review
 * WARNING: actions threw raw English Error messages straight to the
 * client instead of a typed reason the UI can render in Spanish).
 */
import assert from "node:assert/strict";
import { assertSafeHeaderValue } from "@/lib/gmail/rawMessage";
import { test } from "node:test";
import { ContactMergedError } from "@/lib/contacts/mergeGuard";
import { ContactNotFoundError } from "@/lib/contacts/errors";
import { TaskNotFoundError } from "@/lib/tasks/errors";
import { InvalidContactTypeError, InvalidEmailError } from "@/lib/contacts/propertyEdit";
import { GmailSendError } from "@/lib/gmail/errors";
import {
  contactActionErrorReason,
  contactActionErrorHref,
  PropertyNotEditableError,
} from "@/app/(app)/contacts/actionErrors";

test("maps ContactMergedError to 'merged'", () => {
  assert.equal(contactActionErrorReason(new ContactMergedError()), "merged");
});

test("maps ContactNotFoundError to 'not_found'", () => {
  assert.equal(contactActionErrorReason(new ContactNotFoundError("p1")), "not_found");
});

test("maps TaskNotFoundError to 'not_found' — a task write scoped to the wrong personId must never be distinguishable from a missing task", () => {
  assert.equal(contactActionErrorReason(new TaskNotFoundError()), "not_found");
});

test("maps InvalidEmailError to 'invalid_email'", () => {
  assert.equal(contactActionErrorReason(new InvalidEmailError("invalid_format")), "invalid_email");
});

test("maps InvalidContactTypeError to 'invalid_contact_type'", () => {
  assert.equal(contactActionErrorReason(new InvalidContactTypeError()), "invalid_contact_type");
});

test("maps PropertyNotEditableError to 'not_editable'", () => {
  assert.equal(contactActionErrorReason(new PropertyNotEditableError("status")), "not_editable");
});

test("maps any other error (or non-error) to 'unexpected'", () => {
  assert.equal(contactActionErrorReason(new Error("boom")), "unexpected");
  assert.equal(contactActionErrorReason("boom"), "unexpected");
});

test("maps GmailSendError('not_connected') to 'gmail_not_connected'", () => {
  assert.equal(
    contactActionErrorReason(new GmailSendError("not_connected", "not connected")),
    "gmail_not_connected",
  );
});

test("maps GmailSendError('reauth_required') to 'gmail_reauth'", () => {
  assert.equal(
    contactActionErrorReason(new GmailSendError("reauth_required", "expired")),
    "gmail_reauth",
  );
});

test("maps GmailSendError('not_configured'|'temporary'|'send_failed') to 'gmail_unavailable'", () => {
  assert.equal(contactActionErrorReason(new GmailSendError("not_configured", "x")), "gmail_unavailable");
  assert.equal(contactActionErrorReason(new GmailSendError("temporary", "x")), "gmail_unavailable");
  assert.equal(contactActionErrorReason(new GmailSendError("send_failed", "x")), "gmail_unavailable");
});

test("maps GmailSendError('invalid_header') to 'invalid_email'", () => {
  assert.equal(contactActionErrorReason(new GmailSendError("invalid_header", "x")), "invalid_email");
});

test("invalid_header on a threading header maps to 'reply_unsafe_header', not to the email-address copy", () => {
  assert.equal(contactActionErrorReason(new GmailSendError("invalid_header", "x", "In-Reply-To")), "reply_unsafe_header");
  assert.equal(contactActionErrorReason(new GmailSendError("invalid_header", "x", "References")), "reply_unsafe_header");
  assert.equal(contactActionErrorReason(new GmailSendError("invalid_header", "x", "To")), "invalid_email");
  assert.equal(contactActionErrorReason(new GmailSendError("invalid_header", "x", "From")), "invalid_email");
});

test("assertSafeHeaderValue records WHICH header was rejected", () => {
  assert.throws(
    () => assertSafeHeaderValue("References", "<a@x>\r\n"),
    (e: unknown) => e instanceof GmailSendError && e.header === "References",
  );
});

test("contactActionErrorHref points reconnect reasons at /account/email", () => {
  assert.equal(contactActionErrorHref("gmail_not_connected"), "/account/email");
  assert.equal(contactActionErrorHref("gmail_reauth"), "/account/email");
});

test("contactActionErrorHref returns undefined for other reasons", () => {
  assert.equal(contactActionErrorHref("gmail_unavailable"), undefined);
  assert.equal(contactActionErrorHref("unexpected"), undefined);
});
