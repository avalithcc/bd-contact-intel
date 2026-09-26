/**
 * Unit tests for src/lib/contacts/createContact.ts — the "Nuevo contacto"
 * dialog (mockups/contacts.html `#new-contact`). Pure field-building and
 * identity-match classification only — no DB — the actual `person` insert
 * lives in createContactActions.ts, which calls `matchIdentity` (the SAME
 * matcher every ingestion path uses, @/lib/identity/matcher) with the
 * MatchableRow this module builds, then maps its MatchResult through
 * `classifyMatchResultForCreate` to decide what to show/do.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNewContactFields,
  classifyMatchResultForCreate,
  matchableRowFromFields,
} from "@/lib/contacts/createContact";
import type { MatchResult } from "@/lib/identity/matcher";

test("buildNewContactFields trims blank fields to null and derives profileKey/companyKey", () => {
  const fields = buildNewContactFields({
    firstName: "  Paula ",
    lastName: "Gómez",
    linkedinUrl: "https://www.linkedin.com/in/paulagomez/",
    email: "paula.gomez@nubank.com.br",
    company: "Nubank",
  });
  assert.equal(fields.firstName, "Paula");
  assert.equal(fields.lastName, "Gómez");
  assert.equal(fields.profileKey, "linkedin.com/in/paulagomez");
  assert.equal(fields.email, "paula.gomez@nubank.com.br");
  assert.equal(fields.emailStatus, "probable");
  assert.equal(fields.company, "Nubank");
  assert.ok(fields.companyKey);
});

test("buildNewContactFields: an empty email means emailStatus 'none', not 'probable'", () => {
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "",
    linkedinUrl: "",
    email: "  ",
    company: "",
  });
  assert.equal(fields.email, null);
  assert.equal(fields.emailStatus, "none");
  assert.equal(fields.profileKey, null);
  assert.equal(fields.company, null);
  assert.equal(fields.companyKey, null);
});

test("buildNewContactFields: a manually typed email is NEVER 'verified' — no hunter lookup on this quick-add path", () => {
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "Gomez",
    linkedinUrl: "",
    email: "ana@acme.com",
    company: "Acme",
  });
  assert.equal(fields.emailStatus, "probable");
});

test("matchableRowFromFields maps NewContactFields to the matcher's MatchableRow shape 1:1", () => {
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "Gomez",
    linkedinUrl: "https://linkedin.com/in/anagomez",
    email: "ana@acme.com",
    company: "Acme",
  });
  const row = matchableRowFromFields(fields);
  assert.deepEqual(row, {
    profileKey: fields.profileKey,
    email: fields.email,
    emailStatus: fields.emailStatus,
    firstName: fields.firstName,
    lastName: fields.lastName,
    company: fields.company,
  });
});

test("classifyMatchResultForCreate: an exact auto match (profile key or verified email) means the person already exists — never create", () => {
  const result: MatchResult = { kind: "auto", personId: "p1", key: "profile_key" };
  assert.deepEqual(classifyMatchResultForCreate(result), { action: "existing_match", existingPersonId: "p1" });
});

test("classifyMatchResultForCreate: a name+company review match needs owner confirmation before creating (mockup's duplicate warning)", () => {
  const result: MatchResult = { kind: "review", reason: "name_company", personIds: ["p1", "p2"] };
  assert.deepEqual(classifyMatchResultForCreate(result), {
    action: "needs_confirmation",
    existingPersonId: "p1",
    reason: "name_company",
  });
});

test("classifyMatchResultForCreate: skip_own_company blocks creation outright", () => {
  const result: MatchResult = { kind: "skip_own_company", reason: "domain" };
  assert.deepEqual(classifyMatchResultForCreate(result), { action: "blocked_own_company" });
});

test("classifyMatchResultForCreate: 'new' means create with no warning", () => {
  const result: MatchResult = { kind: "new" };
  assert.deepEqual(classifyMatchResultForCreate(result), { action: "create" });
});
