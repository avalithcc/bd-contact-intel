/**
 * Pure planner behind scripts/backfill-person-names-from-email.ts: fills
 * EMPTY `person.first_name`/`person.last_name` from the verified email's
 * local part when — and only when — the local part is unambiguous. Refuses
 * rather than guesses (contact-identity spirit: a wrong name is worse than a
 * missing one).
 *
 * No DB access here — see nameFromEmailBackfillDb.ts for the thin DB layer
 * that reads candidates and applies the write. Reuses
 * src/lib/identity/matcher.ts#buildNameCompanyKey (the SAME key builder the
 * live identity matcher uses for its own name+company review key) for
 * findNameCompanyCollisions, per the "one key builder per map" rule — this
 * module must never re-derive that key a different way.
 */
import { buildNameCompanyKey, type ReviewReason } from "@/lib/identity/matcher";

/**
 * Owner-reviewed exclusions (owner ask, 2026-09-29): these 6 local parts
 * pass every structural rule below (exactly 2 letter-only tokens, no
 * digits, neither token nor the whole local part in GENERIC_LOCAL_PARTS)
 * but are functional/team mailboxes, not a person — the owner confirmed
 * this by reading the actual accounts before any `--execute`. Matched by
 * EXACT lowercased email. Extend this list only after another owner review
 * — never by guessing at a broader rule.
 */
export const OWNER_EXCLUDED_EMAILS: ReadonlySet<string> = new Set([
  "capacity.america@intive.com",
  "pmo.tech@uala.com.ar",
  "metodyfabricas.arg@bbva.com",
  "dnais.rofertas@policia.gob.ec",
  "andrescamp_ac@hotmail.com",
  "julionunez.rv@gmail.com",
]);

// Minimum required generic/role local parts (contact-identity owner ask):
// any of these — as a WHOLE token, or as the WHOLE local part once
// separators are stripped — refuses the fill rather than guessing a
// "first/last name" out of a mailbox that isn't a person.
export const GENERIC_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "info",
  "contact",
  "contacto",
  "hello",
  "hola",
  "hi",
  "sales",
  "ventas",
  "admin",
  "office",
  "hr",
  "rrhh",
  "jobs",
  "careers",
  "talent",
  "recruiting",
  "support",
  "soporte",
  "team",
  "marketing",
  "billing",
  "finance",
  "legal",
  "press",
  "news",
  "noreply",
  "no",
  "reply",
  "comments",
  "mail",
  "notifications",
  "service",
  "help",
]);

export type NameFromEmailSkipReason =
  // No "@" or nothing before it — can't even extract a local part.
  | "malformed"
  // No separator ('.', '_', '-') found: exactly one token (e.g. "gusoliva").
  | "single_token"
  // 3+ tokens (e.g. "maria.laura.fantoni") — ambiguous which two are name parts.
  | "too_many_tokens"
  // Exactly 2 tokens but at least one has fewer than 2 letters (an initial,
  // e.g. "josh.o").
  | "short_token"
  // A token contains a digit or any non-letter character.
  | "non_letter_token"
  // A token (or the whole local part with separators stripped) is a
  // generic/role mailbox, never a person's name.
  | "generic_word"
  // An owner-reviewed functional mailbox (OWNER_EXCLUDED_EMAILS) — passes
  // every structural rule but is confirmed NOT a person.
  | "owner_excluded";

export interface NameFromEmailFill {
  firstName: string;
  lastName: string;
}

export type NameFromEmailResult =
  | { kind: "fill"; fill: NameFromEmailFill }
  | { kind: "skip"; reason: NameFromEmailSkipReason };

const LETTERS_ONLY_RE = /^\p{L}+$/u;

function titleCase(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Local part before '@', with any '+tag' stripped — e.g.
 * "efrain.romero+newsletter@storicard.com" -> "efrain.romero". Returns null
 * when there's no usable local part at all (malformed input). */
function localPartBeforeTag(email: string): string | null {
  const at = email.indexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  return plus >= 0 ? local.slice(0, plus) : local;
}

/**
 * Derives a first/last name from ONE email's local part, per the
 * conservative, refuse-rather-than-guess rule (contact-identity owner ask):
 * split on '.', '_', '-'; accept ONLY exactly 2 tokens, each >= 2 Unicode
 * letters, letters only (any digit anywhere rejects); reject a generic/role
 * word. Output is title-cased, preserving any accents already present in
 * the email — never adding one that isn't there.
 *
 * Normalizes to NFC first (SUGGESTION fix): an accented letter can arrive
 * either precomposed (NFC, one codepoint, e.g. "í" U+00ED) or decomposed
 * (NFD, base letter + a combining mark, e.g. "i" U+0069 + U+0301). A
 * combining mark's Unicode category is "Mn" (mark), not "L" (letter), so
 * `LETTERS_ONLY_RE` (`\p{L}+`) would wrongly reject an NFD token as
 * `non_letter_token` even though it spells a perfectly normal name.
 * Normalizing first means both forms are treated identically and the
 * written name is always the single-codepoint NFC form.
 */
export function deriveNameFromEmail(email: string): NameFromEmailResult {
  const normalizedEmail = email.normalize("NFC");
  if (OWNER_EXCLUDED_EMAILS.has(normalizedEmail.trim().toLowerCase())) {
    return { kind: "skip", reason: "owner_excluded" };
  }

  const localPart = localPartBeforeTag(normalizedEmail);
  if (!localPart) return { kind: "skip", reason: "malformed" };

  const tokens = localPart.split(/[._-]+/).filter(Boolean);
  if (tokens.length === 0) return { kind: "skip", reason: "malformed" };
  if (tokens.length === 1) return { kind: "skip", reason: "single_token" };
  if (tokens.length > 2) return { kind: "skip", reason: "too_many_tokens" };

  const [first, last] = tokens as [string, string];
  if (!LETTERS_ONLY_RE.test(first) || !LETTERS_ONLY_RE.test(last)) {
    return { kind: "skip", reason: "non_letter_token" };
  }
  if (first.length < 2 || last.length < 2) {
    return { kind: "skip", reason: "short_token" };
  }

  const wholeJoined = tokens.join("").toLowerCase();
  if (GENERIC_LOCAL_PARTS.has(first.toLowerCase()) || GENERIC_LOCAL_PARTS.has(last.toLowerCase()) ||
    GENERIC_LOCAL_PARTS.has(wholeJoined)) {
    return { kind: "skip", reason: "generic_word" };
  }

  return { kind: "fill", fill: { firstName: titleCase(first), lastName: titleCase(last) } };
}

export interface NameFromEmailCandidate {
  personId: string;
  email: string;
  companyKey: string | null;
}

export interface NameFromEmailFillPlanItem {
  personId: string;
  email: string;
  firstName: string;
  lastName: string;
  companyKey: string | null;
}

export interface NameFromEmailSkipPlanItem {
  personId: string;
  email: string;
  reason: NameFromEmailSkipReason;
}

export interface NameFromEmailPlan {
  fills: NameFromEmailFillPlanItem[];
  skips: NameFromEmailSkipPlanItem[];
}

/**
 * Pure planner: never mutates `candidates` (write-rule R1) — safe to call
 * twice with the same input for the same result (see
 * tests/unit/nameFromEmailBackfill.test.ts).
 */
export function buildNameFromEmailPlan(candidates: readonly NameFromEmailCandidate[]): NameFromEmailPlan {
  const fills: NameFromEmailFillPlanItem[] = [];
  const skips: NameFromEmailSkipPlanItem[] = [];

  for (const candidate of candidates) {
    const result = deriveNameFromEmail(candidate.email);
    if (result.kind === "fill") {
      fills.push({
        personId: candidate.personId,
        email: candidate.email,
        firstName: result.fill.firstName,
        lastName: result.fill.lastName,
        companyKey: candidate.companyKey,
      });
    } else {
      skips.push({ personId: candidate.personId, email: candidate.email, reason: result.reason });
    }
  }

  return { fills, skips };
}

export interface ExistingPersonForCollisionCheck {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
}

export interface NameCompanyCollision {
  personId: string;
  email: string;
  firstName: string;
  lastName: string;
  companyKey: string;
  /** Other, already-existing non-merged persons that would now share the
   * same normalized name+company key once this fill is applied. Never
   * includes the fill's own personId. */
  collidesWithPersonIds: string[];
}

/**
 * Read-only measurement (never a write): for each planned fill, checks
 * whether applying it would make it share `buildNameCompanyKey` with an
 * ALREADY EXISTING, non-merged person — i.e. a NEW name+company collision
 * this backfill would introduce. `existingPersons` should be prefetched
 * scoped to the companyKeys appearing in `fills` (see
 * nameFromEmailBackfillDb.ts#readCollisionCandidates) — never the whole
 * `person` table.
 *
 * A collision here does NOT mean an automatic merge: per
 * src/lib/identity/matcher.ts, a name+company match only ever produces a
 * `{ kind: "review" }` result — it is queued for human review, never
 * auto-merged. This function only measures how many such review candidates
 * this backfill would newly enable a future ingestion row to match against;
 * it does not itself write to `duplicate_candidate` (nothing here does —
 * that table is only ever populated by live ingestion, see
 * src/lib/identity/resolveDb.ts).
 */
export function findNameCompanyCollisions(
  fills: readonly NameFromEmailFillPlanItem[],
  existingPersons: readonly ExistingPersonForCollisionCheck[],
): NameCompanyCollision[] {
  const existingByKey = new Map<string, string[]>();
  for (const existing of existingPersons) {
    const key = buildNameCompanyKey({
      firstName: existing.firstName,
      lastName: existing.lastName,
      companyKey: existing.companyKey,
    });
    if (!key) continue;
    const ids = existingByKey.get(key) ?? [];
    ids.push(existing.id);
    existingByKey.set(key, ids);
  }

  const collisions: NameCompanyCollision[] = [];
  for (const fill of fills) {
    const key = buildNameCompanyKey({
      firstName: fill.firstName,
      lastName: fill.lastName,
      companyKey: fill.companyKey,
    });
    if (!key) continue;
    const matches = (existingByKey.get(key) ?? []).filter((id) => id !== fill.personId);
    if (matches.length === 0) continue;
    collisions.push({
      personId: fill.personId,
      email: fill.email,
      firstName: fill.firstName,
      lastName: fill.lastName,
      companyKey: fill.companyKey!,
      collidesWithPersonIds: matches,
    });
  }
  return collisions;
}

// --- Queueing name+company collisions into the EXISTING duplicate-review ---
// --- mechanism (duplicate_candidate) ----------------------------------------

/**
 * The ONE key builder for a `duplicate_candidate` pair — same canonical
 * ordering (`a < b` by JS string comparison) src/lib/identity/resolve.ts
 * already uses when it writes `reviewPairs` into `duplicateCandidates`, and
 * the same ordering the DB's `duplicate_candidate_pair_unique` constraint
 * expects (personAId < personBId). Both planDuplicateCandidateQueue and
 * nameFromEmailBackfillDb.ts#readExistingDuplicateCandidatePairs must build
 * this key the same way — see the "one key builder per map" rule.
 */
export function duplicateCandidatePairKey(personAId: string, personBId: string): string {
  const [a, b] = personAId < personBId ? [personAId, personBId] : [personBId, personAId];
  return `${a}:${b}`;
}

export interface DuplicateCandidateQueueCandidate {
  personAId: string;
  personBId: string;
  reason: ReviewReason;
  matchKey: string;
}

/**
 * Turns `findNameCompanyCollisions`'s output into ordered, deduped
 * `duplicate_candidate` rows to insert — one per (fill, colliding existing
 * person) pair, `reason: "name_company"` (the exact reason
 * src/lib/identity/matcher.ts's `{ kind: "review" }` case uses for this
 * match), `matchKey` = the SAME `buildNameCompanyKey` both sides now share.
 * Read-only/pure: never itself decides whether a pair already exists — see
 * filterAlreadyQueuedDuplicateCandidates for that (a DB read is required).
 */
export function planDuplicateCandidateQueue(
  collisions: readonly NameCompanyCollision[],
): DuplicateCandidateQueueCandidate[] {
  const seen = new Set<string>();
  const candidates: DuplicateCandidateQueueCandidate[] = [];
  for (const collision of collisions) {
    const matchKey = buildNameCompanyKey({
      firstName: collision.firstName,
      lastName: collision.lastName,
      companyKey: collision.companyKey,
    });
    if (!matchKey) continue; // defensive: a real collision always has one
    for (const otherId of collision.collidesWithPersonIds) {
      const [personAId, personBId] =
        collision.personId < otherId ? [collision.personId, otherId] : [otherId, collision.personId];
      const key = duplicateCandidatePairKey(personAId, personBId);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ personAId, personBId, reason: "name_company", matchKey });
    }
  }
  return candidates;
}

export interface ExistingDuplicateCandidatePair {
  personAId: string;
  personBId: string;
  status: string;
}

export interface DuplicateCandidateQueuePlan {
  toQueue: DuplicateCandidateQueueCandidate[];
  alreadyQueued: (DuplicateCandidateQueueCandidate & { existingStatus: string })[];
}

/**
 * Splits planned candidates into ones that must actually be inserted vs.
 * ones a `duplicate_candidate` row (in ANY status — open, merged, or
 * not_duplicate) already exists for — never re-queue a pair that was
 * already resolved, and never rely solely on the DB's unique-constraint
 * conflict handling to decide that silently: this is reported in the dry
 * run so the owner sees exactly which pairs are new. Pure — never mutates
 * `candidates` or `existingPairs`.
 */
export function filterAlreadyQueuedDuplicateCandidates(
  candidates: readonly DuplicateCandidateQueueCandidate[],
  existingPairs: readonly ExistingDuplicateCandidatePair[],
): DuplicateCandidateQueuePlan {
  const existingByKey = new Map(
    existingPairs.map((p) => [duplicateCandidatePairKey(p.personAId, p.personBId), p.status] as const),
  );
  const toQueue: DuplicateCandidateQueueCandidate[] = [];
  const alreadyQueued: (DuplicateCandidateQueueCandidate & { existingStatus: string })[] = [];
  for (const candidate of candidates) {
    const status = existingByKey.get(duplicateCandidatePairKey(candidate.personAId, candidate.personBId));
    if (status) alreadyQueued.push({ ...candidate, existingStatus: status });
    else toQueue.push(candidate);
  }
  return { toQueue, alreadyQueued };
}
