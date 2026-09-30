/**
 * Unit tests for src/lib/identity/stuffedNameFirstTokenSplit.ts. Pure, no DB —
 * run with: npx tsx --test tests/unit/stuffedNameFirstTokenSplit.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFirstTokenSplitPlan,
  deriveFirstTokenSplit,
  NON_PERSON_SINGLE_TOKENS,
  type FirstTokenSplitCandidate,
} from "@/lib/identity/stuffedNameFirstTokenSplit";

function candidate(overrides: Partial<FirstTokenSplitCandidate> = {}): FirstTokenSplitCandidate {
  return {
    personId: "p1",
    firstName: "Julián Zamudio Lemos",
    originalLastName: null,
    ...overrides,
  };
}

// --- deriveFirstTokenSplit: fills --------------------------------------------

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

test("a 2-token name is never widened by the middle-initial rule even if the 2nd token looks like an initial (no surname left otherwise)", () => {
  const result = deriveFirstTokenSplit({ firstName: "Ana J" });
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Ana", lastName: "J", rule: "plain" },
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

// --- deriveFirstTokenSplit: skips (needs review) -----------------------------

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

// --- buildFirstTokenSplitPlan -------------------------------------------------

test("buildFirstTokenSplitPlan partitions candidates into fills and skips", () => {
  const plan = buildFirstTokenSplitPlan([
    candidate({ personId: "p1", firstName: "Julián Zamudio Lemos" }),
    candidate({ personId: "p2", firstName: "Pagos" }),
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
    { personId: "p2", originalFirstName: "Pagos", isDigitsOnly: false, isCommonNonPersonWord: true },
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
