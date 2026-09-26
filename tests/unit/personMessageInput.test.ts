/**
 * Unit tests for src/lib/outreach/personMessageInput.ts (task 13.3, PR 13c
 * "Generar mensaje" on the record page). Pure mapper — no DB, no AI call.
 * Builds a BuildOutreachMessagePromptInput from the unified `person` record
 * so the generator works for ANY person, including a teammate-only contact
 * the calling BD has no `person_bd_connection` row for (R6: never surface
 * another BD's message content — this input never carries message content
 * at all, only the calling BD's own connection counts/dates and shared
 * research signals).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPersonMessageInput } from "@/lib/outreach/personMessageInput";

const BASE_PERSON = {
  firstName: "Ana",
  lastName: "Gomez",
  jobTitle: "VP Engineering",
  roleGroup: "eng_leadership" as const,
  industry: "fintech",
  companyKey: "acme",
};

test("maps person fields into the contact block", () => {
  const input = buildPersonMessageInput({
    person: BASE_PERSON,
    connection: null,
    signalBodies: [],
    company: null,
    senderName: "Cristian Civita",
    locale: "es",
  });
  assert.equal(input.contact.firstName, "Ana");
  assert.equal(input.contact.lastName, "Gomez");
  assert.equal(input.contact.position, "VP Engineering");
  assert.equal(input.contact.roleGroup, "eng_leadership");
  assert.equal(input.contact.isLeadership, true);
});

test("history is always empty — never another BD's message content (R6)", () => {
  const input = buildPersonMessageInput({
    person: BASE_PERSON,
    connection: { connectedOn: "2024-01-01", messageCount: 5, reciprocal: true, lastMessageAt: new Date("2024-06-01") },
    signalBodies: [],
    company: null,
    senderName: "Cristian Civita",
    locale: "es",
  });
  assert.deepEqual(input.history, []);
});

test("no connection (teammate-only contact) leaves connectedOn unknown, still produces a valid input", () => {
  const input = buildPersonMessageInput({
    person: BASE_PERSON,
    connection: null,
    signalBodies: [],
    company: null,
    senderName: "Cristian Civita",
    locale: "es",
  });
  assert.equal(input.contact.connectedOn, null);
});

test("a connection contributes connectedOn plus a counts/dates-only summary note", () => {
  const input = buildPersonMessageInput({
    person: BASE_PERSON,
    connection: { connectedOn: "2024-01-01", messageCount: 5, reciprocal: true, lastMessageAt: new Date("2024-06-01") },
    signalBodies: [],
    company: null,
    senderName: "Cristian Civita",
    locale: "es",
  });
  assert.equal(input.contact.connectedOn, "2024-01-01");
  assert.equal(input.notes?.length, 1);
  assert.match(input.notes![0]!, /5/);
  assert.doesNotMatch(input.notes![0]!, /VP Engineering/); // no message content, just counts/dates
});

test("signal bodies pass through as additional notes, after the connection summary", () => {
  const input = buildPersonMessageInput({
    person: BASE_PERSON,
    connection: null,
    signalBodies: ["Recently promoted to VP", "Posted about hiring backend engineers"],
    company: null,
    senderName: "Cristian Civita",
    locale: "es",
  });
  assert.deepEqual(input.notes, ["Recently promoted to VP", "Posted about hiring backend engineers"]);
});

test("senderTitle and locale pass through unchanged", () => {
  const input = buildPersonMessageInput({
    person: BASE_PERSON,
    connection: null,
    signalBodies: [],
    company: null,
    senderName: "Cristian Civita",
    senderTitle: "COO de Avalith",
    locale: "en",
  });
  assert.equal(input.senderTitle, "COO de Avalith");
  assert.equal(input.locale, "en");
});

test("a null roleGroup is not treated as leadership", () => {
  const input = buildPersonMessageInput({
    person: { ...BASE_PERSON, roleGroup: null },
    connection: null,
    signalBodies: [],
    company: null,
    senderName: "Cristian Civita",
    locale: "es",
  });
  assert.equal(input.contact.roleGroup, null);
  assert.equal(input.contact.isLeadership, false);
});
