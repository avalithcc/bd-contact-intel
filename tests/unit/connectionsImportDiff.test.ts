import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyContactRows, contactDiffKey, type ExistingContactSnapshot, type ContactWriteRow } from "@/lib/contacts/connectionsDiff";

function incoming(overrides: Partial<ContactWriteRow> = {}): ContactWriteRow {
  return {
    bdId: "bd-1",
    profileKey: "linkedin.com/in/jane",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    position: "Head of Sales",
    email: null,
    connectedOn: "01 Jan 2025",
    roleGroup: "sales",
    companyCategory: "unclassified",
    companyKey: "acme",
    ...overrides,
  };
}

function stored(overrides: Partial<ExistingContactSnapshot> = {}): ExistingContactSnapshot {
  const { bdId: _bd, ...rest } = incoming();
  return { id: "c-1", mapped: true, industry: null, emailStatus: "none", emailConfidence: null, emailSource: null, ...rest, ...overrides };
}

function index(rows: ExistingContactSnapshot[]) {
  return new Map(rows.map((r) => [contactDiffKey(r.profileKey), r]));
}

test("classifyContactRows: a row absent from the stored index is new", () => {
  const out = classifyContactRows([incoming()], index([]));
  assert.equal(out.fresh.length, 1);
  assert.equal(out.changed.length, 0);
  assert.equal(out.unchanged.length, 0);
});

test("classifyContactRows: an identical row is unchanged and is not written", () => {
  const out = classifyContactRows([incoming()], index([stored()]));
  assert.equal(out.fresh.length + out.changed.length, 0);
  assert.equal(out.unchanged.length, 1);
  assert.equal(out.unchanged[0].existing.id, "c-1");
});

test("classifyContactRows: whitespace-only and blank-vs-null differences are not changes", () => {
  const out = classifyContactRows(
    [incoming({ firstName: " Jane ", email: "  ", position: "Head of Sales " })],
    index([stored({ email: null })]),
  );
  assert.equal(out.unchanged.length, 1);
});

test("classifyContactRows: a blank incoming email over a stored email is no change (the writer keeps the stored one)", () => {
  const out = classifyContactRows(
    [incoming({ email: null }), incoming({ profileKey: "linkedin.com/in/b", email: "  " })],
    index([stored({ email: "jane@acme.test" }), stored({ id: "c-2", profileKey: "linkedin.com/in/b", email: "b@acme.test" })]),
  );
  assert.equal(out.unchanged.length, 2);
  assert.equal(out.changed.length, 0);
});

test("classifyContactRows: a different non-blank incoming email is still a change", () => {
  const out = classifyContactRows([incoming({ email: "new@acme.test" })], index([stored({ email: "jane@acme.test" })]));
  assert.equal(out.changed.length, 1);
});

test("classifyContactRows: one differing field makes the row changed", () => {
  const out = classifyContactRows([incoming({ position: "CEO", roleGroup: "c_level" })], index([stored()]));
  assert.equal(out.changed.length, 1);
  assert.equal(out.unchanged.length, 0);
});

test("classifyContactRows: the derived company category counts as a change", () => {
  const out = classifyContactRows([incoming({ companyCategory: "fintech" })], index([stored()]));
  assert.equal(out.changed.length, 1);
});

test("classifyContactRows: a repeated profile key inside the batch collapses to the last row", () => {
  const out = classifyContactRows([incoming({ position: "A" }), incoming({ position: "B" })], index([]));
  assert.equal(out.fresh.length, 1);
  assert.equal(out.fresh[0].position, "B");
});

test("classifyContactRows: does not mutate its inputs and is repeatable", () => {
  const rows = [incoming(), incoming({ profileKey: "linkedin.com/in/new" })];
  const idx = index([stored()]);
  const snapshot = JSON.stringify({ rows, idx: [...idx] });
  const a = classifyContactRows(rows, idx);
  const b = classifyContactRows(rows, idx);
  assert.deepEqual(b, a);
  assert.equal(JSON.stringify({ rows, idx: [...idx] }), snapshot);
});
