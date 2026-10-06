import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLeadDrafts } from "@/lib/leads/csv";
import { attendeeKey, FI_ARG_SOURCE_KEY, planFiArgBackfill, type FiArgPerson } from "@/lib/fiArgBackfill/plan";

// Synthetic fixtures, built through the real producer (buildLeadDrafts) so the mapping is tested against what the import used.
const ATTENDEES = [
  "first_name,last_name,job_title,seniority,company,industry,city,region,country,attendee_type,attendee_id",
  "Ana,Uno,CTO,C-Level,Acme Raw,Banking,Buenos Aires,CABA,Argentina,Speaker,a1",
  "Beto,Dos,Dev,Senior,Beta SA,Software,Cordoba,Cordoba,Argentina,Visitor,a2",
  "Cleo,Tres,PM,,Gamma,Retail,,,,Visitor,a3",
  "Dino,Cuatro,CEO,C-Level,Delta,Fintech,Rosario,Santa Fe,Argentina,Visitor,a4",
].join("\n");
const DECISORES = [
  "first_name,last_name,job_title,seniority,company,industry,city,region,country,attendee_type,attendee_id,company_group,company_display,owner",
  "Ana,Uno,CTO,C-Level,Acme Raw,Banking,Buenos Aires,CABA,Argentina,Speaker,a1,acme,Acme Display,Mariel",
].join("\n");

const drafts = () => buildLeadDrafts({ attendees: ATTENDEES, decisores: DECISORES });
const person = (id: string, attendeeId: string, over: Partial<FiArgPerson> = {}): FiArgPerson => ({
  id,
  attendeeId: attendeeKey(attendeeId),
  inScope: true,
  company: null,
  city: null,
  country: null,
  seniority: null,
  ...over,
});

test("fills the four empty fields; company prefers the display name, as the import did", () => {
  const { fills, report } = planFiArgBackfill(drafts(), [person("p1", "a1")]);
  const byField = Object.fromEntries(fills.filter((f) => f.personId === "p1").map((f) => [f.property, f.value]));
  assert.deepEqual(byField, { company: "Acme Display", city: "Buenos Aires", country: "Argentina", seniority: "C-Level" });
  assert.deepEqual(report.filled, { company: 1, city: 1, country: 1, seniority: 1 });
});

test("never overwrites a value that is already set, including whitespace-only as empty", () => {
  const { fills } = planFiArgBackfill(drafts(), [person("p2", "a2", { city: "Mendoza", company: "   " })]);
  const fields = fills.map((f) => f.property).sort();
  assert.deepEqual(fields, ["company", "country", "seniority"]);
  assert.equal(fills.find((f) => f.property === "company")!.value, "Beta SA");
});

test("an empty source value fills nothing", () => {
  const { fills, report } = planFiArgBackfill(drafts(), [person("p3", "a3")]);
  assert.deepEqual(fills.map((f) => f.property), ["company"]);
  assert.equal(report.filled.seniority, 0);
});

test("unmatched attendees and out-of-scope persons are counted, never guessed", () => {
  const { fills, report } = planFiArgBackfill(drafts(), [person("p4", "a4", { inScope: false })]);
  assert.equal(fills.length, 0);
  assert.equal(report.sourceRows, 4);
  assert.equal(report.unmatched, 3);
  assert.equal(report.outOfScope, 1);
});

test("two attendees on one person fill each empty field once, first attendee wins", () => {
  const { fills } = planFiArgBackfill(drafts(), [person("p1", "a1"), person("p1", "a2")]);
  assert.equal(fills.length, 4);
  assert.equal(fills.find((f) => f.property === "city")!.value, "Buenos Aires");
});

test("planner never mutates its inputs and is repeatable", () => {
  const d = drafts();
  const people = [person("p1", "a1"), person("p2", "a2", { city: "X" })];
  const snapshot = JSON.stringify([d, people]);
  assert.deepEqual(planFiArgBackfill(d, people), planFiArgBackfill(d, people));
  assert.equal(JSON.stringify([d, people]), snapshot);
});

test("source key constant is the one the import used", () => {
  assert.equal(FI_ARG_SOURCE_KEY, "fi-arg-2026");
});
