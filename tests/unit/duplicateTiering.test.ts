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
  isSameMailbox,
  classifyMailboxMatch,
  hasNonAsciiLocalPart,
  pickEmailWinnerSide,
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

// --- isSameMailbox ----------------------------------------------------------

test("isSameMailbox: ccTLD domain suffix (.com vs .com.ar), same local part", () => {
  assert.equal(isSameMailbox("abresciani@rappachiani.com", "abresciani@rappachiani.com.ar"), true);
});

test("isSameMailbox: dot separator added between the same tokens", () => {
  assert.equal(isSameMailbox("juanmontanaro@jpmorgan.com", "juan.montanaro@jpmorgan.com"), true);
});

test("isSameMailbox: middle-initial token dropped/added", () => {
  assert.equal(isSameMailbox("javier.astort@wolox.com.ar", "javier.s.astort@wolox.com.ar"), true);
});

test("isSameMailbox: accented local part vs plain ASCII", () => {
  assert.equal(isSameMailbox("martín.medina@ladonware.com", "martin.medina@ladonware.com"), true);
});

test("isSameMailbox: same domain, genuinely different people (truncated-first-name collision)", () => {
  assert.equal(isSameMailbox("jose.tanaka@tecpetrol.com", "jose.somale@tecpetrol.com"), false);
  assert.equal(isSameMailbox("juan.barrere@pampaenergia.com", "juan.vespa@pampaenergia.com"), false);
});

test("isSameMailbox: unrelated domains sharing a first label do not match", () => {
  assert.equal(isSameMailbox("alice@acme.com", "alice@acme-evil.com"), false);
});

test("isSameMailbox: a subdomain does not match a different domain that starts with the same letters", () => {
  assert.equal(isSameMailbox("alice@mail.acme.com", "alice@notacme.com"), false);
});

test("isSameMailbox: a single initial with nothing else left does not match the bare surname (>=2-token floor)", () => {
  assert.equal(isSameMailbox("j.smith@acme.com", "smith@acme.com"), false);
});

test("isSameMailbox: an address with no '@' never matches", () => {
  assert.equal(isSameMailbox("not-an-email", "smith@acme.com"), false);
  assert.equal(isSameMailbox("smith@acme.com", "not-an-email"), false);
});

test("isSameMailbox: plus-addressing is ignored", () => {
  assert.equal(isSameMailbox("juan.montanaro+crm@jpmorgan.com", "juan.montanaro@jpmorgan.com"), true);
});

// --- Issue 1: the sole-token concatenation rule is not transitive ----------
//
// A no-separator local part accepts EVERY split of the same character
// sequence, so it can match two addresses that a direct (both-separated)
// comparison says are different people. classifyMailboxMatch lets the
// caller see WHICH rule fired so classifyDuplicatePairBucket can route a
// sole-token-only match to "review" instead of treating it the same as an
// exact or initials match.

test("classifyMailboxMatch: sole-token rule is not transitive (A~B, A~C, but B!~C)", () => {
  assert.equal(classifyMailboxMatch("marcostrillo@empresa.com", "marco.strillo@empresa.com"), "sole-token");
  assert.equal(classifyMailboxMatch("marcostrillo@empresa.com", "marcos.trillo@empresa.com"), "sole-token");
  assert.equal(classifyMailboxMatch("marcos.trillo@empresa.com", "marco.strillo@empresa.com"), "none");
});

test("isSameMailbox: mirrors the non-transitive sole-token matches (boolean wrapper over classifyMailboxMatch)", () => {
  assert.equal(isSameMailbox("marcostrillo@empresa.com", "marco.strillo@empresa.com"), true);
  assert.equal(isSameMailbox("marcostrillo@empresa.com", "marcos.trillo@empresa.com"), true);
  assert.equal(isSameMailbox("marcos.trillo@empresa.com", "marco.strillo@empresa.com"), false);
});

// --- Defect 1: rule A must be boundary-sensitive, not a naive join("") ------

test("isSameMailbox: boundary disagreement between two separated local parts is false (marcos.trillo vs marco.strillo)", () => {
  assert.equal(isSameMailbox("marcos.trillo@empresa.com", "marco.strillo@empresa.com"), false);
});

test("isSameMailbox: boundary disagreement between two separated local parts is false (ana.maria vs an.amaria)", () => {
  assert.equal(isSameMailbox("ana.maria@empresa.com", "an.amaria@empresa.com"), false);
});

test("isSameMailbox: production true-cases still hold after the boundary-sensitive rewrite", () => {
  assert.equal(isSameMailbox("juanmontanaro@jpmorgan.com", "juan.montanaro@jpmorgan.com"), true); // single-token side
  assert.equal(isSameMailbox("abresciani@rappachiani.com", "abresciani@rappachiani.com.ar"), true); // identical sequences
  assert.equal(isSameMailbox("martín.medina@ladonware.com", "martin.medina@ladonware.com"), true); // identical after accent strip
  assert.equal(isSameMailbox("javier.astort@wolox.com.ar", "javier.s.astort@wolox.com.ar"), true); // rule B, middle initial
});

test("isSameMailbox: production must-stay-dismiss pairs still hold after the boundary-sensitive rewrite", () => {
  assert.equal(isSameMailbox("jose.tanaka@tecpetrol.com", "jose.somale@tecpetrol.com"), false);
  assert.equal(isSameMailbox("juan.barrere@pampaenergia.com", "juan.vespa@pampaenergia.com"), false);
});

// --- Defect 2: same-mailbox bucket requires BOTH sides verified -------------

test("classifyDuplicatePairBucket: same-mailbox-looking pair with one side unverified does NOT get two_emails_same_mailbox", () => {
  const a = pf({ email: "juanmontanaro@jpmorgan.com", emailStatus: "verified" });
  const b = pf({ email: "juan.montanaro@jpmorgan.com", emailStatus: "probable" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_differ_unverified");
  assert.equal(tierForBucket(bucket), "review");
});

test("classifyDuplicatePairBucket: same-mailbox-looking pair with neither side verified does NOT get two_emails_same_mailbox", () => {
  const a = pf({ email: "juanmontanaro@jpmorgan.com", emailStatus: "none" });
  const b = pf({ email: "juan.montanaro@jpmorgan.com", emailStatus: "probable" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_differ_unverified");
  assert.equal(tierForBucket(bucket), "review");
});

// --- Defect 4 helper: pickEmailWinnerSide mirrors merge.ts's mergeEmailFields ---

test("pickEmailWinnerSide: higher-ranked emailStatus wins", () => {
  assert.equal(
    pickEmailWinnerSide({ email: "a@corp.com", emailStatus: "probable" }, { email: "b@corp.com", emailStatus: "verified" }),
    "merged",
  );
});

test("pickEmailWinnerSide: ties go to the survivor", () => {
  assert.equal(
    pickEmailWinnerSide({ email: "a@corp.com", emailStatus: "verified" }, { email: "b@corp.com", emailStatus: "verified" }),
    "survivor",
  );
});

test("hasNonAsciiLocalPart: detects an accented local part, not a plain ASCII one", () => {
  assert.equal(hasNonAsciiLocalPart("martín.medina@ladonware.com"), true);
  assert.equal(hasNonAsciiLocalPart("martin.medina@ladonware.com"), false);
});

test("classifyDuplicatePairBucket: two verified emails that are the same mailbox (identical token sequences, ccTLD suffix) is safe, not dismiss", () => {
  // Changed from the old juanmontanaro/juan.montanaro fixture: that pair
  // matches ONLY via the sole-token concatenation rule, which is not
  // transitive (see Issue 1 above) and now routes to
  // "two_emails_same_mailbox_ambiguous" / tier "review", not "safe". This
  // test keeps the original intent (a same-mailbox pair must not be
  // dismissed) using a pair matched by identical token sequences instead.
  const a = pf({ email: "abresciani@rappachiani.com", emailStatus: "verified" });
  const b = pf({ email: "abresciani@rappachiani.com.ar", emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_same_mailbox");
  assert.equal(tierForBucket(bucket), "safe");
});

test("classifyDuplicatePairBucket: a middle-initial same-mailbox pair is safe, not dismiss", () => {
  const a = pf({ email: "javier.astort@wolox.com.ar", emailStatus: "verified" });
  const b = pf({ email: "javier.s.astort@wolox.com.ar", emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_same_mailbox");
  assert.equal(tierForBucket(bucket), "safe");
});

test("classifyDuplicatePairBucket: a sole-token-only same-mailbox match is 'two_emails_same_mailbox_ambiguous' (tier review), not 'two_emails_same_mailbox' (tier safe)", () => {
  const a = pf({ email: "juanmontanaro@jpmorgan.com", emailStatus: "verified" });
  const b = pf({ email: "juan.montanaro@jpmorgan.com", emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_same_mailbox_ambiguous");
  assert.equal(tierForBucket(bucket), "review");
});

test("regression (Issue 1 trap): a sole-token same-mailbox pair must never land in tier dismiss", () => {
  // This is the exact trap the module header warns about: deleting the
  // sole-token rule outright would make isSameMailbox return false here,
  // which would fall through to "two_emails_differ_verified" -> tier
  // "dismiss" (a permanent not_duplicate that --revert cannot undo). The fix
  // must route this pair to "review" instead, never to "dismiss" or "safe".
  const a = pf({ email: "juanmontanaro@jpmorgan.com", emailStatus: "verified" });
  const b = pf({ email: "juan.montanaro@jpmorgan.com", emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.notEqual(tierForBucket(bucket), "dismiss");
  assert.equal(tierForBucket(bucket), "review");
});

test("classifyDuplicatePairBucket: two verified emails on the same domain but genuinely different people stays dismiss", () => {
  const a = pf({ email: "jose.tanaka@tecpetrol.com", emailStatus: "verified" });
  const b = pf({ email: "jose.somale@tecpetrol.com", emailStatus: "verified" });
  const bucket = classifyDuplicatePairBucket(a, b);
  assert.equal(bucket, "two_emails_differ_verified");
  assert.equal(tierForBucket(bucket), "dismiss");
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

test("planDuplicateTierRun: a same-mailbox verified pair (identical token sequences) lands in the safe plan, not the dismiss plan", () => {
  // Changed from the old juanmontanaro/juan.montanaro fixture for the same
  // reason as the classifyDuplicatePairBucket test above: that pair now
  // belongs in "review", not "safe". See the dedicated sole-token test below.
  const a = planPerson({ id: "a", email: "abresciani@rappachiani.com", emailStatus: "verified" });
  const b = planPerson({ id: "b", email: "abresciani@rappachiani.com.ar", emailStatus: "verified" });
  const pairs: DuplicatePairPlanInput[] = [pairInput("c1", a, b, "name_company")];

  const safePlan = planDuplicateTierRun(pairs, "safe");
  assert.equal(safePlan.bucketCounts.two_emails_same_mailbox, 1);
  assert.equal(safePlan.tierCounts.safe, 1);
  assert.equal(safePlan.tierCounts.dismiss, 0);
  assert.equal(safePlan.entries.length, 1);
  assert.equal(safePlan.entries[0].kind, "merge");

  const dismissPlan = planDuplicateTierRun(pairs, "dismiss");
  assert.equal(dismissPlan.tierCounts.dismiss, 0);
  assert.equal(dismissPlan.entries.length, 0);
});

test("planDuplicateTierRun: a sole-token-only same-mailbox pair appears in neither the safe plan nor the dismiss plan", () => {
  const a = planPerson({ id: "a", email: "juanmontanaro@jpmorgan.com", emailStatus: "verified" });
  const b = planPerson({ id: "b", email: "juan.montanaro@jpmorgan.com", emailStatus: "verified" });
  const pairs: DuplicatePairPlanInput[] = [pairInput("c1", a, b, "name_company")];

  const safePlan = planDuplicateTierRun(pairs, "safe");
  assert.equal(safePlan.bucketCounts.two_emails_same_mailbox_ambiguous, 1);
  assert.equal(safePlan.tierCounts.safe, 0);
  assert.equal(safePlan.tierCounts.review, 1);
  assert.equal(safePlan.entries.length, 0);

  const dismissPlan = planDuplicateTierRun(pairs, "dismiss");
  assert.equal(dismissPlan.tierCounts.dismiss, 0);
  assert.equal(dismissPlan.entries.length, 0);
});

// --- Defect 3: accent-survivor override for two_emails_same_mailbox --------

test("planDuplicateTierRun: the ASCII side wins the survivor slot in an accented/ASCII same-mailbox pair, even when chooseDefaultSurvivor would otherwise have picked the accented side", () => {
  // Neither side has a profile_key or connections, so chooseDefaultSurvivor
  // falls through to its createdAt tie-break — the accented side is created
  // earlier, so on its own chooseDefaultSurvivor would pick "a" (accented).
  // The accent override must still force the plain-ASCII side ("b") to
  // survive, and since neither side has a profile_key or messages to lose,
  // the swap must produce a clean "merge", not a survivor-loss skip.
  const a = planPerson({
    id: "accented",
    email: "martín.medina@ladonware.com",
    emailStatus: "verified",
    createdAt: new Date("2025-01-01"),
  });
  const b = planPerson({
    id: "ascii",
    email: "martin.medina@ladonware.com",
    emailStatus: "verified",
    createdAt: new Date("2025-06-01"),
  });
  const plan = planDuplicateTierRun([pairInput("c1", a, b)], "safe");

  assert.equal(plan.bucketCounts.two_emails_same_mailbox, 1);
  const entry = plan.entries[0];
  assert.equal(entry.kind, "merge");
  assert.equal((entry as { survivorId: string }).survivorId, "ascii");
  assert.equal((entry as { mergedId: string }).mergedId, "accented");
});

test("planDuplicateTierRun: the accent swap still yields skip_survivor_loss when the ASCII side would lose the profile_key", () => {
  // Same shape as above, but now the ASCII side has no synced messages while
  // the accented side (which the swap would demote to "merged") does — the
  // swap must run BEFORE checkSurvivorLoss so the guard still catches it.
  const a = planPerson({
    id: "accented",
    email: "martín.medina@ladonware.com",
    emailStatus: "verified",
    profileKey: "martin-medina",
    connections: [{ connectedOn: null, messageCount: 15 }],
  });
  const b = planPerson({ id: "ascii", email: "martin.medina@ladonware.com", emailStatus: "verified", connections: [] });
  const plan = planDuplicateTierRun([pairInput("c1", a, b)], "safe");

  const entry = plan.entries[0];
  assert.equal(entry.kind, "skip_survivor_loss");
  assert.equal((entry as { survivorId: string }).survivorId, "ascii");
  assert.equal((entry as { mergedId: string }).mergedId, "accented");
  assert.equal((entry as { loss: { losesGmailMessages: boolean; losesProfileKey: boolean } }).loss.losesGmailMessages, true);
  assert.equal((entry as { loss: { losesGmailMessages: boolean; losesProfileKey: boolean } }).loss.losesProfileKey, true);
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
