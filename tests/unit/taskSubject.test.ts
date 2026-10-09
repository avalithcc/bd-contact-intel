/**
 * Unit tests for src/lib/tasks/subject.ts (mockup-port t02) — the pure
 * mapper behind the /tasks "Asociado con" column, which must show the real
 * contact or company name linked to its record instead of the generic
 * "Contacto"/"Empresa" label the previous reskin showed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTaskSubject } from "@/lib/tasks/subject";

test("a task with a personId and a person name resolves to the contact's full name, linked to /contacts/:id", () => {
  const subject = resolveTaskSubject({
    personId: "p1",
    companyKey: null,
    subjectPersonFirstName: "Joaquín",
    subjectPersonLastName: "Ortega",
    subjectPersonCompany: "Kavak",
    subjectCompanyName: null,
  });
  assert.deepEqual(subject, { label: "Joaquín Ortega · Kavak", href: "/contacts/p1" });
});

test("a person subject with no company on file omits the ' · company' suffix", () => {
  const subject = resolveTaskSubject({
    personId: "p1",
    companyKey: null,
    subjectPersonFirstName: "Joaquín",
    subjectPersonLastName: "Ortega",
    subjectPersonCompany: null,
    subjectCompanyName: null,
  });
  assert.deepEqual(subject, { label: "Joaquín Ortega", href: "/contacts/p1" });
});

test("a task with only a companyKey (no personId) resolves to the company's display name, linked to /companies/:key", () => {
  const subject = resolveTaskSubject({
    personId: null,
    companyKey: "kavak",
    subjectPersonFirstName: null,
    subjectPersonLastName: null,
    subjectPersonCompany: null,
    subjectCompanyName: "Kavak",
  });
  assert.deepEqual(subject, { label: "Kavak (empresa)", href: "/companies/kavak" });
});

test("a task with neither subject resolves to null so the caller can render an em dash", () => {
  const subject = resolveTaskSubject({
    personId: null,
    companyKey: null,
    subjectPersonFirstName: null,
    subjectPersonLastName: null,
    subjectPersonCompany: null,
    subjectCompanyName: null,
  });
  assert.equal(subject, null);
});

test("a joined person row missing (deleted/merged) falls back to null even if personId is set", () => {
  const subject = resolveTaskSubject({
    personId: "p1",
    companyKey: null,
    subjectPersonFirstName: null,
    subjectPersonLastName: null,
    subjectPersonCompany: null,
    subjectCompanyName: null,
  });
  assert.equal(subject, null);
});

test("a company subject's href percent-encodes the key", () => {
  const subject = resolveTaskSubject({
    personId: null,
    companyKey: "a b/c",
    subjectPersonFirstName: null,
    subjectPersonLastName: null,
    subjectPersonCompany: null,
    subjectCompanyName: "A B",
  });
  assert.equal(subject?.href, "/companies/a%20b%2Fc");
});
