import { test } from "node:test";
import assert from "node:assert/strict";
import { contactsListHref, listQueryToRemember } from "@/lib/contacts/listMemory";

test("no remembered query means the bare list", () => {
  assert.equal(contactsListHref(null), "/contacts");
  assert.equal(contactsListHref(""), "/contacts");
});

test("a remembered query is carried back onto /contacts", () => {
  assert.equal(contactsListHref("view=notContacted&hasPhone=1"), "/contacts?view=notContacted&hasPhone=1");
});

test("a stored value can only ever add query params to /contacts", () => {
  assert.equal(contactsListHref("?view=a"), "/contacts?view=a");
  assert.equal(contactsListHref("//evil.com"), "/contacts?%2F%2Fevil.com=");
});

test("only the list itself is remembered, not a record or another page", () => {
  assert.equal(listQueryToRemember("/contacts", "view=mine"), "view=mine");
  assert.equal(listQueryToRemember("/contacts", ""), "");
  assert.equal(listQueryToRemember("/contacts/abc", "x=1"), null);
  assert.equal(listQueryToRemember("/companies", "x=1"), null);
});

test("the search box is never carried back: leaving the list clears the search, filters stay", () => {
  assert.equal(listQueryToRemember("/contacts", "?q=acme&view=outreach&page=2"), "view=outreach&page=2");
  assert.equal(contactsListHref("q=acme&view=outreach"), "/contacts?view=outreach");
  assert.equal(contactsListHref("q=acme"), "/contacts");
});
