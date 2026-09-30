/**
 * Pure tier classification + run planning for scripts/merge-duplicates.ts,
 * the owner-run bulk-merge CLI over the /admin/duplicates queue. Re-derives
 * which "tier" each OPEN duplicate_candidate pair falls into from the
 * person rows themselves at run time (never hardcoded ids/counts — the
 * queue can change between runs).
 *
 * Buckets (mutually exclusive, derived from person.email/profileKey/
 * jobTitle/ownerBdId only):
 * - "same_email": both sides have the same email (any status) — the
 *   `email_unverified` review reason always lands here, since that's why the
 *   matcher flagged it.
 * - "classic_split_no_conflict" / "classic_split_conflict": exactly one
 *   side has an email and the OTHER has a profile_key (never both on the
 *   same side) — the "one HubSpot-import row, one LinkedIn row" shape.
 *   Conflict = a title or owner disagreement between the two sides.
 * - "one_email_not_classic": exactly one side has an email, but not paired
 *   with a profile_key on the complementary side.
 * - "two_emails_differ_verified" / "two_emails_differ_unverified": both
 *   sides have an email and they differ — verified on both sides suggests
 *   two different real people (dismiss); anything less certain is left for
 *   manual review.
 * - "no_email_titles_agree" / "no_email_titles_conflict": neither side has
 *   an email; split by whether the job titles agree (or one/both are
 *   blank) or actively conflict.
 *
 * Tiers: "safe" (same_email, classic_split_no_conflict) is what
 * `--tier=safe` merges; "dismiss" (two_emails_differ_verified) is what
 * `--tier=dismiss` marks not-a-duplicate; everything else is "review" and
 * this script never touches it.
 *
 * Transitive chains (A-B, B-C sharing person B) are never merged by this
 * planner, in either tier: `findChainedPersonIds` flags every person who
 * appears in more than one OPEN pair, and `planDuplicateTierRun` skips any
 * pair touching a flagged person, reporting it separately instead of
 * guessing a merge order. This is the deliberate, simplest choice that
 * makes a half-merged chain structurally impossible — nothing in a chain is
 * ever written by this script, so there's nothing to leave half-done.
 */
import { chooseDefaultSurvivor, type SurvivorCandidate } from "@/lib/identity/duplicateReviewView";
import type { EmailStatus } from "@/lib/identity/matcher";

// --- Bucket classification --------------------------------------------------

export type DuplicatePairBucket =
  | "same_email"
  | "classic_split_no_conflict"
  | "classic_split_conflict"
  | "one_email_not_classic"
  | "two_emails_differ_verified"
  | "two_emails_differ_unverified"
  | "no_email_titles_agree"
  | "no_email_titles_conflict";

export type DuplicatePairTier = "safe" | "dismiss" | "review";

export interface DuplicateTierPersonFields {
  email: string | null;
  emailStatus: EmailStatus;
  profileKey: string | null;
  jobTitle: string | null;
  ownerBdId: string | null;
}

function normalizedTitle(title: string | null): string | null {
  const t = title?.trim().toLowerCase();
  return t ? t : null;
}

export function hasTitleConflict(a: DuplicateTierPersonFields, b: DuplicateTierPersonFields): boolean {
  const ta = normalizedTitle(a.jobTitle);
  const tb = normalizedTitle(b.jobTitle);
  return ta !== null && tb !== null && ta !== tb;
}

export function hasOwnerConflict(a: DuplicateTierPersonFields, b: DuplicateTierPersonFields): boolean {
  return a.ownerBdId !== null && b.ownerBdId !== null && a.ownerBdId !== b.ownerBdId;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function classifyDuplicatePairBucket(
  a: DuplicateTierPersonFields,
  b: DuplicateTierPersonFields,
): DuplicatePairBucket {
  const hasEmailA = !!a.email;
  const hasEmailB = !!b.email;
  const hasProfileA = !!a.profileKey;
  const hasProfileB = !!b.profileKey;

  const classicSplit =
    (hasEmailA && !hasEmailB && hasProfileB && !hasProfileA) ||
    (hasEmailB && !hasEmailA && hasProfileA && !hasProfileB);

  if (classicSplit) {
    return hasTitleConflict(a, b) || hasOwnerConflict(a, b) ? "classic_split_conflict" : "classic_split_no_conflict";
  }

  if (hasEmailA && hasEmailB) {
    if (normalizedEmail(a.email as string) === normalizedEmail(b.email as string)) return "same_email";
    const bothVerified = a.emailStatus === "verified" && b.emailStatus === "verified";
    return bothVerified ? "two_emails_differ_verified" : "two_emails_differ_unverified";
  }

  if (hasEmailA || hasEmailB) return "one_email_not_classic";

  return hasTitleConflict(a, b) ? "no_email_titles_conflict" : "no_email_titles_agree";
}

const SAFE_BUCKETS: ReadonlySet<DuplicatePairBucket> = new Set(["same_email", "classic_split_no_conflict"]);
const DISMISS_BUCKETS: ReadonlySet<DuplicatePairBucket> = new Set(["two_emails_differ_verified"]);

export function tierForBucket(bucket: DuplicatePairBucket): DuplicatePairTier {
  if (SAFE_BUCKETS.has(bucket)) return "safe";
  if (DISMISS_BUCKETS.has(bucket)) return "dismiss";
  return "review";
}

// --- Transitive-chain detection --------------------------------------------

export interface DuplicatePairIdentity {
  candidateId: string;
  personAId: string;
  personBId: string;
}

/**
 * Person ids that appear in more than one OPEN duplicate_candidate pair —
 * the transitive-chain case (27 pairs / 54 persons at the time this script
 * was written, per the queue analysis; re-derived here, never hardcoded).
 */
export function findChainedPersonIds(pairs: readonly DuplicatePairIdentity[]): ReadonlySet<string> {
  const degree = new Map<string, number>();
  for (const p of pairs) {
    degree.set(p.personAId, (degree.get(p.personAId) ?? 0) + 1);
    degree.set(p.personBId, (degree.get(p.personBId) ?? 0) + 1);
  }
  const chained = new Set<string>();
  for (const [id, count] of degree) {
    if (count > 1) chained.add(id);
  }
  return chained;
}

export function isPairChained(pair: DuplicatePairIdentity, chainedPersonIds: ReadonlySet<string>): boolean {
  return chainedPersonIds.has(pair.personAId) || chainedPersonIds.has(pair.personBId);
}

// --- Survivor-loss guard -----------------------------------------------------

export interface DuplicateTierConnectionFields {
  messageCount: number;
}

export interface SurvivorLossCheckInput {
  survivorProfileKey: string | null;
  survivorConnections: readonly DuplicateTierConnectionFields[];
  mergedProfileKey: string | null;
  mergedConnections: readonly DuplicateTierConnectionFields[];
}

export interface SurvivorLossResult {
  losesGmailMessages: boolean;
  losesProfileKey: boolean;
}

function totalMessages(connections: readonly DuplicateTierConnectionFields[]): number {
  return connections.reduce((sum, c) => sum + c.messageCount, 0);
}

/**
 * Detects the case `chooseDefaultSurvivor` doesn't guard against on its
 * own: it only compares profile_key and earliest connection date, never
 * synced Gmail message counts. If the side it WOULD pick as survivor has no
 * synced messages while the losing side does (or the survivor lacks a
 * profile_key the losing side has), that's surfaced for a human instead of
 * silently merging.
 */
export function checkSurvivorLoss(input: SurvivorLossCheckInput): SurvivorLossResult {
  const losesGmailMessages = totalMessages(input.mergedConnections) > 0 && totalMessages(input.survivorConnections) === 0;
  const losesProfileKey = !input.survivorProfileKey && !!input.mergedProfileKey;
  return { losesGmailMessages, losesProfileKey };
}

// --- Full run planner ---------------------------------------------------------

export interface DuplicatePairPlanPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  profileKey: string | null;
  jobTitle: string | null;
  ownerBdId: string | null;
  createdAt: Date;
  connections: readonly { connectedOn: string | null; messageCount: number }[];
}

export interface DuplicatePairPlanInput {
  candidateId: string;
  reason: string;
  personA: DuplicatePairPlanPerson;
  personB: DuplicatePairPlanPerson;
}

export type DuplicatePairPlanEntry =
  | { kind: "merge"; candidateId: string; reason: string; bucket: DuplicatePairBucket; survivorId: string; mergedId: string }
  | { kind: "dismiss"; candidateId: string; reason: string; bucket: DuplicatePairBucket }
  | { kind: "skip_chain"; candidateId: string; reason: string; bucket: DuplicatePairBucket; tier: DuplicatePairTier }
  | {
      kind: "skip_survivor_loss";
      candidateId: string;
      reason: string;
      bucket: DuplicatePairBucket;
      survivorId: string;
      mergedId: string;
      loss: SurvivorLossResult;
    };

export type DuplicateBucketCounts = Record<DuplicatePairBucket, number>;

export interface DuplicateTierPlan {
  tier: "safe" | "dismiss";
  bucketCounts: DuplicateBucketCounts;
  tierCounts: { safe: number; dismiss: number; review: number };
  chainedCandidateIds: readonly string[];
  entries: readonly DuplicatePairPlanEntry[];
}

const ALL_BUCKETS: readonly DuplicatePairBucket[] = [
  "same_email",
  "classic_split_no_conflict",
  "classic_split_conflict",
  "one_email_not_classic",
  "two_emails_differ_verified",
  "two_emails_differ_unverified",
  "no_email_titles_agree",
  "no_email_titles_conflict",
];

function emptyBucketCounts(): DuplicateBucketCounts {
  const counts = {} as DuplicateBucketCounts;
  for (const bucket of ALL_BUCKETS) counts[bucket] = 0;
  return counts;
}

function toSurvivorCandidate(p: DuplicatePairPlanPerson): SurvivorCandidate {
  return { id: p.id, profileKey: p.profileKey, createdAt: p.createdAt };
}

function pairIdentity(pair: DuplicatePairPlanInput): DuplicatePairIdentity {
  return { candidateId: pair.candidateId, personAId: pair.personA.id, personBId: pair.personB.id };
}

/**
 * Pure planner (no DB access): classifies every open pair, counts every
 * bucket/tier (for the dry run's overall report, independent of which tier
 * was selected), and selects the entries the requested tier would act on.
 * Never mutates `pairs` — reads only. Calling this twice with the same
 * `pairs` array produces two structurally identical plans and leaves
 * `pairs` byte-for-byte unchanged (see tests/unit/duplicateTiering.test.ts).
 */
export function planDuplicateTierRun(pairs: readonly DuplicatePairPlanInput[], tier: "safe" | "dismiss"): DuplicateTierPlan {
  const bucketCounts = emptyBucketCounts();
  const tierCounts = { safe: 0, dismiss: 0, review: 0 };
  const chainedPersonIds = findChainedPersonIds(pairs.map(pairIdentity));
  const chainedCandidateIds: string[] = [];
  const entries: DuplicatePairPlanEntry[] = [];

  // Sort by candidateId so the plan (and its printed report) is deterministic
  // regardless of the order rows came back from the DB.
  const sorted = [...pairs].sort((x, y) => (x.candidateId < y.candidateId ? -1 : x.candidateId > y.candidateId ? 1 : 0));

  for (const pair of sorted) {
    const bucket = classifyDuplicatePairBucket(pair.personA, pair.personB);
    bucketCounts[bucket] += 1;
    const pairTier = tierForBucket(bucket);
    tierCounts[pairTier] += 1;

    if (pairTier !== tier) continue;

    const identity = pairIdentity(pair);
    if (isPairChained(identity, chainedPersonIds)) {
      chainedCandidateIds.push(pair.candidateId);
      entries.push({ kind: "skip_chain", candidateId: pair.candidateId, reason: pair.reason, bucket, tier: pairTier });
      continue;
    }

    if (tier === "dismiss") {
      entries.push({ kind: "dismiss", candidateId: pair.candidateId, reason: pair.reason, bucket });
      continue;
    }

    const side = chooseDefaultSurvivor(
      toSurvivorCandidate(pair.personA),
      pair.personA.connections,
      toSurvivorCandidate(pair.personB),
      pair.personB.connections,
    );
    const survivor = side === "a" ? pair.personA : pair.personB;
    const merged = side === "a" ? pair.personB : pair.personA;
    const loss = checkSurvivorLoss({
      survivorProfileKey: survivor.profileKey,
      survivorConnections: survivor.connections,
      mergedProfileKey: merged.profileKey,
      mergedConnections: merged.connections,
    });

    if (loss.losesGmailMessages || loss.losesProfileKey) {
      entries.push({
        kind: "skip_survivor_loss",
        candidateId: pair.candidateId,
        reason: pair.reason,
        bucket,
        survivorId: survivor.id,
        mergedId: merged.id,
        loss,
      });
      continue;
    }

    entries.push({ kind: "merge", candidateId: pair.candidateId, reason: pair.reason, bucket, survivorId: survivor.id, mergedId: merged.id });
  }

  return { tier, bucketCounts, tierCounts, chainedCandidateIds, entries };
}
