/**
 * Unit tests for src/lib/identity/duplicateTiering.ts — pure tier
 * classification + run planning for scripts/merge-duplicates.ts (the
 * owner-run bulk merge of the /admin/duplicates queue). Fixtures are
 * synthetic (never copied from real contact rows).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDuplicatePairBucket,
  tierForBucket,
  findChainedPersonIds,
  isPairChained,
  checkSurvivorLoss,
  planDuplicateTierRun,
  type DuplicateTierPersonFields,
  type DuplicatePairPlanInput,
  type DuplicatePairPlanPerson,
} from "@/lib/identity/duplicateTiering";

function pf(overrides: Partial<DuplicateTierPersonFields> = {}): DuplicateTierPersonFields {
  return {
    email: null,
    emailStatus: "none",
    profileKey: null,
    jobTitle: null,
    ownerBdId: null,
    ...overrides,
  };
}

function planPerson(overrides: Partial<DuplicatePairPlanPerson> & { id: string }): DuplicatePairPlanPerson {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: null,
    emailStatus: "none",
    profileKey: null,
    jobTitle: null,
    ownerBdId: null,
    createdAt: new Date("2026-01-01"),
    connections: [],
    ...overrides,
  };
}

function pairInput(
  candidateId: string,
  a: DuplicatePairPlanPerson,
  b: DuplicatePairPlanPerson,
  reason = "name_company",
): DuplicatePairPlanInput {
  return { candidateId, reason, personA: a, personB: b };
}

// --- classifyDuplicatePairBucket / tierForBucket --------------------------

test("classifyDuplicatePairBucket: same email on both sides is 'same_email' (safe)", () => {
  const a = pf({ email: "jane@corp.com", emailStatus: "probable" });
  const b = pf({ email: "JANE@corp.com ".trim(), emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "same_email");
  assert.equal(tierForBucket(bucket), "safe");
});

test("classifyDuplicatePairBucket: classic split (email xor profile_key) with no conflict is safe", () => {
  const a = pf({ email: "jane@corp.com", emailStatus: "probable" });
  const b = pf({ profileKey: "jane-doe", jobTitle: "Engineer" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "classic_split_no_conflict");
  assert.equal(tierForBucket(bucket), "safe");
});

test("classifyDuplicatePairBucket: classic split with a title conflict is review, not safe", () => {
  const a = pf({ email: "jane@corp.com", jobTitle: "VP Sales" });
  const b = pf({ profileKey: "jane-doe", jobTitle: "Intern" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "classic_split_conflict");
  assert.equal(tierForBucket(bucket), "review");
});

test("classifyDuplicatePairBucket: classic split with an owner conflict is review, not safe", () => {
  const a = pf({ email: "jane@corp.com", ownerBdId: "bd-1" });
  const b = pf({ profileKey: "jane-doe", ownerBdId: "bd-2" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "classic_split_conflict");
  assert.equal(tierForBucket(bucket), "review");
});

test("classifyDuplicatePairBucket: one email present but not the classic split shape is review", () => {
  // Neither side has a profile_key, so this isn't the email-side/LinkedIn-side split.
  const a = pf({ email: "jane@corp.com" });
  const b = pf({});
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "one_email_not_classic");
  assert.equal(tierForBucket(bucket), "review");
});

test("classifyDuplicatePairBucket: two different VERIFIED emails is dismiss (likely two people)", () => {
  const a = pf({ email: "jane@corp.com", emailStatus: "verified" });
  const b = pf({ email: "jane.doe@corp.com", emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_differ_verified");
  assert.equal(tierForBucket(bucket), "dismiss");
});

test("classifyDuplicatePairBucket: two different emails, not both verified, is review (not dismissed)", () => {
  const a = pf({ email: "jane@corp.com", emailStatus: "verified" });
  const b = pf({ email: "jane.doe@corp.com", emailStatus: "probable" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_differ_unverified");
  assert.equal(tierForBucket(bucket), "review");
});

test("classifyDuplicatePairBucket: no email either side, titles agree or blank, is review", () => {
  assert.equal(classifyDuplicatePairBucket(pf({ jobTitle: "CEO" }), pf({ jobTitle: "ceo" })), "no_email_titles_agree");
  assert.equal(classifyDuplicatePairBucket(pf({ jobTitle: "CEO" }), pf({ jobTitle: null })), "no_email_titles_agree");
  assert.equal(tierForBucket("no_email_titles_agree"), "review");
});

test("classifyDuplicatePairBucket: no email either side, titles conflict, is review", () => {
  const bucket = classifyDuplicatePairBucket(pf({ jobTitle: "CEO" }), pf({ jobTitle: "Intern" }));
  assert.equal(bucket, "no_email_titles_conflict");
  assert.equal(tierForBucket(bucket), "review");
});

// --- chain detection -------------------------------------------------------

test("findChainedPersonIds: a person shared by two open pairs is a chain; an unrelated pair is not", () => {
  const pairs = [
    { candidateId: "p1", personAId: "A", personBId: "B" },
    { candidateId: "p2", personAId: "B", personBId: "C" },
    { candidateId: "p3", personAId: "D", personBId: "E" },
  ];
  const chained = findChainedPersonIds(pairs);
  assert.ok(chained.has("B"));
  assert.ok(!chained.has("A"));
  assert.ok(!chained.has("D"));
  assert.equal(isPairChained(pairs[0], chained), true);
  assert.equal(isPairChained(pairs[1], chained), true);
  assert.equal(isPairChained(pairs[2], chained), false);
});

// --- survivor-loss guard ----------------------------------------------------

test("checkSurvivorLoss: flags losing the side with synced Gmail messages", () => {
  const result = checkSurvivorLoss({
    survivorProfileKey: "jane-doe",
    survivorConnections: [{ messageCount: 0 }],
    mergedProfileKey: null,
    mergedConnections: [{ messageCount: 12 }],
  });
  assert.equal(result.losesGmailMessages, true);
  assert.equal(result.losesProfileKey, false);
});

test("checkSurvivorLoss: flags losing the side with the profile_key", () => {
  const result = checkSurvivorLoss({
    survivorProfileKey: null,
    survivorConnections: [],
    mergedProfileKey: "jane-doe",
    mergedConnections: [],
  });
  assert.equal(result.losesGmailMessages, false);
  assert.equal(result.losesProfileKey, true);
});

test("checkSurvivorLoss: neither flag set when nothing would be lost", () => {
  const result = checkSurvivorLoss({
    survivorProfileKey: "jane-doe",
    survivorConnections: [{ messageCount: 5 }],
    mergedProfileKey: null,
    mergedConnections: [{ messageCount: 0 }],
  });
  assert.equal(result.losesGmailMessages, false);
  assert.equal(result.losesProfileKey, false);
});

// --- planDuplicateTierRun ---------------------------------------------------

test("planDuplicateTierRun: tier=safe merges the clean pair, skips the chained pair and the survivor-loss pair", () => {
  // Pair 1: classic split, clean -> merge.
  const p1a = planPerson({ id: "1a", email: "jane@corp.com" });
  const p1b = planPerson({ id: "1b", profileKey: "jane-doe" });

  // Pair 2 + Pair 3 share person "2b" -> both chained, excluded even though
  // pair 2 alone would qualify as a clean classic split.
  const p2a = planPerson({ id: "2a", email: "amy@corp.com" });
  const p2b = planPerson({ id: "2b", profileKey: "amy-smith" });
  const p3a = planPerson({ id: "2b", profileKey: "amy-smith" }); // same person id as p2b
  const p3b = planPerson({ id: "3b", email: "amy2@corp.com" });

  // Pair 4: classic split, clean, but chooseDefaultSurvivor would pick the
  // side (profile_key side) that has no synced Gmail messages while the
  // losing side does -> skipped, not guessed.
  const p4a = planPerson({ id: "4a", email: "sam@corp.com", connections: [{ connectedOn: null, messageCount: 20 }] });
  const p4b = planPerson({ id: "4b", profileKey: "sam-lee", connections: [] });

  const pairs: DuplicatePairPlanInput[] = [
    pairInput("c1", p1a, p1b),
    pairInput("c2", p2a, p2b),
    pairInput("c3", p3a, p3b),
    pairInput("c4", p4a, p4b),
  ];

  const plan = planDuplicateTierRun(pairs, "safe");

  assert.equal(plan.tier, "safe");
  assert.equal(plan.bucketCounts.classic_split_no_conflict, 4);
  assert.equal(plan.tierCounts.safe, 4);
  assert.deepEqual([...plan.chainedCandidateIds].sort(), ["c2", "c3"]);

  const byId = new Map(plan.entries.map((e) => [e.candidateId, e]));
  assert.equal(byId.get("c1")?.kind, "merge");
  assert.equal((byId.get("c1") as { survivorId: string }).survivorId, "1b"); // profile_key side wins
  assert.equal(byId.get("c2")?.kind, "skip_chain");
  assert.equal(byId.get("c3")?.kind, "skip_chain");
  const c4 = byId.get("c4");
  assert.equal(c4?.kind, "skip_survivor_loss");
  assert.equal((c4 as { loss: { losesGmailMessages: boolean } }).loss.losesGmailMessages, true);
});

test("planDuplicateTierRun: tier=dismiss selects the two-different-verified-emails pairs", () => {
  const a = planPerson({ id: "a", email: "jane@corp.com", emailStatus: "verified" });
  const b = planPerson({ id: "b", email: "jane.doe@corp.com", emailStatus: "verified" });
  const plan = planDuplicateTierRun([pairInput("c1", a, b, "name_company")], "dismiss");

  assert.equal(plan.tier, "dismiss");
  assert.equal(plan.tierCounts.dismiss, 1);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].kind, "dismiss");
  assert.equal(plan.entries[0].candidateId, "c1");
});

test("planDuplicateTierRun is a pure planner: calling it twice with the same input yields the same result and never mutates the input", () => {
  const a = planPerson({ id: "a", email: "jane@corp.com" });
  const b = planPerson({ id: "b", profileKey: "jane-doe" });
  const pairs: DuplicatePairPlanInput[] = [pairInput("c1", a, b)];
  const before = JSON.stringify(pairs);

  const first = planDuplicateTierRun(pairs, "safe");
  const second = planDuplicateTierRun(pairs, "safe");

  assert.equal(JSON.stringify(pairs), before, "planner must not mutate its input");
  assert.deepEqual(first, second);
});
