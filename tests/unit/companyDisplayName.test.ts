import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyDisplayName, withResolvedCompanyName } from "@/lib/contacts/companyDisplayName";

// Bug fix (owner report: 7,132 contacts showed "—" in the Empresa column
// even though ~5,790 of them have a resolvable company via person.company_key
// -> company.display_name): the list never joined `company`, so it could
// only ever read the free-text `person.company` field. Rule: free text wins
// when present (do NOT prefer the canonical name over a non-null free text —
// that would change what ~19,000 contacts already display); the canonical
// name is only a fallback for the null case.

test("resolveCompanyDisplayName prefers the free-text company name when present", () => {
  assert.equal(resolveCompanyDisplayName("Acme Inc (legacy)", "Acme Inc"), "Acme Inc (legacy)");
});

test("resolveCompanyDisplayName falls back to the canonical name when free text is null", () => {
  assert.equal(resolveCompanyDisplayName(null, "Acme Inc"), "Acme Inc");
});

test("resolveCompanyDisplayName stays null when neither value is present (orphan key or no key)", () => {
  assert.equal(resolveCompanyDisplayName(null, null), null);
  assert.equal(resolveCompanyDisplayName(null, undefined), null);
});

test("resolveCompanyDisplayName never prefers the canonical name over a non-null free text, even when they disagree", () => {
  assert.equal(resolveCompanyDisplayName("Acme LLC", "Acme Incorporated"), "Acme LLC");
});

const FIXTURE_ROWS = [
  { id: "p1", company: "Acme LLC", companyCanonicalName: "Acme Incorporated" },
  { id: "p2", company: null, companyCanonicalName: "Beta Corp" },
  { id: "p3", company: null, companyCanonicalName: null },
] as const;

test("withResolvedCompanyName resolves each row's company field and drops companyCanonicalName", () => {
  const resolved = withResolvedCompanyName(FIXTURE_ROWS.map((r) => ({ ...r })));
  assert.deepEqual(
    resolved.map((r) => r.company),
    ["Acme LLC", "Beta Corp", null],
  );
  assert.ok(!("companyCanonicalName" in resolved[0]), "must not leak the join-only field through");
});

test("withResolvedCompanyName is pure: calling it twice on the same input yields the same result and never mutates the input", () => {
  const input = FIXTURE_ROWS.map((r) => ({ ...r }));
  const inputClone = FIXTURE_ROWS.map((r) => ({ ...r }));
  const first = withResolvedCompanyName(input);
  const second = withResolvedCompanyName(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, inputClone, "must not mutate its input rows");
});
