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
 * - "two_emails_same_mailbox": both sides have an email, BOTH are
 *   `emailStatus === "verified"`, the raw strings differ, but they're the
 *   same mailbox on THE SAME DOMAIN written two different ways — a
 *   separator, a middle-initial token, an accented character, or
 *   plus-addressing. Routed to "safe" (see classifyMailboxMatch's "exact"
 *   and "initials" results). Identical domains are required precisely so
 *   that this tier is transitive; a ccTLD-related domain goes to
 *   "two_emails_same_mailbox_ambiguous" instead, for the reason given
 *   there. The
 *   verified-only gate is deliberate: unverified addresses in this database
 *   are largely inferred/deduced, not observed, which is exactly where a
 *   string heuristic is least trustworthy — an unverified pair that merely
 *   LOOKS like the same mailbox still falls through to
 *   "two_emails_differ_unverified" (review), never auto-merged. This bucket
 *   exists BECAUSE two verified, differing emails do not reliably mean two
 *   different real people: of the 6 production pairs that used to land in
 *   "two_emails_differ_verified", 4 were the same person. Only 2 of those 4
 *   are in THIS bucket today —
 *   `javier.astort@wolox.com.ar` / `javier.s.astort@wolox.com.ar` (middle initial),
 *   `martín.medina@ladonware.com` / `martin.medina@ladonware.com` (accent).
 *   The other 2 have since moved to "two_emails_same_mailbox_ambiguous",
 *   each because the rule that matched them turned out to be
 *   non-transitive: `juanmontanaro@jpmorgan.com` /
 *   `juan.montanaro@jpmorgan.com` (sole-token) and
 *   `abresciani@rappachiani.com` / `abresciani@rappachiani.com.ar` (ccTLD).
 *   All 4 were merged by run d097caed before that tightening, which is why
 *   they are named here: they are the evidence, not the current contents.
 *   Merging is safe here even though `mergeEmailFields` (merge.ts) discards
 *   one of the two addresses: the discarded address is recorded as a
 *   `PropertyLoss` in the merge snapshot, so it's recoverable via
 *   `unmergeContact` if the match is ever wrong. For this bucket
 *   specifically, `planDuplicateTierRun` also overrides which side survives
 *   when exactly one local part is non-ASCII and the other is plain ASCII
 *   (an accented local part is a HubSpot-import data-entry artifact, not a
 *   different mailbox) — see the accent-survivor override below.
 * - "two_emails_same_mailbox_ambiguous": both sides have an email, both are
 *   `emailStatus === "verified"`, and they were flagged as the same mailbox
 *   only by a rule that is NOT transitive — classifyMailboxMatch's
 *   "sole-token" (one side has no separator at all, so it's read as the
 *   concatenation of the other side's tokens) or "cctld" (the two domains
 *   differ but one is a ccTLD extension of the other). Routed to "review",
 *   not "safe". Take "sole-token": a no-separator local part accepts EVERY
 *   split of the same character sequence, so e.g. `marcostrillo` matches BOTH
 *   `marco.strillo` and `marcos.trillo` even though a direct comparison of
 *   those two (`marcos.trillo` vs `marco.strillo`) is false — two different
 *   real people. "cctld" fails the same way one level down: `acme.com.ar`
 *   and `acme.com.mx` are each an extension of `acme.com` but not of each
 *   other, so a hub domain would let two unrelated country mailboxes merge
 *   into it across separate runs (the chain guard below only covers pairs
 *   open in the SAME run). An equality relation that isn't transitive means
 *   the evidence is real but not conclusive on its own, so a human confirms
 *   it instead: NOT "safe" (an auto-merge could combine two different people
 *   on the strength of a single ambiguous rule). Historically this also had
 *   to avoid a "dismiss" tier that no longer exists (see "Retired: the
 *   dismiss tier" below) — dropping the rule entirely and falling through to
 *   "two_emails_differ_verified" used to permanently mark a genuine match as
 *   not-a-duplicate with no revert path, which was the original bug this
 *   module exists to fix. What is left in
 *   "two_emails_same_mailbox" — identical token sequences or the
 *   middle-initial rule, both on one identical domain — reduces to equality
 *   of a derived token sequence, which IS transitive. That is the property
 *   the auto-merge tier needs: it must be closed under the relation it uses,
 *   or merging pairwise can still combine two people the relation itself
 *   calls different.
 * - "two_emails_differ_verified" / "two_emails_differ_unverified": both
 *   sides have an email, they differ, and they are NOT the same mailbox
 *   (isSameMailbox is false). The BUCKET split (both sides verified vs. not)
 *   is kept because it is still useful information in the dry run's report,
 *   but as of the removal below BOTH buckets route to tier "review" — see
 *   "Retired: the dismiss tier" for why "two_emails_differ_verified" no
 *   longer gets special treatment.
 * - "no_email_titles_agree" / "no_email_titles_conflict": neither side has
 *   an email; split by whether the job titles agree (or one/both are
 *   blank) or actively conflict.
 *
 * Tiers: "safe" (same_email, classic_split_no_conflict,
 * two_emails_same_mailbox) is what `--tier=safe` merges; everything else is
 * "review" and this script never touches it.
 *
 * Retired: the dismiss tier (2026-09). "two_emails_differ_verified" used to
 * route to a "dismiss" tier that permanently marked a duplicate_candidate
 * pair `not_duplicate` via scripts/merge-duplicates.ts --tier=dismiss, on the
 * premise that two different verified emails mean two different people. It
 * doesn't, reliably: of the 9 production pairs that ever landed in this
 * bucket, the premise held 2 times. The 7 misses were one real person with a
 * ccTLD domain, a dot separator, a middle initial, an accented local part, a
 * two-letter typo, a short form vs. a full form, or a personal address
 * alongside a work one. The 2 hits that were genuinely two different people
 * (Tanaka/Somale, Barrere/Vespa) had one thing in common that the misses
 * didn't: a different SURNAME TOKEN in the local part, not merely a
 * different address string. That is the actual distinguishing signal this
 * module never captured — "the addresses differ" is not it, which is why a
 * 22%-accurate heuristic was driving a write with no revert path
 * (`--revert` only ever undid merges, never dismissals). Dismissal is now
 * exclusively a human judgement call made in /admin/duplicates.
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
import { pickEmailWinner } from "@/lib/identity/merge";
import { type EmailStatus } from "@/lib/identity/matcher";

// --- Bucket classification --------------------------------------------------

export type DuplicatePairBucket =
  | "same_email"
  | "classic_split_no_conflict"
  | "classic_split_conflict"
  | "one_email_not_classic"
  | "two_emails_same_mailbox"
  | "two_emails_same_mailbox_ambiguous"
  | "two_emails_differ_verified"
  | "two_emails_differ_unverified"
  | "no_email_titles_agree"
  | "no_email_titles_conflict";

export type DuplicatePairTier = "safe" | "review";

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

// --- Same-mailbox detection --------------------------------------------------

/**
 * True when `a` and `b` are the same organization's domain, allowing only a
 * trailing ccTLD-style suffix: every extra label beyond the shorter domain
 * must be exactly 2 characters (e.g. `rappachiani.com` vs
 * `rappachiani.com.ar`, `acme.co` vs `acme.co.uk`). Deliberately does NOT
 * strip a public-suffix list and does NOT match on a shared first label, so
 * `acme.com` / `acme-evil.com` and `mail.acme.com` / `notacme.com` are both
 * rejected.
 */
export function sameOrganizationDomain(domainA: string, domainB: string): boolean {
  const a = domainA.trim().toLowerCase();
  const b = domainB.trim().toLowerCase();
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.startsWith(`${shorter}.`)) return false;
  const extraLabels = longer.slice(shorter.length + 1).split(".");
  return extraLabels.length > 0 && extraLabels.every((label) => label.length === 2);
}

// Written as escapes on purpose: the literal form of this range is invisible
// combining characters, which no reviewer can see and any editor can mangle.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Lowercases, trims, drops plus-addressing, strips accents, and splits the
 * local part into dot/underscore/dash-separated tokens.
 */
export function normalizeLocalPart(local: string): string[] {
  const withoutPlus = local.trim().toLowerCase().split("+")[0];
  const withoutAccents = withoutPlus.normalize("NFD").replace(COMBINING_MARKS_RE, "");
  return withoutAccents.split(/[._-]/).filter((token) => token.length > 0);
}

/**
 * Which rule (if any) established that two raw email addresses are the same
 * mailbox written two different ways:
 *   - "none": not the same mailbox (different domain, or local-part tokens
 *     that neither match exactly nor satisfy the initials rule).
 *   - "exact": the two normalized local-part token sequences are identical
 *     (same length, same tokens, same order) — e.g. `abresciani` vs
 *     `abresciani` (ccTLD-only domain difference), or `martin.medina` vs
 *     `martin.medina` (post-accent-strip). Both sides carry the same
 *     boundary information, so this is unambiguous.
 *   - "initials": dropping every single-character token from both sides
 *     leaves identical token sequences AND both sides still have at least 2
 *     tokens (covers a middle initial like `javier.astort` /
 *     `javier.s.astort`). The >=2-token floor is what stops `j.smith` from
 *     matching bare `smith` — a single initial with nothing else left is too
 *     little evidence to call it the same mailbox. Also unambiguous: both
 *     sides agree on every surviving token boundary.
 *   - "sole-token": exactly one side has a single token (no separator at
 *     all), and that token equals the other side's tokens concatenated with
 *     no separator — e.g. `juanmontanaro` (one token) vs `juan.montanaro`
 *     (two tokens). Deliberately boundary-INSENSITIVE, unlike "exact"/
 *     "initials": a side with NO separator supplies no boundary information
 *     to contradict, so concatenating is the only reading available for it.
 *   - "cctld": the local parts matched by the "exact" or "initials" rule,
 *     but the two DOMAINS are not identical — one is a ccTLD extension of
 *     the other (`rappachiani.com` vs `rappachiani.com.ar`). Reported
 *     separately because the domain relation carries its own ambiguity, no
 *     matter how well the local parts agree: the address may belong to one
 *     person or to that company's country office, and only a human can say.
 *
 * "exact" and "initials" both require identical domains, and both reduce to
 * equality of a derived token sequence, so both are transitive. "sole-token"
 * and "cctld" are NOT, and that is exactly why callers must be able to tell
 * them apart from "exact"/"initials" instead of folding everything into one
 * boolean. A no-separator local part accepts EVERY split of the same
 * character sequence: `marcostrillo` matches BOTH `marco.strillo` AND
 * `marcos.trillo` via "sole-token", even though comparing those two
 * DIRECTLY (`marcos.trillo` vs `marco.strillo`, both separated) is "none" —
 * four different real people, and disagreeing boundaries on both separated
 * sides are positive evidence of two different names, not noise to erase
 * (this is also why "exact"/"initials" never use a naive
 * `tokensA.join("") === tokensB.join("")`: that version made
 * `marcos.trillo`/`marco.strillo` and `ana.maria`/`an.amaria` compare equal,
 * since joining erases exactly the separator position that tells them
 * apart). "cctld" repeats the failure at the domain layer: `acme.com.ar` and
 * `acme.com.mx` are each an extension of `acme.com` but not of each other.
 * Because both kinds of evidence are real but not conclusive on their own,
 * classifyDuplicatePairBucket routes a pair matched only by "sole-token" or
 * "cctld" to "review" ("two_emails_same_mailbox_ambiguous"), not to "safe"
 * alongside "exact"/"initials" — see that bucket's doc comment above.
 */
export type MailboxMatchRule = "none" | "exact" | "initials" | "sole-token" | "cctld";

export function classifyMailboxMatch(emailA: string, emailB: string): MailboxMatchRule {
  const atA = emailA.lastIndexOf("@");
  const atB = emailB.lastIndexOf("@");
  if (atA < 0 || atB < 0) return "none";

  const localA = emailA.slice(0, atA);
  const domainA = emailA.slice(atA + 1);
  const localB = emailB.slice(0, atB);
  const domainB = emailB.slice(atB + 1);
  if (!localA || !domainA || !localB || !domainB) return "none";

  if (!sameOrganizationDomain(domainA, domainB)) return "none";

  const tokensA = normalizeLocalPart(localA);
  const tokensB = normalizeLocalPart(localB);
  if (tokensA.length === 0 || tokensB.length === 0) return "none";

  // `sameOrganizationDomain` accepts a ccTLD extension, and that relation is
  // NOT transitive: `acme.com.ar` and `acme.com.mx` are each an extension of
  // `acme.com`, but not of each other. A hub domain would therefore let two
  // unrelated country mailboxes merge into it across separate runs. So a
  // ccTLD-related pair is downgraded to "cctld" no matter how well the local
  // parts agree — `abresciani@rappachiani.com` and `abresciani@….com.ar` may
  // be one person or the Argentine office of the same company, and only a
  // human can say which. That leaves exact domain equality as the only
  // domain relation feeding the auto-merge tier, which is transitive.
  const domainsIdentical = domainA.trim().toLowerCase() === domainB.trim().toLowerCase();

  const sameSequence = tokensA.length === tokensB.length && tokensA.every((token, i) => token === tokensB[i]);
  if (sameSequence) return domainsIdentical ? "exact" : "cctld";

  // Drop single-character tokens (middle initials) from both sides before
  // comparing. The >=2 floor applies AFTER dropping: if either side is left
  // with fewer than 2 tokens, there isn't enough remaining evidence to call
  // it the same mailbox (this is what keeps `j.smith` from matching bare
  // `smith`, which would otherwise reduce to the same single token on both
  // sides).
  const withoutInitialsA = tokensA.filter((t) => t.length > 1);
  const withoutInitialsB = tokensB.filter((t) => t.length > 1);
  const initialsMatch =
    withoutInitialsA.length >= 2 &&
    withoutInitialsB.length >= 2 &&
    withoutInitialsA.length === withoutInitialsB.length &&
    withoutInitialsA.every((t, i) => t === withoutInitialsB[i]);
  if (initialsMatch) return domainsIdentical ? "initials" : "cctld";

  const soleTokenMatchesConcatenation =
    (tokensA.length === 1 && tokensA[0] === tokensB.join("")) ||
    (tokensB.length === 1 && tokensB[0] === tokensA.join(""));
  if (soleTokenMatchesConcatenation) return "sole-token";

  return "none";
}

/**
 * Boolean wrapper over classifyMailboxMatch, for callers that only need to
 * know whether two addresses are the same mailbox written two different
 * ways, not WHICH rule established it. classifyDuplicatePairBucket uses
 * classifyMailboxMatch directly instead, because it needs to route
 * "sole-token" matches differently (see classifyMailboxMatch's doc comment).
 */
export function isSameMailbox(emailA: string, emailB: string): boolean {
  return classifyMailboxMatch(emailA, emailB) !== "none";
}

// --- Non-ASCII local-part detection (defect 3: accent-survivor override) ---

const NON_ASCII_RE = /[^\x00-\x7F]/;

/**
 * True when an email's local part (before `@`) contains a non-ASCII
 * character (e.g. an accented letter). Used only by `planDuplicateTierRun`'s
 * `two_emails_same_mailbox` survivor override below — an accented local part
 * in a corporate mailbox is a HubSpot-import data-entry artifact, not a
 * deliverable address, so the plain-ASCII side should win the survivor slot
 * whenever the two sides disagree on this.
 */
export function hasNonAsciiLocalPart(email: string): boolean {
  const at = email.lastIndexOf("@");
  const local = at >= 0 ? email.slice(0, at) : email;
  return NON_ASCII_RE.test(local);
}

// --- Email-winner mirror (defect 4: dry-run property-loss line) ------------

/**
 * Which side `merge.ts`'s `mergeEmailFields` would pick as the email winner,
 * so `scripts/merge-duplicates.ts`'s dry run can describe in advance which
 * email a merge will discard. Resolves through the single shared
 * `pickEmailWinner` (merge.ts) rather than carrying its own copy of the
 * rule — see that function's doc comment for why, and
 * tests/unit/pickEmailWinner.test.ts for the proof that this and the live
 * merge write path can never quietly disagree.
 */
export function pickEmailWinnerSide(
  survivor: { email: string | null; emailStatus: EmailStatus },
  merged: { email: string | null; emailStatus: EmailStatus },
): "survivor" | "merged" {
  return pickEmailWinner(survivor, merged) === survivor ? "survivor" : "merged";
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
    // Same-mailbox heuristic is gated to BOTH sides verified: unverified
    // emails in this database are largely inferred/deduced, not observed,
    // which is exactly where a string heuristic is least trustworthy — an
    // unverified pair that merely looks like the same mailbox still needs a
    // human (falls through to the verified/unverified split below), never
    // auto-merges.
    if (bothVerified) {
      const mailboxMatch = classifyMailboxMatch(a.email as string, b.email as string);
      // "sole-token" and "cctld" are both non-transitive (see
      // classifyMailboxMatch's doc comment) — real evidence, but not
      // conclusive on its own, so they go to review rather than being treated
      // the same as "exact"/"initials". Only the two transitive rules, both
      // requiring identical domains, reach the auto-merge tier.
      if (mailboxMatch === "exact" || mailboxMatch === "initials") return "two_emails_same_mailbox";
      if (mailboxMatch === "sole-token" || mailboxMatch === "cctld") return "two_emails_same_mailbox_ambiguous";
    }
    return bothVerified ? "two_emails_differ_verified" : "two_emails_differ_unverified";
  }

  if (hasEmailA || hasEmailB) return "one_email_not_classic";

  return hasTitleConflict(a, b) ? "no_email_titles_conflict" : "no_email_titles_agree";
}

const SAFE_BUCKETS: ReadonlySet<DuplicatePairBucket> = new Set([
  "same_email",
  "classic_split_no_conflict",
  "two_emails_same_mailbox",
]);

export function tierForBucket(bucket: DuplicatePairBucket): DuplicatePairTier {
  if (SAFE_BUCKETS.has(bucket)) return "safe";
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
  tier: "safe";
  bucketCounts: DuplicateBucketCounts;
  tierCounts: { safe: number; review: number };
  chainedCandidateIds: readonly string[];
  entries: readonly DuplicatePairPlanEntry[];
}

/**
 * The canonical bucket enumeration, as a Record over the union rather than a
 * hand-kept array. Adding a member to `DuplicatePairBucket` without listing it
 * here is a COMPILE ERROR, which is the point: a bucket missing from this list
 * would be absent from `bucketCounts`, so it would escape both the dry run's
 * report and the test that asserts no bucket maps to a tier outside
 * {safe, review} — the guard that keeps the retired dismiss tier from coming
 * back unnoticed. A plain array plus `{} as DuplicateBucketCounts` compiled
 * happily with a member missing, which made that guard only as reliable as
 * whoever remembered to update the array.
 */
const BUCKET_REGISTRY: Record<DuplicatePairBucket, true> = {
  same_email: true,
  classic_split_no_conflict: true,
  classic_split_conflict: true,
  one_email_not_classic: true,
  two_emails_same_mailbox: true,
  two_emails_same_mailbox_ambiguous: true,
  two_emails_differ_verified: true,
  two_emails_differ_unverified: true,
  no_email_titles_agree: true,
  no_email_titles_conflict: true,
};

const ALL_BUCKETS: readonly DuplicatePairBucket[] = Object.keys(BUCKET_REGISTRY) as DuplicatePairBucket[];

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
export function planDuplicateTierRun(pairs: readonly DuplicatePairPlanInput[], tier: "safe"): DuplicateTierPlan {
  const bucketCounts = emptyBucketCounts();
  const tierCounts = { safe: 0, review: 0 };
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

    const side = chooseDefaultSurvivor(
      toSurvivorCandidate(pair.personA),
      pair.personA.connections,
      toSurvivorCandidate(pair.personB),
      pair.personB.connections,
    );
    let survivor = side === "a" ? pair.personA : pair.personB;
    let merged = side === "a" ? pair.personB : pair.personA;

    // Defect-3 accent-survivor override, scoped to this bucket only: an
    // accented local part in a corporate mailbox is a HubSpot-import
    // data-entry artifact, not a deliverable address. If exactly one side's
    // local part is non-ASCII, force the plain-ASCII side to survive,
    // overriding whatever chooseDefaultSurvivor picked above. Applied BEFORE
    // checkSurvivorLoss so the existing guard still catches it (and routes
    // to skip_survivor_loss) if the swap would cost a profile_key or synced
    // Gmail messages.
    if (bucket === "two_emails_same_mailbox") {
      const survivorNonAscii = hasNonAsciiLocalPart(survivor.email as string);
      const mergedNonAscii = hasNonAsciiLocalPart(merged.email as string);
      if (survivorNonAscii && !mergedNonAscii) {
        [survivor, merged] = [merged, survivor];
      }
    }

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
