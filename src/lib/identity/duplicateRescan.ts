/**
 * Pure planner of the duplicates re-scan: finds name+company collisions among
 * EXISTING live persons and decides which `duplicate_candidate` rows to create.
 * Detection is otherwise write-time only (src/lib/identity/resolveDb.ts).
 *
 * ONE implementation of the logic: collisions come from
 * `findNameCompanyCollisions` and pair dedupe/ordering from
 * `planDuplicateCandidateQueue` (nameFromEmailBackfill.ts), both keyed by
 * `buildNameCompanyKey` — the key is never re-derived or loosened here.
 * No I/O; see duplicateRescanRun.ts for the database layer.
 */
import { ownCompanyMatchReason } from "@/lib/ownCompany";
import { splitEmail } from "@/lib/emailPatterns";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import {
  duplicateCandidatePairKey,
  filterAlreadyQueuedDuplicateCandidates,
  findNameCompanyCollisions,
  planDuplicateCandidateQueue,
  type DuplicateCandidateQueueCandidate,
  type ExistingDuplicateCandidatePair,
} from "@/lib/identity/nameFromEmailBackfill";

export const RESCAN_DEFAULT_CAP = 50;
export const RESCAN_MAX_CAP = 200;

/** Server-side clamp: junk falls back to the default, anything above the maximum is capped. */
export function clampRescanCap(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || Math.floor(n) < 1) return RESCAN_DEFAULT_CAP;
  return Math.min(Math.floor(n), RESCAN_MAX_CAP);
}

export interface RescanPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  email: string | null;
}

export type RescanPair = DuplicateCandidateQueueCandidate & { ownCompany: boolean };

export interface RescanFound {
  scanned: number;
  /** Distinct matcher keys with 2+ people. */
  groups: number;
  /** People whose company/domain is Avalith's own (the matcher refuses them, matcher.ts). */
  ownCompanyPersons: number;
  pairs: RescanPair[];
}

function isOwnCompany(person: RescanPerson): boolean {
  const domain = person.email ? (splitEmail(person.email)?.domain ?? null) : null;
  return ownCompanyMatchReason(person.company ?? person.companyKey, domain) !== null;
}

/** Every colliding pair among `persons` (live ones, by contract), each once, sorted a < b. Never mutates its input. */
export function findRescanPairs(persons: readonly RescanPerson[]): RescanFound {
  // Thin adapter onto the shared collision finder: the effective company key is
  // the one buildNameCompanyKey itself would derive (stored key, else normalized company).
  const asFills = persons.map((x) => ({
    personId: x.id,
    email: x.email ?? "",
    firstName: x.firstName ?? "",
    lastName: x.lastName ?? "",
    companyKey: x.companyKey ? x.companyKey : x.company ? normalizeCompanyKey(x.company) : null,
  }));
  const existing = asFills.map((f) => ({ id: f.personId, firstName: f.firstName, lastName: f.lastName, companyKey: f.companyKey }));
  const pairs = planDuplicateCandidateQueue(findNameCompanyCollisions(asFills, existing));
  const ownIds = new Set(persons.filter(isOwnCompany).map((x) => x.id));
  return {
    scanned: persons.length,
    groups: new Set(pairs.map((x) => x.matchKey)).size,
    ownCompanyPersons: ownIds.size,
    pairs: pairs.map((x) => ({ ...x, ownCompany: ownIds.has(x.personAId) || ownIds.has(x.personBId) })),
  };
}

export const RESCAN_SKIP_REASONS = [
  "own_company",
  "existing_open",
  "existing_merged",
  "existing_not_duplicate",
  "existing_other",
] as const;
export type RescanSkipReason = (typeof RESCAN_SKIP_REASONS)[number];

export interface RescanPlan {
  scanned: number;
  groups: number;
  ownCompanyPersons: number;
  /** Colliding pairs found. Invariant: found = toCreate.length + remaining + sum(skipped). */
  found: number;
  skipped: Record<RescanSkipReason, number>;
  cap: number;
  capped: boolean;
  /** New pairs beyond the cap, left for the next run. */
  remaining: number;
  toCreate: DuplicateCandidateQueueCandidate[];
}

function emptySkipped(): Record<RescanSkipReason, number> {
  return { own_company: 0, existing_open: 0, existing_merged: 0, existing_not_duplicate: 0, existing_other: 0 };
}

/**
 * Classifies every found pair as skipped (own company, or a `duplicate_candidate`
 * row exists in ANY status — a closed pair is never reopened) or new, then
 * truncates the new ones to `cap` in a stable order (pair key) so the next run
 * continues where this one stopped. Pure.
 */
export function planDuplicateRescan(
  found: RescanFound,
  existingPairs: readonly ExistingDuplicateCandidatePair[],
  cap: number,
): RescanPlan {
  const skipped = emptySkipped();
  const own = found.pairs.filter((x) => x.ownCompany);
  skipped.own_company = own.length;
  const queue = filterAlreadyQueuedDuplicateCandidates(
    found.pairs.filter((x) => !x.ownCompany),
    existingPairs,
  );
  for (const x of queue.alreadyQueued) {
    const reason = `existing_${x.existingStatus}`;
    skipped[(RESCAN_SKIP_REASONS as readonly string[]).includes(reason) ? (reason as RescanSkipReason) : "existing_other"] += 1;
  }
  const ordered = queue.toQueue
    .map(({ personAId, personBId, reason, matchKey }) => ({ personAId, personBId, reason, matchKey }))
    .sort((a, b) => duplicateCandidatePairKey(a.personAId, a.personBId).localeCompare(duplicateCandidatePairKey(b.personAId, b.personBId)));
  const toCreate = ordered.slice(0, cap);
  return {
    scanned: found.scanned,
    groups: found.groups,
    ownCompanyPersons: found.ownCompanyPersons,
    found: found.pairs.length,
    skipped,
    cap,
    capped: ordered.length > cap,
    remaining: ordered.length - toCreate.length,
    toCreate,
  };
}

// --- result <-> URL params (server action redirect, same shape as rfc-backfill) ---

export interface RescanReport extends Omit<RescanPlan, "toCreate"> {
  dryRun: boolean;
  /** Rows actually inserted (0 on a dry run). */
  created: number;
  /** What the run would create / did create before concurrency losses. */
  planned: number;
}

const NUMERIC_KEYS = ["scanned", "groups", "ownCompanyPersons", "found", "cap", "remaining", "created", "planned"] as const;

export function rescanReportToParams(report: RescanReport): URLSearchParams {
  const params = new URLSearchParams({ rescan: "1", dryRun: report.dryRun ? "1" : "0" });
  for (const key of NUMERIC_KEYS) params.set(key, String(report[key]));
  for (const reason of RESCAN_SKIP_REASONS) params.set(reason, String(report.skipped[reason]));
  return params;
}

/** Reader of `rescanReportToParams`; query strings are user-editable, so every value is re-validated. */
export function parseRescanParams(params: Record<string, string | string[] | undefined>): RescanReport | null {
  if (params.rescan !== "1") return null;
  const num = (v: string | string[] | undefined) => {
    const n = typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  const skipped = emptySkipped();
  for (const reason of RESCAN_SKIP_REASONS) skipped[reason] = num(params[reason]);
  const n = (key: (typeof NUMERIC_KEYS)[number]) => num(params[key]);
  return {
    dryRun: params.dryRun === "1",
    scanned: n("scanned"),
    groups: n("groups"),
    ownCompanyPersons: n("ownCompanyPersons"),
    found: n("found"),
    cap: n("cap"),
    remaining: n("remaining"),
    created: n("created"),
    planned: n("planned"),
    capped: n("remaining") > 0,
    skipped,
  };
}
