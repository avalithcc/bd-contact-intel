/**
 * Unit tests for src/lib/identity/stuffedNameFirstTokenSplit.ts. Pure, no DB —
 * run with: npx tsx --test tests/unit/stuffedNameFirstTokenSplit.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StuffedNameSplitCandidate } from "@/lib/identity/stuffedNameSplitBackfill";
import {
  buildFirstTokenSplitPlan,
  classifyForFirstTokenSplit,
  deriveFirstTokenSplit,
  NON_PERSON_SINGLE_TOKENS,
  stripLinkedInScrapeArtifact,
} from "@/lib/identity/stuffedNameFirstTokenSplit";

function candidate(overrides: Partial<StuffedNameSplitCandidate> = {}): StuffedNameSplitCandidate {
  return {
    personId: "p1",
    firstName: "Julián Zamudio Lemos",
    originalLastName: null,
    email: null,
    company: null,
    companyKey: null,
    ...overrides,
  };
}

// --- deriveFirstTokenSplit: the pure splitting rule in isolation -------------
// (bypasses classifyForFirstTokenSplit's gate — see the gate tests below for
// what actually reaches production candidates)

test("plain rule: first word is firstName, everything after is lastName (task sample)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Julián Zamudio Lemos" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Julián", lastName: "Zamudio Lemos", rule: "plain" },
  });
});

test("plain rule: no special casing for a third token that isn't an initial (task sample)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Yuri Jean Fabris" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Yuri", lastName: "Jean Fabris", rule: "plain" },
  });
});

test("middle initial with a trailing period stays with the first name (task sample)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Augusto D. Schultheis" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Augusto D.", lastName: "Schultheis", rule: "middle_initial" },
  });
});

test("middle initial without a trailing period stays with the first name (task sample)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Jose F. Gomez" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Jose F.", lastName: "Gomez", rule: "middle_initial" },
  });
});

test("middle initial rule matches a single letter with NO trailing period too", () => {
  const result = deriveFirstTokenSplit({ firstName: "Maria J Lopez" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Maria J", lastName: "Lopez", rule: "middle_initial" },
  });
});

test("anything after a comma is a credential/title and is dropped (task sample)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Kimberly West-Philips, SHRM-CP" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Kimberly", lastName: "West-Philips", rule: "plain" },
  });
});

test("hyphenated last name is kept as a single last-name token", () => {
  const result = deriveFirstTokenSplit({ firstName: "Kimberly West-Philips" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Kimberly", lastName: "West-Philips", rule: "plain" },
  });
});

test("leading/trailing/internal whitespace is trimmed and collapsed before splitting", () => {
  const result = deriveFirstTokenSplit({ firstName: "  Julián   Zamudio  Lemos  " });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Julián", lastName: "Zamudio Lemos", rule: "plain" },
  });
});

test("a value that becomes a single token after trimming is not split", () => {
  const result = deriveFirstTokenSplit({ firstName: "  Yuri  " });
  assert.deepEqual(result, {
    kind: "skip",
    reason: "single_token",
    detail: { isDigitsOnly: false, isCommonNonPersonWord: false },
  });
});

test("a single token that is a common non-person word is flagged for the needs-review section (task sample)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Pagos" });
  assert.deepEqual(result, {
    kind: "skip",
    reason: "single_token",
    detail: { isDigitsOnly: false, isCommonNonPersonWord: true },
  });
  assert.ok(NON_PERSON_SINGLE_TOKENS.has("pagos"));
});

test("a single token that is all digits is flagged as digits for the needs-review section", () => {
  const result = deriveFirstTokenSplit({ firstName: "12345" });
  assert.deepEqual(result, {
    kind: "skip",
    reason: "single_token",
    detail: { isDigitsOnly: true, isCommonNonPersonWord: false },
  });
});

test("a comma with nothing usable before it collapses to zero tokens and is skipped, not split", () => {
  const result = deriveFirstTokenSplit({ firstName: ", SHRM-CP" });
  assert.deepEqual(result, {
    kind: "skip",
    reason: "single_token",
    detail: { isDigitsOnly: false, isCommonNonPersonWord: false },
  });
});

// --- deriveFirstTokenSplit: bare-initial last name is never fabricated ------
// (review fix) a 2-token value whose 2nd token is only a single letter isn't
// a real surname — routed to needs review instead of guessing.

test("a 2-token value whose 2nd token is a bare initial is NOT split (review fix, sample 'Ana J')", () => {
  const result = deriveFirstTokenSplit({ firstName: "Ana J" });
  assert.deepEqual(result, {
    kind: "skip",
    reason: "bare_initial_last_name",
    detail: { isDigitsOnly: false, isCommonNonPersonWord: false },
  });
});

test("a 2-token value whose 2nd token is a bare initial WITH a period is NOT split (review fix, sample 'Juan D.')", () => {
  const result = deriveFirstTokenSplit({ firstName: "Juan D." });
  assert.deepEqual(result, {
    kind: "skip",
    reason: "bare_initial_last_name",
    detail: { isDigitsOnly: false, isCommonNonPersonWord: false },
  });
});

test("a 2-token value whose 2nd token is a REAL last name (not a bare initial) is still split normally", () => {
  const result = deriveFirstTokenSplit({ firstName: "Leon Sacks" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Leon", lastName: "Sacks", rule: "plain" },
  });
});

// --- classifyForFirstTokenSplit: reuses the EXISTING classifier as a safety
// gate (review fix) — only rows the ORIGINAL rule calls "ambiguous_3" /
// "ambiguous_many" may be split here. Everything else (company names, junk,
// particles, and rows the original rule could already resolve) is routed to
// needs review, unsplit.

test("a genuinely ambiguous 3-token name (no company/particle/junk signal) is eligible", () => {
  assert.deepEqual(classifyForFirstTokenSplit(candidate({ firstName: "Julián Zamudio Lemos" })), {
    kind: "eligible",
  });
});

test("a 5+ token name with no particle is eligible (ambiguous_many)", () => {
  assert.deepEqual(classifyForFirstTokenSplit(candidate({ firstName: "Ana Maria Rodriguez Sanchez Smith" })), {
    kind: "eligible",
  });
});

test("a company-suffix name is NEVER eligible, even though it has 3 whitespace-separated tokens (review CRITICAL fix)", () => {
  const result = classifyForFirstTokenSplit(candidate({ firstName: "Acme Consulting Group" }));
  assert.deepEqual(result, { kind: "ineligible", reason: "looks_like_company" });
});

test("a name matching the person's own companyKey is NEVER eligible", () => {
  const result = classifyForFirstTokenSplit(
    candidate({ firstName: "Acme Solutions Inc", companyKey: "acmesolutionsinc" }),
  );
  assert.deepEqual(result, { kind: "ineligible", reason: "looks_like_company" });
});

test("a name containing a digit is NEVER eligible (junk)", () => {
  const result = classifyForFirstTokenSplit(candidate({ firstName: "John3 Smith Jones" }));
  assert.deepEqual(result, { kind: "ineligible", reason: "junk_digit" });
});

test("a name containing '@' is NEVER eligible (junk)", () => {
  const result = classifyForFirstTokenSplit(candidate({ firstName: "john@example.com Smith Jones" }));
  assert.deepEqual(result, { kind: "ineligible", reason: "junk_at" });
});

test("a surname-particle-first name is NEVER eligible (reversed/garbled data)", () => {
  const result = classifyForFirstTokenSplit(candidate({ firstName: "De La Hoya Fulano" }));
  assert.deepEqual(result, { kind: "ineligible", reason: "particle_first" });
});

test("a name the ORIGINAL rule can already resolve (e.g. a clean 2-token name) is routed to needs review, not re-split here", () => {
  const result = classifyForFirstTokenSplit(candidate({ firstName: "Leon Sacks" }));
  assert.deepEqual(result, { kind: "ineligible", reason: "resolvable_by_original_rule" });
});

test("a name the ORIGINAL rule already resolves via its particle rule is routed to needs review, not re-split here", () => {
  const result = classifyForFirstTokenSplit(candidate({ firstName: "Juan de la Cruz" }));
  assert.deepEqual(result, { kind: "ineligible", reason: "resolvable_by_original_rule" });
});

// --- buildFirstTokenSplitPlan: gate + rule wired together --------------------

test("buildFirstTokenSplitPlan splits only gate-eligible candidates, routing everything else to needs review with the gate's reason", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({ personId: "p1", firstName: "Julián Zamudio Lemos" }),
    candidate({ personId: "p2", firstName: "Acme Consulting Group" }),
    candidate({ personId: "p3", firstName: "Pagos" }),
    candidate({ personId: "p4", firstName: "Leon Sacks" }),
  ]);
  assert.deepEqual(plan.fills, [
    {
      personId: "p1",
      originalFirstName: "Julián Zamudio Lemos",
      originalLastName: null,
      firstName: "Julián",
      lastName: "Zamudio Lemos",
      rule: "plain",
    },
  ]);
  assert.deepEqual(plan.skips, [
    {
      personId: "p2",
      originalFirstName: "Acme Consulting Group",
      reason: "looks_like_company",
      isDigitsOnly: false,
      isCommonNonPersonWord: false,
    },
    {
      personId: "p3",
      originalFirstName: "Pagos",
      reason: "single_token",
      isDigitsOnly: false,
      isCommonNonPersonWord: true,
    },
    {
      personId: "p4",
      originalFirstName: "Leon Sacks",
      reason: "resolvable_by_original_rule",
      isDigitsOnly: false,
      isCommonNonPersonWord: false,
    },
  ]);
});

test("a comma-suffixed credential is NOT split by buildFirstTokenSplitPlan today — the gate's raw-string charset check flags it junk_punctuation BEFORE the comma-drop rule ever runs (documented, conservative tradeoff from the review fix)", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({ personId: "p1", firstName: "Kimberly West-Philips, SHRM-CP" }),
  ]);
  assert.deepEqual(plan.fills, []);
  assert.deepEqual(plan.skips, [
    {
      personId: "p1",
      originalFirstName: "Kimberly West-Philips, SHRM-CP",
      reason: "junk_punctuation",
      isDigitsOnly: false,
      isCommonNonPersonWord: false,
    },
  ]);
});

test("buildFirstTokenSplitPlan never mutates its input", () => {
  const input = [
    candidate({ personId: "p1", firstName: "Julián Zamudio Lemos" }),
    candidate({ personId: "p2", firstName: "Pagos" }),
  ];
  const before = JSON.parse(JSON.stringify(input));
  buildFirstTokenSplitPlan(input);
  assert.deepEqual(input, before);
});

test("buildFirstTokenSplitPlan called twice with the same input returns the same result", () => {
  const input = [
    candidate({ personId: "p1", firstName: "Julián Zamudio Lemos" }),
    candidate({ personId: "p2", firstName: "Augusto D. Schultheis" }),
    candidate({ personId: "p3", firstName: "Pagos" }),
  ];
  const first = buildFirstTokenSplitPlan(input);
  const second = buildFirstTokenSplitPlan(input);
  assert.deepEqual(first, second);
});

// --- compound given name rule (owner ask, 2026-09-30) ------------------------
// When the SECOND token of an otherwise-ambiguous name is a common given
// name, it belongs to the first name — but only when a token still remains
// for the last name.

test("compound given name: 'Maria Sol Gonzalez' -> 'Maria Sol' / 'Gonzalez'", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Maria Sol Gonzalez" }), {
    kind: "fill",
    fill: { firstName: "Maria Sol", lastName: "Gonzalez", rule: "compound_given_name" },
  });
});

test("compound given name: 'Juan Pablo Bonilla' -> 'Juan Pablo' / 'Bonilla'", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Juan Pablo Bonilla" }), {
    kind: "fill",
    fill: { firstName: "Juan Pablo", lastName: "Bonilla", rule: "compound_given_name" },
  });
});

test("compound given name is accent-insensitive: 'Carlos Andrés Toro' -> 'Carlos Andrés' / 'Toro'", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Carlos Andrés Toro" }), {
    kind: "fill",
    fill: { firstName: "Carlos Andrés", lastName: "Toro", rule: "compound_given_name" },
  });
});

test("compound given name: 'Joao Paulo Fonseca' -> 'Joao Paulo' / 'Fonseca'", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Joao Paulo Fonseca" }), {
    kind: "fill",
    fill: { firstName: "Joao Paulo", lastName: "Fonseca", rule: "compound_given_name" },
  });
});

test("compound given name applies to a 5+ token name too: 'Rubens Andre Pinto Moreira Piedras' -> 'Rubens Andre' / 'Pinto Moreira Piedras'", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Rubens Andre Pinto Moreira Piedras" }), {
    kind: "fill",
    fill: { firstName: "Rubens Andre", lastName: "Pinto Moreira Piedras", rule: "compound_given_name" },
  });
});

test("a 2nd token that is NOT a common given name (e.g. a surname like 'Vicente') does not trigger the rule", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Alicia Vicente Andrés" }), {
    kind: "fill",
    fill: { firstName: "Alicia", lastName: "Vicente Andrés", rule: "plain" },
  });
});

test("a 2nd token that is NOT a common given name at all stays with the plain rule (e.g. 'Castro' in 'Gonzalo Castro Peña')", () => {
  assert.deepEqual(deriveFirstTokenSplit({ firstName: "Gonzalo Castro Peña" }), {
    kind: "fill",
    fill: { firstName: "Gonzalo", lastName: "Castro Peña", rule: "plain" },
  });
});

// --- gate + compound given name wired together -------------------------------

test("buildFirstTokenSplitPlan: an ambiguous_3 candidate whose 2nd token is a common given name is split via compound_given_name", () => {
  const plan = buildFirstTokenSplitPlan([candidate({ personId: "p1", firstName: "Julio Andrés Guzmán" })]);
  assert.deepEqual(plan.fills, [
    {
      personId: "p1",
      originalFirstName: "Julio Andrés Guzmán",
      originalLastName: null,
      firstName: "Julio Andrés",
      lastName: "Guzmán",
      rule: "compound_given_name",
    },
  ]);
  assert.deepEqual(plan.skips, []);
});

// --- LinkedIn scrape-artifact cleanup (owner ask, 2026-09-30) ----------------
// "<Name>Ver el perfil de <Name>" where the prefix equals the repeated name:
// strip the suffix, then split the cleaned name — bypassing the classifier
// gate entirely, since detecting this exact repeated-name shape is itself
// enough confidence this is a real person (never a company).

test("stripLinkedInScrapeArtifact extracts the cleaned name when the prefix equals the repeated suffix name", () => {
  assert.equal(stripLinkedInScrapeArtifact("Sarah WilsonVer el perfil de Sarah Wilson"), "Sarah Wilson");
});

test("stripLinkedInScrapeArtifact is case-insensitive on the connecting phrase", () => {
  assert.equal(stripLinkedInScrapeArtifact("Sarah WilsonVER EL PERFIL DE Sarah Wilson"), "Sarah Wilson");
});

test("stripLinkedInScrapeArtifact returns null when the phrase isn't present", () => {
  assert.equal(stripLinkedInScrapeArtifact("Sarah Wilson"), null);
});

test("stripLinkedInScrapeArtifact returns null when the prefix does NOT equal the repeated name (refuses to guess)", () => {
  assert.equal(stripLinkedInScrapeArtifact("Sarah WilsonVer el perfil de Someone Else"), null);
});

test("buildFirstTokenSplitPlan splits a LinkedIn-artifact 2-token name via the plain rule, bypassing the gate (task sample)", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({ personId: "p1", firstName: "Sarah WilsonVer el perfil de Sarah Wilson" }),
  ]);
  assert.deepEqual(plan.fills, [
    {
      personId: "p1",
      originalFirstName: "Sarah WilsonVer el perfil de Sarah Wilson",
      originalLastName: null,
      firstName: "Sarah",
      lastName: "Wilson",
      rule: "plain",
    },
  ]);
});

test("buildFirstTokenSplitPlan splits a LinkedIn-artifact name via the given-name rule (task sample)", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({ personId: "p1", firstName: "Hector Damian LemaVer el perfil de Hector Damian Lema" }),
  ]);
  assert.deepEqual(plan.fills, [
    {
      personId: "p1",
      originalFirstName: "Hector Damian LemaVer el perfil de Hector Damian Lema",
      originalLastName: null,
      firstName: "Hector Damian",
      lastName: "Lema",
      rule: "compound_given_name",
    },
  ]);
});

test("buildFirstTokenSplitPlan splits a LinkedIn-artifact name with a particle via the PLAIN rule, bypassing the gate — the gate's particle rule would otherwise produce a different (wrong) split (task sample)", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({ personId: "p1", firstName: "Victor Gomez de la cruzVer el perfil de Victor Gomez de la cruz" }),
  ]);
  assert.deepEqual(plan.fills, [
    {
      personId: "p1",
      originalFirstName: "Victor Gomez de la cruzVer el perfil de Victor Gomez de la cruz",
      originalLastName: null,
      firstName: "Victor",
      lastName: "Gomez de la cruz",
      rule: "plain",
    },
  ]);
});

// --- manual overrides take priority over everything else (owner ask, 2026-09-30) ---

test("buildFirstTokenSplitPlan applies a manual override even though the raw value would otherwise be gate-ineligible (junk_punctuation)", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({
      personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0",
      firstName: "Kimberly West-Philips, SHRM-CP",
    }),
  ]);
  assert.deepEqual(plan.fills, [
    {
      personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0",
      originalFirstName: "Kimberly West-Philips, SHRM-CP",
      originalLastName: null,
      firstName: "Kimberly",
      lastName: "West-Philips",
      rule: "manual_override",
    },
  ]);
  assert.deepEqual(plan.skips, []);
});

test("buildFirstTokenSplitPlan applies the Smart Gen override: first_name NULL and createCompany carried on the fill", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({
      personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
      firstName: "Smart Gen",
      originalLastName: null,
    }),
  ]);
  assert.deepEqual(plan.fills, [
    {
      personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
      originalFirstName: "Smart Gen",
      originalLastName: null,
      firstName: null,
      lastName: null,
      rule: "manual_override",
      createCompany: { displayName: "Smart Gen" },
    },
  ]);
});
