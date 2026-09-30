/**
 * Unit tests for src/lib/identity/emailPatternInferenceBackfill.ts. Pure, no
 * DB — run with: npx tsx --test tests/unit/emailPatternInferenceBackfill.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEmailPatternInferencePlan,
  detectDominantPattern,
  filterExistingCollisions,
  hasMultipleNameTokens,
  normalizeNamePart,
  resolveCandidateDomain,
  type InferenceCandidate,
} from "@/lib/identity/emailPatternInferenceBackfill";

// --- normalizeNamePart -------------------------------------------------

test("normalizeNamePart strips accents (NFD), lowercases, keeps only a-z", () => {
  assert.equal(normalizeNamePart("Martín"), "martin");
  assert.equal(normalizeNamePart("José María"), "josemaria");
  assert.equal(normalizeNamePart("O'Higgins"), "ohiggins");
});

// --- hasMultipleNameTokens (particle/compound surname skip) -----------

test("hasMultipleNameTokens flags a particle surname", () => {
  assert.equal(hasMultipleNameTokens("de la Fuente"), true);
  assert.equal(hasMultipleNameTokens("Da Silva"), true);
  assert.equal(hasMultipleNameTokens("Pérez-Gómez"), true);
  assert.equal(hasMultipleNameTokens("Romero"), false);
});

// --- detectDominantPattern ----------------------------------------------

test("detects first.last as dominant with 80%+ agreement", () => {
  const result = detectDominantPattern([
    { firstName: "Efrain", lastName: "Romero", email: "efrain.romero@storicard.com" },
    { firstName: "Ana", lastName: "Gomez", email: "ana.gomez@storicard.com" },
    { firstName: "Luis", lastName: "Diaz", email: "luis.diaz@storicard.com" },
    { firstName: "Marta", lastName: "Vidal", email: "marta.vidal@storicard.com" },
    { firstName: "Maria", lastName: "Cruz", email: "unknownformat@storicard.com" }, // matches no pattern
  ]);
  assert.ok(result);
  assert.equal(result?.patternId, "first.last");
  assert.equal(result?.matched, 4);
  assert.equal(result?.total, 5);
});

test("fewer than 2 known emails never qualifies", () => {
  const result = detectDominantPattern([{ firstName: "Efrain", lastName: "Romero", email: "efrain.romero@x.com" }]);
  assert.equal(result, null);
});

test("below 80% agreement never qualifies (no single pattern dominates)", () => {
  const result = detectDominantPattern([
    { firstName: "Efrain", lastName: "Romero", email: "efrain.romero@x.com" }, // first.last
    { firstName: "Ana", lastName: "Gomez", email: "agomez@x.com" }, // flast
    { firstName: "Luis", lastName: "Diaz", email: "ldiaz@x.com" }, // flast
    { firstName: "Maria", lastName: "Cruz", email: "cruz@x.com" }, // last
    { firstName: "Jose", lastName: "Perez", email: "jose@x.com" }, // first
  ]);
  // Best pattern here ("flast", 2/5 = 40%) is well under 80%.
  assert.equal(result, null);
});

test("examples with a multi-token first OR last name are excluded from both numerator and denominator (learning symmetry with the skip-on-apply rule)", () => {
  const result = detectDominantPattern([
    { firstName: "Efrain", lastName: "Romero", email: "efrain.romero@x.com" },
    { firstName: "Ana", lastName: "Gomez", email: "ana.gomez@x.com" },
    // Multi-token first name: excluded even though its local part happens
    // to look like it agrees with the winning pattern once concatenated.
    { firstName: "Juan Pablo", lastName: "Ruiz", email: "juanpablo.ruiz@x.com" },
    // Multi-token (particle) last name: same exclusion.
    { firstName: "Luis", lastName: "de la Fuente", email: "luis.delafuente@x.com" },
  ]);
  assert.ok(result);
  assert.equal(result?.total, 2);
  assert.equal(result?.matched, 2);
});

test("examples missing a first or last name are excluded from both numerator and denominator", () => {
  const result = detectDominantPattern([
    { firstName: "Efrain", lastName: "Romero", email: "efrain.romero@x.com" },
    { firstName: "Ana", lastName: "Gomez", email: "ana.gomez@x.com" },
    { firstName: null, lastName: "NoFirst", email: "whatever@x.com" },
  ]);
  assert.ok(result);
  assert.equal(result?.total, 2);
});

// --- resolveCandidateDomain ----------------------------------------------

test("resolveCandidateDomain prefers company.domain over colleague emails", () => {
  const domain = resolveCandidateDomain("Storicard.com", [{ email: "a@other.com" }]);
  assert.equal(domain, "storicard.com");
});

test("resolveCandidateDomain falls back to the most common non-personal colleague domain", () => {
  const domain = resolveCandidateDomain(null, [
    { email: "a@storicard.com" },
    { email: "b@storicard.com" },
    { email: "c@gmail.com" },
  ]);
  assert.equal(domain, "storicard.com");
});

test("resolveCandidateDomain returns null when every colleague domain is personal", () => {
  const domain = resolveCandidateDomain(null, [{ email: "a@gmail.com" }, { email: "b@hotmail.com" }]);
  assert.equal(domain, null);
});

// --- buildEmailPatternInferencePlan (full planner) ------------------------

function colleagues(domain: string, n: number): { firstName: string; lastName: string; email: string }[] {
  const names = ["Efrain Romero", "Ana Gomez", "Luis Diaz", "Marta Vidal", "Pedro Ruiz"];
  return names.slice(0, n).map((full) => {
    const [first, last] = full.split(" ");
    return { firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}` };
  });
}

test("fills a candidate whose company has a dominant first.last pattern", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "Suarez",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.equal(plan.skips.length, 0);
  assert.equal(plan.fills.length, 1);
  assert.equal(plan.fills[0].email, "martin.suarez@acme.com");
  assert.equal(plan.fills[0].patternId, "first.last");
});

test("skips a multi-token (particle) surname rather than guessing", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "de la Fuente",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.equal(plan.fills.length, 0);
  assert.deepEqual(plan.skips, [{ personId: "p1", reason: "multi_token_surname" }]);
});

test("skips a multi-token compound first name rather than guessing (symmetric with surnames)", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Juan Pablo",
      lastName: "Perez",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
    {
      personId: "p2",
      firstName: "Ana-María",
      lastName: "Diaz",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.equal(plan.fills.length, 0);
  assert.deepEqual(plan.skips, [
    { personId: "p1", reason: "multi_token_first_name" },
    { personId: "p2", reason: "multi_token_first_name" },
  ]);
});

test("skips a candidate missing a first or last name", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.deepEqual(plan.skips, [{ personId: "p1", reason: "missing_name" }]);
});

test("skips when the resolved domain is a personal-mail provider", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "Suarez",
      companyKey: "acme",
      companyDomain: "gmail.com",
      colleagueEmails: [],
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.deepEqual(plan.skips, [{ personId: "p1", reason: "personal_domain" }]);
});

test("skips when no dominant pattern can be confirmed (insufficient evidence)", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "Suarez",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 1),
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.deepEqual(plan.skips, [{ personId: "p1", reason: "no_dominant_pattern" }]);
});

test("two candidates that would collide with EACH OTHER are both skipped, never applied", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "Suarez",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
    {
      personId: "p2",
      firstName: "Martin",
      lastName: "Suarez",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
  ];
  const plan = buildEmailPatternInferencePlan(candidates);
  assert.equal(plan.fills.length, 0);
  assert.equal(plan.skips.length, 2);
  assert.ok(plan.skips.every((s) => s.reason === "in_run_collision"));
});

test("planner is pure: calling it twice with the same input never mutates and gives the same result", () => {
  const candidates: InferenceCandidate[] = [
    {
      personId: "p1",
      firstName: "Martín",
      lastName: "Suarez",
      companyKey: "acme",
      companyDomain: "acme.com",
      colleagueEmails: colleagues("acme.com", 4),
    },
  ];
  const snapshot = JSON.parse(JSON.stringify(candidates));
  const first = buildEmailPatternInferencePlan(candidates);
  const second = buildEmailPatternInferencePlan(candidates);
  assert.deepEqual(candidates, snapshot);
  assert.deepEqual(first, second);
});

// --- filterExistingCollisions ---------------------------------------------

test("filterExistingCollisions drops a fill whose email already belongs to another person", () => {
  const plan = {
    fills: [
      {
        personId: "p1",
        firstName: "Martin",
        lastName: "Suarez",
        companyKey: "acme",
        domain: "acme.com",
        patternId: "first.last" as const,
        matched: 3,
        total: 4,
        email: "martin.suarez@acme.com",
        emailNormalized: "martin.suarez@acme.com",
      },
    ],
    skips: [],
  };
  const result = filterExistingCollisions(plan, new Set(["martin.suarez@acme.com"]));
  assert.equal(result.fills.length, 0);
  assert.deepEqual(result.skips, [{ personId: "p1", reason: "db_collision" }]);
});
