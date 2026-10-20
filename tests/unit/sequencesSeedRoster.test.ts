import assert from "node:assert/strict";
import { test } from "node:test";
import { SEED_ROSTER, SEED_SEQUENCE_NAME, parseSeedArgs, resolveSeedRoster, type SeedCandidate, type SeedGuards } from "@/lib/sequences/seedRoster";

const candidate = (id: string, over: Partial<SeedCandidate> = {}): SeedCandidate => ({
  label: `Person ${id}`,
  personId: id,
  email: `${id}@example.test`,
  emailStatus: "verified",
  emailSource: "apollo",
  mergedIntoId: null,
  companyKey: `co-${id}`,
  clientStatus: null,
  hasOpenItPosting: true,
  ...over,
});

const guards = (over: Partial<SeedGuards> = {}): SeedGuards => ({
  suppressionRules: [],
  alreadyMemberPersonIds: new Set(),
  activeCountByCompany: new Map(),
  ...over,
});

const reasons = (r: ReturnType<typeof resolveSeedRoster>) => Object.fromEntries(r.rejected.map((x) => [x.candidate.personId, x.reason]));

test("a candidate that passes every guard is admitted", () => {
  const r = resolveSeedRoster([candidate("a")], guards());
  assert.deepEqual(r.admitted.map((c) => c.personId), ["a"]);
  assert.deepEqual(r.rejected, []);
});

test("every rejection path carries its own reason", () => {
  const r = resolveSeedRoster(
    [
      candidate("member"),
      candidate("merged", { mergedIntoId: "x" }),
      candidate("noemail", { email: "  " }),
      candidate("nullemail", { email: null }),
      candidate("none", { emailStatus: "none" }),
      candidate("pattern", { emailSource: "pattern_inferred", emailStatus: "probable" }),
      candidate("closed", { hasOpenItPosting: false }),
      candidate("active", { clientStatus: "active" }),
      candidate("inactive", { clientStatus: "inactive" }),
      candidate("addr", { email: "Blocked@Example.test" }),
      candidate("dom", { email: "x@blocked.test" }),
      candidate("ok"),
    ],
    guards({
      alreadyMemberPersonIds: new Set(["member"]),
      suppressionRules: [
        { ruleKind: "address", value: "blocked@example.test" },
        { ruleKind: "domain", value: "blocked.test" },
      ],
    }),
  );
  assert.deepEqual(reasons(r), {
    member: "already_member",
    merged: "merged",
    noemail: "no_email",
    nullemail: "no_email",
    none: "unreachable",
    pattern: "unreachable",
    closed: "no_open_posting",
    active: "client",
    inactive: "client",
    addr: "suppressed",
    dom: "suppressed",
  });
  assert.deepEqual(r.admitted.map((c) => c.personId), ["ok"]);
});

test("the company cap counts members already on the Sequence and those admitted earlier in the same run", () => {
  const same = { companyKey: "twilio" };
  const fresh = resolveSeedRoster([candidate("a", same), candidate("b", same), candidate("c", same)], guards());
  assert.deepEqual(fresh.admitted.map((c) => c.personId), ["a", "b"]);
  assert.deepEqual(reasons(fresh), { c: "company_limit" });

  const seeded = resolveSeedRoster([candidate("a", same)], guards({ activeCountByCompany: new Map([["twilio", 2]]) }));
  assert.deepEqual(reasons(seeded), { a: "company_limit" });
});

test("a rejected candidate does not consume the company cap", () => {
  const same = { companyKey: "snowflake" };
  const r = resolveSeedRoster([candidate("a", { ...same, hasOpenItPosting: false }), candidate("b", same), candidate("c", same)], guards());
  assert.deepEqual(r.admitted.map((c) => c.personId), ["b", "c"]);
});

test("never substitutes: a short list stays short and admission keeps the owner's order", () => {
  const input = [candidate("1"), candidate("2", { clientStatus: "inactive" }), candidate("3")];
  const r = resolveSeedRoster(input, guards());
  assert.deepEqual(r.admitted.map((c) => c.personId), ["1", "3"]);
  assert.equal(r.admitted.length + r.rejected.length, input.length);
});

test("is pure: the inputs are left untouched", () => {
  const counts = new Map([["twilio", 1]]);
  resolveSeedRoster([candidate("a", { companyKey: "twilio" })], guards({ activeCountByCompany: counts }));
  assert.deepEqual([...counts], [["twilio", 1]]);
});

test("parseSeedArgs: dry run is the default and writing needs --apply AND --actor", () => {
  assert.deepEqual(parseSeedArgs([]), { apply: false, actor: null });
  assert.deepEqual(parseSeedArgs(["--dry-run", "--actor=abc"]), { apply: false, actor: "abc" });
  assert.deepEqual(parseSeedArgs(["--apply", "--actor=abc"]), { apply: true, actor: "abc" });
  assert.throws(() => parseSeedArgs(["--apply"]), /--actor/);
  assert.throws(() => parseSeedArgs(["--apply", "--actor="]), /--actor/);
  assert.throws(() => parseSeedArgs(["--apply", "--dry-run", "--actor=abc"]), /contradict/);
  assert.throws(() => parseSeedArgs(["--execute"]), /Unknown argument/);
});

test("the hand-picked roster is the owner's nine, in tier order, with at most two per company", () => {
  assert.equal(SEED_SEQUENCE_NAME, "Florida + US · octubre");
  assert.deepEqual(SEED_ROSTER.map((r) => `${r.name} @ ${r.company}`), [
    "Brian Casteel @ Upshop",
    "Saumya Jossy @ Upshop",
    "Adrian Pulido @ Nubank",
    "Joe Dilaura @ Snowflake",
    "Melissa Dominguez @ Snowflake",
    "Kevin Harris @ Twilio",
    "Stefano Fontanelli @ Twilio",
    "Jose Velez @ Bold",
    "Anderson Romero @ Bold",
  ]);
  assert.equal(SEED_ROSTER.length, 9);
});

test("a candidate with no compliance audience is rejected as unmapped_market, and an unjudged one is not", () => {
  const r = resolveSeedRoster([candidate("nomarket", { marketMapped: false }), candidate("mapped", { marketMapped: true }), candidate("unjudged")], guards());
  assert.deepEqual(reasons(r), { nomarket: "unmapped_market" });
  assert.deepEqual(r.admitted.map((c) => c.personId), ["mapped", "unjudged"]);
});
