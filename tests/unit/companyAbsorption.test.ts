import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABSORPTION_NOTE_MAX,
  ABSORPTION_STATUSES,
  ABSORPTION_REFUSAL_KEY,
  CANDIDATE_MAX,
  canTransition,
  decideWithdrawal,
  normalizeCandidateQuery,
  toCandidateView,
  checkProposalInput,
  decideProposal,
  isAbsorptionStatus,
  toOpenProposalView,
  type ProposalFacts,
} from "../../src/lib/companies/absorption";

const BD = "11111111-1111-4111-8111-111111111111";
const input = (over: Record<string, unknown> = {}) => ({ absorbedKey: "old name", survivorKey: "new name", proposerBdId: BD, note: null, ...over });
const facts = (over: Partial<ProposalFacts> = {}): ProposalFacts => ({
  proposerIsBd: true,
  absorbedExists: true,
  survivorExists: true,
  openForAbsorbedId: null,
  openForSurvivorId: null,
  ...over,
});
const valid = (over: Record<string, unknown> = {}) => {
  const r = checkProposalInput(input(over));
  assert.ok(r.ok, "fixture input must be valid");
  return r.value;
};

test("status vocabulary is open / applied / rejected / withdrawn and nothing else is accepted", () => {
  assert.deepEqual([...ABSORPTION_STATUSES], ["open", "applied", "rejected", "withdrawn"]);
  assert.ok(isAbsorptionStatus("withdrawn"));
  assert.ok(isAbsorptionStatus("open"));
  assert.ok(!isAbsorptionStatus("OPEN"));
  assert.ok(!isAbsorptionStatus(undefined));
});

test("transitions: only an open proposal can be resolved, and resolved ones are final", () => {
  assert.ok(canTransition("open", "applied"));
  assert.ok(canTransition("open", "rejected"));
  assert.ok(!canTransition("open", "open"));
  for (const from of ["applied", "rejected"] as const) {
    for (const to of ABSORPTION_STATUSES) assert.ok(!canTransition(from, to), `${from} -> ${to}`);
  }
});

test("checkProposalInput: accepts a well-formed proposal and normalizes the note", () => {
  assert.deepEqual(checkProposalInput(input({ note: "  absorbed in 2026  " })), {
    ok: true,
    value: { absorbedKey: "old name", survivorKey: "new name", proposerBdId: BD, note: "absorbed in 2026" },
  });
  assert.equal(valid({ note: "   " }).note, null);
  assert.equal(valid({ note: undefined }).note, null);
});

test("checkProposalInput: refuses the same key on both sides", () => {
  assert.deepEqual(checkProposalInput(input({ absorbedKey: "x", survivorKey: "x" })), { ok: false, reason: "same_company" });
});

test("checkProposalInput: refuses missing or non-string keys, and a non-uuid proposer before any query", () => {
  assert.deepEqual(checkProposalInput(input({ absorbedKey: "" })), { ok: false, reason: "invalid_company_key" });
  assert.deepEqual(checkProposalInput(input({ survivorKey: 7 })), { ok: false, reason: "invalid_company_key" });
  assert.deepEqual(checkProposalInput(input({ proposerBdId: "not-a-uuid" })), { ok: false, reason: "proposer_not_bd" });
  assert.deepEqual(checkProposalInput(input({ proposerBdId: null })), { ok: false, reason: "proposer_not_bd" });
});

test("checkProposalInput: refuses a note over the cap, accepts one at the cap", () => {
  assert.deepEqual(checkProposalInput(input({ note: "a".repeat(ABSORPTION_NOTE_MAX + 1) })), { ok: false, reason: "note_too_long" });
  assert.ok(checkProposalInput(input({ note: "a".repeat(ABSORPTION_NOTE_MAX) })).ok);
  assert.deepEqual(checkProposalInput(input({ note: 5 })), { ok: false, reason: "invalid_note" });
});

test("decideProposal: creates when every guard passes", () => {
  assert.deepEqual(decideProposal(valid(), facts()), { ok: true, absorbedKey: "old name", survivorKey: "new name", note: null });
});

test("decideProposal: a proposer who is not a bd row is refused", () => {
  assert.deepEqual(decideProposal(valid(), facts({ proposerIsBd: false })), { ok: false, reason: "proposer_not_bd" });
});

test("decideProposal: either company missing is refused, naming which", () => {
  assert.deepEqual(decideProposal(valid(), facts({ absorbedExists: false })), { ok: false, reason: "absorbed_not_found" });
  assert.deepEqual(decideProposal(valid(), facts({ survivorExists: false })), { ok: false, reason: "survivor_not_found" });
});

test("decideProposal: an already-open proposal for the absorbed company is returned, not duplicated", () => {
  assert.deepEqual(decideProposal(valid(), facts({ openForAbsorbedId: "p-1" })), { ok: false, reason: "already_proposed", openProposalId: "p-1" });
});

test("decideProposal: a survivor that is itself the absorbed side of an open proposal is refused", () => {
  assert.deepEqual(decideProposal(valid(), facts({ openForSurvivorId: "p-2" })), { ok: false, reason: "survivor_is_absorbed", openProposalId: "p-2" });
});

test("decideProposal: is pure, same inputs give the same answer and nothing is mutated", () => {
  const v = valid({ note: " n " });
  const f = facts({ openForAbsorbedId: "p-1" });
  const before = JSON.stringify([v, f]);
  assert.deepEqual(decideProposal(v, f), decideProposal(v, f));
  assert.equal(JSON.stringify([v, f]), before);
});

test("toOpenProposalView: normalizes the strings raw SQL returns (timestamps, counts) and keeps ids as text", () => {
  const raw = {
    id: "p-1",
    note: "n",
    created_at: "2026-10-01T10:00:00.000Z",
    proposer_id: BD,
    proposer_name: "Ana",
    absorbed_key: "old",
    absorbed_name: "Old",
    absorbed_stage: "prospect",
    absorbed_domain: "old.com",
    absorbed_contacts: "3",
    absorbed_owner: "Dana",
    absorbed_last_activity: "2026-09-01 10:00:00.5+00",
    survivor_key: "new",
    survivor_name: "New",
    survivor_stage: null,
    survivor_domain: null,
    survivor_contacts: 0,
    survivor_owner: null,
    survivor_last_activity: null,
    total: "7",
  };
  const view = toOpenProposalView(raw);
  assert.ok(view.createdAt instanceof Date);
  assert.equal(view.createdAt.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.equal(view.absorbed.contacts, 3);
  assert.equal(view.survivor.contacts, 0);
  assert.equal(view.total, 7);
  assert.deepEqual(view.absorbed, {
    key: "old",
    displayName: "Old",
    stage: "prospect",
    domain: "old.com",
    contacts: 3,
    ownerName: "Dana",
    lastActivityAt: new Date("2026-09-01T10:00:00.500Z"),
  });
  assert.deepEqual(view.survivor.ownerName, null);
  assert.equal(view.survivor.lastActivityAt, null);
  assert.deepEqual(view.proposedBy, { id: BD, name: "Ana" });
  assert.equal(toOpenProposalView({ ...raw, created_at: new Date("2026-10-01T10:00:00Z") }).createdAt.getTime(), view.createdAt.getTime());
});

test("withdrawn is reachable only from open; applied and rejected can never become withdrawn", () => {
  assert.ok(canTransition("open", "withdrawn"));
  assert.ok(!canTransition("applied", "withdrawn"));
  assert.ok(!canTransition("rejected", "withdrawn"));
  assert.ok(!canTransition("withdrawn", "withdrawn"));
  for (const to of ABSORPTION_STATUSES) assert.ok(!canTransition("withdrawn", to), `withdrawn is final (-> ${to})`);
});

test("withdrawing: only the proposer, only while open, and the reason says which", () => {
  const ME = BD;
  const other = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(decideWithdrawal({ status: "open", proposedByBdId: ME }, ME), { ok: true });
  assert.deepEqual(decideWithdrawal({ status: "open", proposedByBdId: ME }, other), { ok: false, reason: "not_proposer" });
  assert.deepEqual(decideWithdrawal(null, ME), { ok: false, reason: "proposal_not_found" });
  for (const status of ["applied", "rejected", "withdrawn"]) {
    assert.deepEqual(decideWithdrawal({ status, proposedByBdId: ME }, ME), { ok: false, reason: "not_open" });
  }
  // A non-open proposal is "not open" even for a stranger: the status, not the person, is the stronger fact.
  assert.deepEqual(decideWithdrawal({ status: "applied", proposedByBdId: ME }, other), { ok: false, reason: "not_open" });
  // An unknown status string in the column never opens the gate.
  assert.deepEqual(decideWithdrawal({ status: "OPEN", proposedByBdId: ME }, ME), { ok: false, reason: "not_open" });
});

test("candidate search query: trimmed, collapsed, at least 2 characters, bounded", () => {
  assert.equal(normalizeCandidateQuery("  grupo   cedro "), "grupo cedro");
  assert.equal(normalizeCandidateQuery("a"), null);
  assert.equal(normalizeCandidateQuery("   "), null);
  assert.equal(normalizeCandidateQuery(undefined), null);
  assert.equal(normalizeCandidateQuery("x".repeat(500))?.length, 80);
  assert.ok(CANDIDATE_MAX <= 10);
});

test("candidate rows come back from raw SQL with string counts; the view carries numbers", () => {
  const v = toCandidateView({ company_key: "grupo cedro", display_name: "Grupo Cedro", relationship_stage: "qualified", domain: "grupocedro.com", contacts: "84" });
  assert.deepEqual(v, { key: "grupo cedro", displayName: "Grupo Cedro", stage: "qualified", domain: "grupocedro.com", contacts: 84 });
});

test("every refusal the UI can receive has a dictionary key, in both languages", async () => {
  const { en } = await import("../../src/lib/i18n/dictionaries/en");
  const { es } = await import("../../src/lib/i18n/dictionaries/es");
  for (const [reason, key] of Object.entries(ABSORPTION_REFUSAL_KEY)) {
    assert.equal(typeof (en.companyRecord as Record<string, unknown>)[key], "string", `en ${reason} -> ${key}`);
    assert.equal(typeof (es.companyRecord as Record<string, unknown>)[key], "string", `es ${reason} -> ${key}`);
  }
});
