/**
 * Unit tests for src/lib/identity/stuffedNameSplitBackfill.ts. Pure, no DB —
 * run with: npx tsx --test tests/unit/stuffedNameSplitBackfill.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNameCompanyKey } from "@/lib/identity/matcher";
import {
  buildStuffedNameSplitPlan,
  COMPANY_SUFFIX_WORDS,
  deriveStuffedNameSplit,
  OWNER_EXCLUDED_PERSON_IDS,
  type StuffedNameSplitCandidate,
} from "@/lib/identity/stuffedNameSplitBackfill";

function candidate(overrides: Partial<StuffedNameSplitCandidate> = {}): StuffedNameSplitCandidate {
  return {
    personId: "p1",
    firstName: "Leon Sacks",
    originalLastName: null,
    email: null,
    company: null,
    companyKey: null,
    ...overrides,
  };
}

// --- deriveStuffedNameSplit: fills -------------------------------------------

test("two tokens: first token is firstName, second is lastName", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Leon Sacks" }));
  assert.deepEqual(result, { kind: "fill", fill: { firstName: "Leon", lastName: "Sacks", rule: "two_tokens" } });
});

test("two tokens: an all-lowercase token is title-cased, a mixed-case one is kept as-is", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "mariano Vazquez" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Mariano", lastName: "Vazquez", rule: "two_tokens" },
  });
});

test("two tokens: an all-uppercase token is title-cased", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "MARIA JOSE" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Maria", lastName: "Jose", rule: "two_tokens" },
  });
});

test("two tokens: a single-letter initial with a period is kept, not treated as junk", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "j. Smith" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "J.", lastName: "Smith", rule: "two_tokens" },
  });
});

test("surname particle (single word) starts the last name — 'Claudio De Vita' never glues 'De' onto firstName", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Claudio De Vita" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Claudio", lastName: "De Vita", rule: "particle" },
  });
});

test("surname particle keeps its original (lowercase) casing even though the general rule would title-case a lowercase token", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Juan de la Cruz" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Juan", lastName: "de la Cruz", rule: "particle" },
  });
});

test("two-word particle 'van der' is recognised", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Johan van der Berg" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Johan", lastName: "van der Berg", rule: "particle" },
  });
});

test("'mc'/'mac' are explicitly NOT particles — a 3-token name with 'Mc' is ambiguous like any other 3-token name, never specially split", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Ronald Mc Donald" }));
  assert.deepEqual(result, { kind: "skip", reason: "ambiguous_3" });
});

test("4 tokens without a particle and without a resolving email: 2 given names + 2 surnames heuristic, flagged heuristic_4", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Sonia Mercedes Peñarete Ortiz" }));
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Sonia Mercedes", lastName: "Peñarete Ortiz", rule: "heuristic_4" },
  });
});

test("3 tokens without a particle and without an email: ambiguous, skipped rather than guessed", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Maria Laura Fantoni" }));
  assert.deepEqual(result, { kind: "skip", reason: "ambiguous_3" });
});

test("email tie-breaker resolves a 3-token name: 'jose.a.patino' identifies given name 'Jose Antonio'", () => {
  const result = deriveStuffedNameSplit(
    candidate({ firstName: "Jose Antonio Patiño", email: "jose.a.patino@example.com" }),
  );
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Jose Antonio", lastName: "Patiño", rule: "email_resolved" },
  });
});

test("email tie-breaker resolves a 4-token name over the heuristic when it disambiguates", () => {
  const result = deriveStuffedNameSplit(
    candidate({
      firstName: "Jose Antonio Patiño Iannuzzelli",
      email: "jose.a.patino@example.com",
    }),
  );
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Jose Antonio", lastName: "Patiño Iannuzzelli", rule: "email_resolved" },
  });
});

test("email tie-breaker: first email token matches firstName token and second matches a later token", () => {
  const result = deriveStuffedNameSplit(
    candidate({ firstName: "Rafael Eduardo Murillo Garcia", email: "rafael.garcia@example.com" }),
  );
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Rafael Eduardo Murillo", lastName: "Garcia", rule: "email_resolved" },
  });
});

test("email present but doesn't resolve (no token matches) falls back to the structural rule for 4 tokens", () => {
  const result = deriveStuffedNameSplit(
    candidate({ firstName: "Sonia Mercedes Peñarete Ortiz", email: "unrelated.mailbox@example.com" }),
  );
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Sonia Mercedes", lastName: "Peñarete Ortiz", rule: "heuristic_4" },
  });
});

test("5+ tokens without a particle and without a resolving email: ambiguous, skipped", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Maria Jose Fernandez Santos Lopez" }));
  assert.deepEqual(result, { kind: "skip", reason: "ambiguous_many" });
});

// --- deriveStuffedNameSplit: junk skips --------------------------------------

test("a token with a digit is junk, never guessed at", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "John3 Smith" }));
  assert.deepEqual(result, { kind: "skip", reason: "junk_digit" });
});

test("an '@' anywhere is junk", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "john@x Smith" }));
  assert.deepEqual(result, { kind: "skip", reason: "junk_at" });
});

test("a URL is junk_punctuation, not guessed as a two-token name", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "https://arcticgrey.com/" }));
  assert.equal(result.kind, "skip");
  assert.equal((result as { reason: string }).reason, "junk_punctuation");
});

test("a LinkedIn 'view profile' scrape artifact (name duplicated, no separating space) is junk, never split on the 'de' it happens to contain", () => {
  const result = deriveStuffedNameSplit(
    candidate({ firstName: "Victor Gomez de la cruzVer el perfil de Victor Gomez de la cruz" }),
  );
  assert.deepEqual(result, { kind: "skip", reason: "junk_scrape_artifact" });
});

test("a bare domain-like value (no protocol) is still junk_punctuation via the period rule", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "arcticgrey.com" }));
  assert.deepEqual(result, { kind: "skip", reason: "junk_punctuation" });
});

test("a company suffix word (e.g. 'Inc') anywhere marks the value as a company, not a person", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Global Solutions Inc" }));
  assert.deepEqual(result, { kind: "skip", reason: "looks_like_company" });
});

test("a value matching the person's own company (company field) is looks_like_company even with no suffix word", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Smart Gen", company: "Smart Gen" }));
  assert.deepEqual(result, { kind: "skip", reason: "looks_like_company" });
});

test("an owner-excluded person id is skipped as owner_excluded even though the value passes every structural rule", () => {
  const excludedId = [...OWNER_EXCLUDED_PERSON_IDS][0]!;
  const result = deriveStuffedNameSplit(
    candidate({ personId: excludedId, firstName: "Smart Gen", company: null, companyKey: null }),
  );
  assert.deepEqual(result, { kind: "skip", reason: "owner_excluded" });
});

test("OWNER_EXCLUDED_PERSON_IDS contains the 'Smart Gen' person, matched by id — never by name", () => {
  assert.ok(OWNER_EXCLUDED_PERSON_IDS.has("add5bf2d-6671-4a87-8254-bb3953699afb"));
});

test("a different person with the exact same 'Smart Gen' text is NOT excluded — the match is by id, not by name", () => {
  const result = deriveStuffedNameSplit(
    candidate({ personId: "some-other-person-id", firstName: "Smart Gen", company: null, companyKey: null }),
  );
  assert.deepEqual(result, { kind: "fill", fill: { firstName: "Smart", lastName: "Gen", rule: "two_tokens" } });
});

test("a value matching the person's own companyKey is looks_like_company", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "Smart Gen", companyKey: "smart gen" }));
  assert.deepEqual(result, { kind: "skip", reason: "looks_like_company" });
});

test("COMPANY_SUFFIX_WORDS is a short explicit list, not a broad heuristic", () => {
  assert.ok(COMPANY_SUFFIX_WORDS.has("solutions"));
  assert.ok(COMPANY_SUFFIX_WORDS.has("inc"));
  assert.ok(!COMPANY_SUFFIX_WORDS.has("mc"));
});

test("a single token after collapsing whitespace is skipped, never padded with a fabricated surname", () => {
  const result = deriveStuffedNameSplit(candidate({ firstName: "  Madonna  " }));
  assert.deepEqual(result, { kind: "skip", reason: "single_token" });
});

// --- name+company key invariance (why no duplicate_candidate is queued) -----

test("splitting a stuffed name never changes buildNameCompanyKey — first+last re-concatenates to the same normalized string", () => {
  const before = buildNameCompanyKey({
    firstName: "Colette Harington",
    lastName: null,
    company: null,
    companyKey: "acme",
  });
  const result = deriveStuffedNameSplit(candidate({ firstName: "Colette Harington", companyKey: "acme" }));
  assert.equal(result.kind, "fill");
  const fill = (result as { fill: { firstName: string; lastName: string } }).fill;
  const after = buildNameCompanyKey({
    firstName: fill.firstName,
    lastName: fill.lastName,
    company: null,
    companyKey: "acme",
  });
  assert.equal(before, after);
});

// --- buildStuffedNameSplitPlan -----------------------------------------------

test("buildStuffedNameSplitPlan splits candidates into fills and skips, preserving personId", () => {
  const plan = buildStuffedNameSplitPlan([
    candidate({ personId: "p1", firstName: "Leon Sacks" }),
    candidate({ personId: "p2", firstName: "Maria Laura Fantoni" }),
  ]);
  assert.equal(plan.fills.length, 1);
  assert.equal(plan.fills[0]!.personId, "p1");
  assert.equal(plan.skips.length, 1);
  assert.equal(plan.skips[0]!.personId, "p2");
  assert.equal(plan.skips[0]!.reason, "ambiguous_3");
});

test("buildStuffedNameSplitPlan never mutates its input candidates array", () => {
  const input = [candidate({ personId: "p1", firstName: "Leon Sacks" })];
  const before = JSON.parse(JSON.stringify(input));
  buildStuffedNameSplitPlan(input);
  assert.deepEqual(input, before);
});

test("buildStuffedNameSplitPlan called twice with the same input returns the same result", () => {
  const input = [
    candidate({ personId: "p1", firstName: "Leon Sacks" }),
    candidate({ personId: "p2", firstName: "Claudio De Vita" }),
  ];
  const first = buildStuffedNameSplitPlan(input);
  const second = buildStuffedNameSplitPlan(input);
  assert.deepEqual(first, second);
});
