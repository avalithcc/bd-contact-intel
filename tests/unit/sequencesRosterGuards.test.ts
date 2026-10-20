import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPANY_MEMBER_LIMIT,
  evaluateRosterAdds,
  type RosterCandidate,
  type RosterContext,
} from "@/lib/sequences/rosterGuards";

const candidate = (id: string, over: Partial<RosterCandidate> = {}): RosterCandidate => ({
  personId: id,
  email: `${id}@example.test`,
  emailStatus: "verified",
  emailSource: "apollo",
  mergedIntoId: null,
  companyKey: "twilio",
  clientStatus: null,
  ...over,
});

const ctx = (over: Partial<RosterContext> = {}): RosterContext => ({
  suppressionRules: [],
  existingPersonIds: new Set(),
  activeCountByCompany: new Map(),
  ...over,
});

const reasons = (r: ReturnType<typeof evaluateRosterAdds>) => Object.fromEntries(r.rejected.map((x) => [x.personId, x.reason]));

test("a reachable, unsuppressed, non-client Contact is accepted", () => {
  const r = evaluateRosterAdds([candidate("a")], ctx());
  assert.deepEqual(r, { accepted: ["a"], rejected: [] });
});

test("unreachable: merged, empty email, email_status none, pattern_inferred", () => {
  const r = evaluateRosterAdds(
    [
      candidate("merged", { mergedIntoId: "x" }),
      candidate("blank", { email: "  " }),
      candidate("none", { emailStatus: "none" }),
      candidate("guess", { emailSource: "pattern_inferred", emailStatus: "probable" }),
    ],
    ctx(),
  );
  assert.deepEqual(reasons(r), { merged: "unreachable", blank: "unreachable", none: "unreachable", guess: "unreachable" });
});

test("pattern_inferred is reachable once the address is verified (a reply from that exact mailbox beats the label)", () => {
  const r = evaluateRosterAdds(
    [
      candidate("verifiedGuess", { emailSource: "pattern_inferred", emailStatus: "verified" }),
      candidate("noneGuess", { emailSource: "pattern_inferred", emailStatus: "none" }),
    ],
    ctx(),
  );
  assert.deepEqual(r.accepted, ["verifiedGuess"]);
  assert.deepEqual(reasons(r), { noneGuess: "unreachable" });
});

test("client exclusion covers BOTH active and inactive; NULL and empty mean not a client", () => {
  const r = evaluateRosterAdds(
    [
      candidate("act", { clientStatus: "active", companyKey: "a" }),
      candidate("inact", { clientStatus: "inactive", companyKey: "b" }),
      candidate("null", { clientStatus: null, companyKey: "c" }),
      candidate("empty", { clientStatus: "", companyKey: "d" }),
    ],
    ctx(),
  );
  assert.deepEqual(reasons(r), { act: "client", inact: "client" });
  assert.deepEqual(r.accepted, ["null", "empty"]);
});

test("suppressed by address or by domain", () => {
  const rules = [
    { ruleKind: "address" as const, value: "a@example.test" },
    { ruleKind: "domain" as const, value: "blocked.test" },
  ];
  const r = evaluateRosterAdds([candidate("a"), candidate("b", { email: "b@blocked.test" })], ctx({ suppressionRules: rules }));
  assert.deepEqual(reasons(r), { a: "suppressed", b: "suppressed" });
});

test("duplicate: already a member of this Sequence", () => {
  const r = evaluateRosterAdds([candidate("a")], ctx({ existingPersonIds: new Set(["a"]) }));
  assert.deepEqual(reasons(r), { a: "duplicate" });
});

test("company limit is 2 non-discarded; existing active members count, discarded ones are not passed in", () => {
  assert.equal(COMPANY_MEMBER_LIMIT, 2);
  const r = evaluateRosterAdds([candidate("a")], ctx({ activeCountByCompany: new Map([["twilio", 2]]) }));
  assert.deepEqual(reasons(r), { a: "company_limit" });
  const ok = evaluateRosterAdds([candidate("a")], ctx({ activeCountByCompany: new Map([["twilio", 1]]) }));
  assert.deepEqual(ok.accepted, ["a"]);
});

test("bulk add of 3 at one company: 2 accepted, the third reported with a reason, none dropped silently", () => {
  const batch = [candidate("a"), candidate("b"), candidate("c")];
  const r = evaluateRosterAdds(batch, ctx());
  assert.deepEqual(r.accepted, ["a", "b"]);
  assert.deepEqual(r.rejected, [{ personId: "c", reason: "company_limit" }]);
  assert.equal(r.accepted.length + r.rejected.length, batch.length);
});

test("a rejected Contact does not consume a company slot", () => {
  const r = evaluateRosterAdds([candidate("x", { clientStatus: "inactive" }), candidate("a"), candidate("b")], ctx());
  assert.deepEqual(r.accepted, ["a", "b"]);
});

test("the same person listed twice in one request is reported as duplicate", () => {
  const r = evaluateRosterAdds([candidate("a"), candidate("a")], ctx());
  assert.deepEqual(r.accepted, ["a"]);
  assert.deepEqual(r.rejected, [{ personId: "a", reason: "duplicate" }]);
});

test("a Contact with no company key is not grouped under the company limit", () => {
  const r = evaluateRosterAdds([candidate("a", { companyKey: null }), candidate("b", { companyKey: null }), candidate("c", { companyKey: null })], ctx());
  assert.deepEqual(r.accepted, ["a", "b", "c"]);
});

test("a Contact with no compliance audience is refused, whatever the client asked; an unknown market is not judged", () => {
  const r = evaluateRosterAdds([candidate("spain", { marketMapped: false }), candidate("us", { marketMapped: true }), candidate("unknown")], ctx());
  assert.deepEqual(reasons(r), { spain: "unmapped_market" });
  assert.deepEqual(r.accepted, ["us", "unknown"]);
});

test("the market never takes the place of an earlier reason: a client in an unmapped market is a client", () => {
  const r = evaluateRosterAdds([candidate("a", { marketMapped: false, clientStatus: "active" }), candidate("b", { marketMapped: false, emailStatus: "none" })], ctx());
  assert.deepEqual(reasons(r), { a: "client", b: "unreachable" });
});
