/**
 * Unit tests for the single shared email-winner decision
 * (`pickEmailWinner`, src/lib/identity/merge.ts).
 *
 * Two call sites depend on this one function never drifting from itself:
 *  - `mergeEmailFields` (private, merge.ts) — the live merge write path used
 *    by /admin/duplicates and scripts/merge-duplicates.ts.
 *  - `pickEmailWinnerSide` (duplicateTiering.ts) — the `--tier=safe` dry
 *    run's "which email will be discarded" report line.
 *
 * Both used to carry their own hand-copy of this rule; `pickEmailWinnerSide`
 * now calls `pickEmailWinner` directly, so the second test below proves
 * agreement BY CONSTRUCTION: it derives the expected side from
 * `pickEmailWinner`'s own return value, never from a second hand-written
 * table that could be updated wrongly in only one place.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickEmailWinner } from "@/lib/identity/merge";
import { pickEmailWinnerSide } from "@/lib/identity/duplicateTiering";
import type { EmailStatus } from "@/lib/identity/matcher";

interface Candidate {
  email: string | null;
  emailStatus: EmailStatus;
}

const STATUSES: readonly EmailStatus[] = ["verified", "probable", "none"];

function candidatesWithEmail(email: string): readonly Candidate[] {
  return STATUSES.map((emailStatus) => ({ email, emailStatus }));
}

function candidatesWithoutEmail(): readonly Candidate[] {
  return STATUSES.map((emailStatus) => ({ email: null, emailStatus }));
}

// The full cross product this module's spec calls for: each side's email
// null or set, crossed with each emailStatus value on each side (6 shapes
// per side x 6 = 36 rows). `side` is the label used to compute the expected
// winner OBJECT (not a hand-copied rule) in the table-driven test below.
interface Row {
  label: string;
  a: Candidate;
  b: Candidate;
  winner: "a" | "b";
}

function buildRows(): Row[] {
  const rows: Row[] = [];

  // aHas && !bHas -> a always wins, regardless of either side's emailStatus.
  for (const a of candidatesWithEmail("a@corp.com")) {
    for (const b of candidatesWithoutEmail()) {
      rows.push({ label: `a has email (${a.emailStatus}), b has none (${b.emailStatus})`, a, b, winner: "a" });
    }
  }

  // !aHas && bHas -> b always wins, regardless of either side's emailStatus.
  for (const a of candidatesWithoutEmail()) {
    for (const b of candidatesWithEmail("b@corp.com")) {
      rows.push({ label: `a has none (${a.emailStatus}), b has email (${b.emailStatus})`, a, b, winner: "b" });
    }
  }

  // Neither side has an email -> a wins (the tie-favors-first-argument rule
  // applies even in the "both empty" case), regardless of emailStatus.
  for (const a of candidatesWithoutEmail()) {
    for (const b of candidatesWithoutEmail()) {
      rows.push({ label: `neither has email (a=${a.emailStatus}, b=${b.emailStatus})`, a, b, winner: "a" });
    }
  }

  // Both sides have an email -> rank by emailStatus (verified > probable >
  // none), ties favor a.
  const rank: Record<EmailStatus, number> = { verified: 2, probable: 1, none: 0 };
  for (const a of candidatesWithEmail("a@corp.com")) {
    for (const b of candidatesWithEmail("b@corp.com")) {
      const winner: "a" | "b" = rank[b.emailStatus] > rank[a.emailStatus] ? "b" : "a";
      rows.push({ label: `both have email (a=${a.emailStatus}, b=${b.emailStatus})`, a, b, winner });
    }
  }

  return rows;
}

const ROWS = buildRows();

test(`pickEmailWinner: full cross product (${ROWS.length} rows) of email null/set x emailStatus x emailStatus`, () => {
  assert.equal(ROWS.length, 36, "sanity check: 6 shapes per side x 6 shapes = 36 rows");
  for (const row of ROWS) {
    const winnerObj = pickEmailWinner(row.a, row.b);
    const actual = winnerObj === row.a ? "a" : "b";
    assert.equal(actual, row.winner, row.label);
  }
});

test("pickEmailWinner: equal-email case — ties on emailStatus favor the first argument even when both addresses are identical", () => {
  const sameEmail = "shared@corp.com";
  assert.equal(pickEmailWinner({ email: sameEmail, emailStatus: "verified" }, { email: sameEmail, emailStatus: "verified" }).emailStatus, "verified");
  const a = { email: sameEmail, emailStatus: "verified" as EmailStatus };
  const b = { email: sameEmail, emailStatus: "verified" as EmailStatus };
  assert.equal(pickEmailWinner(a, b), a, "tie on identical email/status must still favor the first argument");
});

test("pickEmailWinner: equal-email case — a higher-ranked emailStatus still wins even when both addresses are identical", () => {
  const sameEmail = "shared@corp.com";
  const a = { email: sameEmail, emailStatus: "probable" as EmailStatus };
  const b = { email: sameEmail, emailStatus: "verified" as EmailStatus };
  assert.equal(pickEmailWinner(a, b), b);
});

// --- Proof of agreement BY CONSTRUCTION, not by two parallel assertions ----
//
// For every row in the same cross product, derive the expected side from
// pickEmailWinner's own return value (object identity), then assert
// pickEmailWinnerSide agrees. Nothing here hand-encodes a second copy of the
// winner rule — if pickEmailWinnerSide ever stopped calling pickEmailWinner
// and reimplemented the rule independently, only an actual behavioral
// divergence would fail this test, not a maintenance slip in the test file.

test(`pickEmailWinnerSide agrees with pickEmailWinner for every row of the cross product (${ROWS.length} rows), by construction`, () => {
  for (const row of ROWS) {
    const survivor = row.a;
    const merged = row.b;
    const winnerObj = pickEmailWinner(survivor, merged);
    const expectedSide = winnerObj === survivor ? "survivor" : "merged";
    const actualSide = pickEmailWinnerSide(survivor, merged);
    assert.equal(actualSide, expectedSide, row.label);
  }
});

// Owner's decision (2026-10-07): in a B2B CRM the employer's address is the
// one we write to, so a corporate domain outranks `verified` on a consumer
// one. Measured against the open duplicate pairs, the status-only rule kept
// the personal address in 4 of the 7 that disagree.
type Side = { email: string | null; emailStatus: EmailStatus };
const side = (email: string | null, emailStatus: EmailStatus): Side => ({ email, emailStatus });

test("the corporate domain beats a verified consumer address", () => {
  const work = side("aldo.malaver@globant.com", "probable");
  const personal = side("almalaver@gmail.com", "verified");
  assert.equal(pickEmailWinner(work, personal), work);
  assert.equal(pickEmailWinner(personal, work), work);
});

test("between two corporate addresses the status still decides", () => {
  const probable = side("dardo.marasca@jampp.com", "probable");
  const verified = side("dardo@jampp.com", "verified");
  assert.equal(pickEmailWinner(probable, verified), verified);
  assert.equal(pickEmailWinner(verified, probable), verified);
});

test("between two consumer addresses the status still decides", () => {
  const hotmail = side("arymolcha@hotmail.com", "none");
  const gmail = side("ary@gmail.com", "verified");
  assert.equal(pickEmailWinner(hotmail, gmail), gmail);
});

test("a regional consumer domain is still consumer", () => {
  const work = side("x@kandasoft.com", "none");
  const yahooAr = side("x@yahoo.com.ar", "verified");
  assert.equal(pickEmailWinner(yahooAr, work), work);
});

test("an unparseable address never wins on domain alone", () => {
  const broken = side("not-an-address", "verified");
  const work = side("x@globant.com", "probable");
  assert.equal(pickEmailWinner(broken, work), work);
});

test("having an address still beats having none, whatever the domain", () => {
  const gmail = side("x@gmail.com", "none");
  const empty = side(null, "none");
  assert.equal(pickEmailWinner(empty, gmail), gmail);
  assert.equal(pickEmailWinner(gmail, empty), gmail);
});
