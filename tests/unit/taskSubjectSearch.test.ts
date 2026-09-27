/**
 * Unit tests for src/lib/tasks/subjectSearch.ts (mockup-port t04) — the pure
 * row mappers behind the "Nueva tarea" dialog's subject picker, which
 * searches contacts by name and lets the BD pick a contact or a company as
 * the new task's subject.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { personSubjectSearchResult, companySubjectSearchResult } from "@/lib/tasks/subjectSearch";

test("personSubjectSearchResult labels a contact as 'Full Name · Company' when a company is on file", () => {
  const result = personSubjectSearchResult({
    id: "p1",
    firstName: "Joaquín",
    lastName: "Ortega",
    company: "Kavak",
  });
  assert.deepEqual(result, { type: "person", id: "p1", label: "Joaquín Ortega · Kavak" });
});

test("personSubjectSearchResult omits the company suffix when there is none", () => {
  const result = personSubjectSearchResult({ id: "p1", firstName: "Joaquín", lastName: "Ortega", company: null });
  assert.deepEqual(result, { type: "person", id: "p1", label: "Joaquín Ortega" });
});

test("personSubjectSearchResult falls back to the id when both names are missing, never a blank label", () => {
  const result = personSubjectSearchResult({ id: "p1", firstName: null, lastName: null, company: null });
  assert.deepEqual(result, { type: "person", id: "p1", label: "p1" });
});

test("companySubjectSearchResult labels a company by its display name", () => {
  const result = companySubjectSearchResult({ companyKey: "kavak", displayName: "Kavak" });
  assert.deepEqual(result, { type: "company", id: "kavak", label: "Kavak" });
});
