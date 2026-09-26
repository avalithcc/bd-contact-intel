/**
 * Live-ingestion identity resolver (design.md D11-D14; contact-identity
 * spec "Live ingestion resolves identity at write time"). Reuses the exact
 * same matcher precedence collapsePlanner/foldPlanner use, combining both:
 * seeded from a prefetched slice of EXISTING persons (foldPlanner's
 * pattern) AND growing an in-chunk index so two rows of the same new
 * person in one chunk dedup to one person (collapsePlanner's pattern) —
 * see "Concurrent uploads of the same new profile" scenario.
 *
 * This module holds the PURE planning/row-building pieces only — types,
 * `planIdentityWrites`, `buildPrefetchKeys`, `buildIdentityWriteRows`,
 * `isIdentityDualWriteEnabled`, and the `IDENTITY_LOCK_KEY` constant — all
 * unit-tested in tests/unit/identityResolve.test.ts. `prefetchIdentityIndex`,
 * `withIdentityLock` and `applyIdentityWrites` touch the database and live
 * in ./resolveDb.ts, intentionally thin and delegating all real logic to
 * the pure helpers here — importing `db` (as opposed to `@/db/schema`,
 * which has no side effects) throws without DATABASE_URL, so those
 * functions can't be unit-tested the way the rest of this module is; this
 * mirrors src/lib/migration/queries.ts's split between pure planners/
 * write-row builders and thin DB wrappers.
 */
import { duplicateCandidate, person, personBdConnection, personIdMap } from "@/db/schema";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { normalizeNameKey } from "@/lib/leads/csv";
import { classifyPosition, type RoleGroupKey } from "@/lib/roleGroups";
import {
  buildNameCompanyKey,
  matchIdentity,
  mergeProperty,
  type EmailStatus,
  type IdentityIndex,
  type ReviewReason,
} from "@/lib/identity/matcher";

// --- Row-building blocks shared with the row-level types below -------------

/** contact-identity delta (task 3.3): 'r7' is the existing specificity/
 * recency-based merge (unchanged default for the live/collapse/fold paths);
 * 'fill_empty' NEVER overwrites a value already present on the existing
 * person — it only fills a field that is currently null/empty. HubSpot
 * import uses 'fill_empty' (design D4 "Re-import (R7/Q3)"). */
export type MergePolicy = "r7" | "fill_empty";

export interface IdentityIngestRow {
  legacyTable: "contact" | "lead" | "hubspot_contact";
  legacyId: string;
  // Nullable (design D4): a HubSpot row's owner becomes person.ownerBdId,
  // not a person_bd_connection — a HubSpot owner is not a LinkedIn
  // connection. null bdId means no person_bd_connection row is written.
  bdId: string | null;
  // Contacts only — leads have no LinkedIn profile key (contact-identity
  // spec: "Lead without email or LinkedIn falls back to name+company").
  profileKey?: string | null;
  connectedOn?: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey?: string | null;
  jobTitle?: string | null;
  industry?: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  emailConfidence?: number | null;
  emailSource?: string | null;
  // HubSpot-only extensions (design D4) — optional so `contact`/`lead` rows
  // (and every existing caller) are unaffected.
  ownerBdId?: string | null;
  city?: string | null;
  country?: string | null;
  /** The migration_run that created this row, written once at person
   * creation only — never touched on an existing-person update. */
  migrationRunId?: string | null;
}

/** Subset of an existing `person` row the matcher/merge need — same shape as foldPlanner.ts's FoldExistingPerson. */
export interface ExistingPersonCandidate {
  id: string;
  profileKey: string | null;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  industry: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
  // Raw company display text (person.company) — optional so existing
  // callers built before this field existed (there were none passing an
  // explicit value) default to null, same as "not yet on file".
  company?: string | null;
  // HubSpot-only extensions (design D4) — optional so every existing caller
  // (prefetchIdentityIndex's live-path candidates) is unaffected.
  ownerBdId?: string | null;
  city?: string | null;
  country?: string | null;
}

/** Only the persons that could match this chunk's rows (design D13) — never the whole table. */
export type PrefetchedIdentityIndex = readonly ExistingPersonCandidate[];

export interface IdentityMergedFields {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  // Classified from `jobTitle` (fresh-review fix 3, R7) — the legacy contact
  // write's `classifyPosition(r.position)` (src/lib/queries.ts) had no
  // equivalent here, so persons created/updated by the live resolver kept a
  // stale/null roleGroup, silently degrading /outreach's roleGroup filter
  // and getCompanyHiringSummaries' leadership count. Always re-derived from
  // the FINAL merged jobTitle, never merged independently — see mergeFields.
  roleGroup: RoleGroupKey;
  industry: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
  // HubSpot-only extensions (design D4) — always present (null when unset)
  // so mergeFields/mergeFieldsFillEmpty treat them like every other field.
  city: string | null;
  country: string | null;
  ownerBdId: string | null;
}

// 'skipped_own_company' | 'new' | 'review' | one of the matcher's strong
// keys — same vocabulary as person_id_map.method (collapsePlanner/
// foldPlanner already use this exact set).
export type IdentityRowMethod =
  | "profile_key"
  | "verified_email"
  | "new"
  | "review"
  | "skipped_own_company";

export interface IdentityRowOutcome {
  row: IdentityIngestRow;
  method: IdentityRowMethod;
  // A real person id (matched/updated existing person) or a temp plan ref
  // ("np1") for new/review rows — buildIdentityWriteRows resolves plan
  // refs to generated ids. Null only for skipped_own_company.
  personRef: string | null;
}

export interface IdentityNewPerson {
  planRef: string;
  profileKey: string | null;
  sourceKey: string;
  merged: IdentityMergedFields;
  /** Written once at creation only — see IdentityIngestRow.migrationRunId. */
  migrationRunId: string | null;
}

export interface IdentityExistingUpdate {
  personId: string;
  merged: IdentityMergedFields;
}

export interface IdentityReviewPair {
  // Either a real person id or a plan ref — same duality as newPersons.
  refA: string;
  refB: string;
  reason: ReviewReason;
  matchKey: string;
}

export interface IdentityWritePlan {
  rowOutcomes: IdentityRowOutcome[];
  newPersons: IdentityNewPerson[];
  existingUpdates: IdentityExistingUpdate[];
  reviewPairs: IdentityReviewPair[];
  report: {
    rowsRead: number;
    ownCompanySkipped: number;
    autoMerged: number;
    flaggedForReview: number;
    new: number;
  };
}

function rowAsMerged(row: IdentityIngestRow): IdentityMergedFields {
  const jobTitle = row.jobTitle ?? null;
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    companyKey: row.companyKey ?? (row.company ? normalizeCompanyKey(row.company) : null),
    jobTitle,
    roleGroup: classifyPosition(jobTitle),
    industry: row.industry ?? null,
    email: row.email,
    emailNormalized: row.email ? row.email.trim().toLowerCase() : null,
    emailStatus: row.emailStatus,
    emailConfidence: row.emailConfidence ?? null,
    emailSource: row.emailSource ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    ownerBdId: row.ownerBdId ?? null,
  };
}

function candidateAsMerged(p: ExistingPersonCandidate): IdentityMergedFields {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    company: p.company ?? null,
    companyKey: p.companyKey,
    jobTitle: p.jobTitle,
    roleGroup: classifyPosition(p.jobTitle),
    industry: p.industry,
    email: p.email,
    emailNormalized: p.emailNormalized,
    emailStatus: p.emailStatus,
    emailConfidence: p.emailConfidence,
    emailSource: p.emailSource,
    city: p.city ?? null,
    country: p.country ?? null,
    ownerBdId: p.ownerBdId ?? null,
  };
}

function nameCompanyKeyFromCandidate(p: ExistingPersonCandidate): string | null {
  const name = normalizeNameKey(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
  if (!name || !p.companyKey) return null;
  return `${name}::${p.companyKey}`;
}

function mergeStringField(a: string | null, b: string | null): string | null {
  return mergeProperty({ value: a }, { value: b }).value ?? null;
}

/** 'fill_empty' policy (design D4 "Re-import (R7/Q3)"): the existing value
 * NEVER changes once set — an incoming row only ever fills a currently
 * null/empty field. Unlike mergeStringField, this ignores specificity and
 * recency entirely; re-importing the same export twice is then a true
 * no-op on every field that was already filled once. */
function fillEmptyField(existing: string | null, incoming: string | null): string | null {
  return existing != null && existing !== "" ? existing : incoming;
}

/** Same "email fields move together" rule as collapsePlanner/foldPlanner (contact-identity R7). */
function mergeEmailFields(a: IdentityMergedFields, b: IdentityMergedFields): Pick<
  IdentityMergedFields,
  "email" | "emailNormalized" | "emailStatus" | "emailConfidence" | "emailSource"
> {
  const rank: Record<EmailStatus, number> = { verified: 2, probable: 1, none: 0 };
  const aHas = !!a.email;
  const bHas = !!b.email;
  const winner =
    aHas && !bHas ? a : bHas && !aHas ? b : !aHas && !bHas ? a : rank[b.emailStatus] > rank[a.emailStatus] ? b : a;
  return {
    email: winner.email,
    emailNormalized: winner.emailNormalized,
    emailStatus: winner.emailStatus,
    emailConfidence: winner.emailConfidence,
    emailSource: winner.emailSource,
  };
}

/** 'fill_empty' counterpart to mergeEmailFields: the email fields still move
 * together as one unit, but ONLY fill from incoming when the EXISTING
 * email is empty — an existing (even 'probable') email is never replaced,
 * unlike mergeEmailFields' specificity-rank comparison. */
function fillEmptyEmailFields(existing: IdentityMergedFields, incoming: IdentityMergedFields): Pick<
  IdentityMergedFields,
  "email" | "emailNormalized" | "emailStatus" | "emailConfidence" | "emailSource"
> {
  const source = existing.email ? existing : incoming;
  return {
    email: source.email,
    emailNormalized: source.emailNormalized,
    emailStatus: source.emailStatus,
    emailConfidence: source.emailConfidence,
    emailSource: source.emailSource,
  };
}

function mergeFields(
  existing: IdentityMergedFields,
  incoming: IdentityMergedFields,
  policy: MergePolicy = "r7",
): IdentityMergedFields {
  const field = policy === "fill_empty" ? fillEmptyField : mergeStringField;
  const jobTitle = field(existing.jobTitle, incoming.jobTitle);
  return {
    firstName: field(existing.firstName, incoming.firstName),
    lastName: field(existing.lastName, incoming.lastName),
    // company/companyKey/city/country are ALWAYS fill-empty-only, for EVERY
    // mergePolicy (fresh-review fix, post-H3a) — an existing person's raw
    // display fields must never be silently overwritten by a re-imported or
    // live row, even a longer/more-specific one under the default 'r7'
    // policy. Only a currently empty field is ever filled; a brand-new
    // person still gets the row's own company/city/country written as-is
    // (there is nothing existing to fill against). Every other field (e.g.
    // jobTitle above) keeps its per-policy behavior unchanged.
    company: fillEmptyField(existing.company, incoming.company),
    // companyKey follows company: it's only ever derived FROM company
    // (rowAsMerged/candidateAsMerged), so it must use the exact same
    // fill-empty rule as company — merging it independently (e.g. per
    // mergePolicy like jobTitle) could let companyKey drift onto the
    // incoming row's key while company itself stays frozen at the
    // existing value, leaving the two out of sync on the same person.
    companyKey: fillEmptyField(existing.companyKey, incoming.companyKey),
    jobTitle,
    // Re-derived from the FINAL merged jobTitle, not merged independently
    // (fresh-review fix 3) — the field-merge rule above already picked the
    // right jobTitle; roleGroup must always agree with it, never lag behind
    // from whichever side happened to have it.
    roleGroup: classifyPosition(jobTitle),
    industry: field(existing.industry, incoming.industry),
    city: fillEmptyField(existing.city, incoming.city),
    country: fillEmptyField(existing.country, incoming.country),
    ownerBdId: field(existing.ownerBdId, incoming.ownerBdId),
    ...(policy === "fill_empty" ? fillEmptyEmailFields(existing, incoming) : mergeEmailFields(existing, incoming)),
  };
}

// Design-decision default: contacts come from the CSV/LinkedIn import,
// leads from the leads-ingest path, HubSpot rows from the hubspot_import
// migration — mirrors the vocabulary person.sourceKey already uses for
// migration-created rows ("linkedin_import"/"csv"/"hubspot_import").
function sourceKeyFor(row: IdentityIngestRow): string {
  if (row.legacyTable === "hubspot_contact") return "hubspot_import";
  return row.legacyTable === "contact" ? "csv" : "lead_import";
}

/**
 * Pure planner (task 4B.1): decides, per incoming row, whether it matches an
 * existing person (auto, by profile key or verified email), needs a fresh
 * person (new), needs review (name+company, or conflicting strong keys —
 * never auto-merged), or should be skipped (own-company). Rows within the
 * same chunk that match each other dedup to ONE new person, exactly like
 * collapsePlanner.ts.
 */
export function planIdentityWrites(
  rows: readonly IdentityIngestRow[],
  index: PrefetchedIdentityIndex,
  mergePolicy: MergePolicy = "r7",
): IdentityWritePlan {
  const byProfileKey = new Map<string, string>();
  const byVerifiedEmail = new Map<string, string>();
  // Every person whose stored email matches, regardless of status (design
  // D4 / contact-identity delta "email_unverified") — unlike
  // byVerifiedEmail, which only ever holds a hit whose OWN email is
  // verified.
  const byEmailAny = new Map<string, string[]>();
  const byNameCompany = new Map<string, string[]>();
  const mergedByRef = new Map<string, IdentityMergedFields>();
  const rowByRef = new Map<string, IdentityIngestRow>();
  const existingIds = new Set<string>();
  const updatedExisting = new Set<string>();

  for (const p of index) {
    existingIds.add(p.id);
    mergedByRef.set(p.id, candidateAsMerged(p));
    if (p.profileKey) byProfileKey.set(p.profileKey, p.id);
    if (p.emailStatus === "verified" && p.emailNormalized) byVerifiedEmail.set(p.emailNormalized, p.id);
    if (p.emailNormalized) byEmailAny.set(p.emailNormalized, [...(byEmailAny.get(p.emailNormalized) ?? []), p.id]);
    const key = nameCompanyKeyFromCandidate(p);
    if (key) byNameCompany.set(key, [...(byNameCompany.get(key) ?? []), p.id]);
  }

  const matcherIndex: IdentityIndex = {
    byProfileKey: (k) => byProfileKey.get(k) ?? null,
    byVerifiedEmail: (e) => byVerifiedEmail.get(e) ?? null,
    byEmail: (e) => byEmailAny.get(e) ?? [],
    byNameCompany: (k) => byNameCompany.get(k) ?? [],
  };

  function registerRowKeys(ref: string, row: IdentityIngestRow) {
    if (row.profileKey && !byProfileKey.has(row.profileKey)) byProfileKey.set(row.profileKey, ref);
    if (row.emailStatus === "verified" && row.email) {
      const key = row.email.trim().toLowerCase();
      if (!byVerifiedEmail.has(key)) byVerifiedEmail.set(key, ref);
    }
    if (row.email) {
      const key = row.email.trim().toLowerCase();
      const list = byEmailAny.get(key) ?? [];
      if (!list.includes(ref)) list.push(ref);
      byEmailAny.set(key, list);
    }
    const key = buildNameCompanyKey(row);
    if (key) {
      const list = byNameCompany.get(key) ?? [];
      if (!list.includes(ref)) list.push(ref);
      byNameCompany.set(key, list);
    }
  }

  const rowOutcomes: IdentityRowOutcome[] = [];
  const reviewPairs: IdentityReviewPair[] = [];
  let nextPlanId = 1;
  let ownCompanySkipped = 0;
  let autoMerged = 0;
  let flaggedForReview = 0;
  let newCount = 0;

  for (const row of rows) {
    const matchRow = {
      profileKey: row.profileKey,
      email: row.email,
      emailStatus: row.emailStatus,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      companyKey: row.companyKey,
      source: row.legacyTable === "hubspot_contact" ? ("hubspot_import" as const) : undefined,
    };
    const result = matchIdentity(matchRow, matcherIndex);

    if (result.kind === "skip_own_company") {
      rowOutcomes.push({ row, method: "skipped_own_company", personRef: null });
      ownCompanySkipped++;
      continue;
    }

    if (result.kind === "auto") {
      const existing = mergedByRef.get(result.personId);
      if (!existing) throw new Error(`Planner invariant violated: unknown person ${result.personId}`);
      mergedByRef.set(result.personId, mergeFields(existing, rowAsMerged(row), mergePolicy));
      if (existingIds.has(result.personId)) updatedExisting.add(result.personId);
      registerRowKeys(result.personId, row);
      rowOutcomes.push({ row, method: result.key, personRef: result.personId });
      autoMerged++;
      continue;
    }

    // "review" and "new" both create a fresh plan person for this row
    // (design D3: no data waits on the review).
    const planRef = `np${nextPlanId++}`;
    mergedByRef.set(planRef, rowAsMerged(row));
    rowByRef.set(planRef, row);
    registerRowKeys(planRef, row);
    rowOutcomes.push({ row, method: result.kind === "review" ? "review" : "new", personRef: planRef });

    if (result.kind === "review") {
      flaggedForReview++;
      for (const otherRef of result.personIds) {
        if (otherRef === planRef) continue;
        const [refA, refB] = otherRef < planRef ? [otherRef, planRef] : [planRef, otherRef];
        reviewPairs.push({
          refA,
          refB,
          reason: result.reason,
          matchKey:
            result.reason === "name_company"
              ? (buildNameCompanyKey(matchRow) ?? "")
              : result.reason === "email_unverified"
                ? (row.email?.trim().toLowerCase() ?? "")
                : `conflicting:${row.profileKey ?? ""}:${row.email?.trim().toLowerCase() ?? ""}`,
        });
      }
    } else {
      newCount++;
    }
  }

  const existingUpdates: IdentityExistingUpdate[] = [...updatedExisting].map((id) => ({
    personId: id,
    merged: mergedByRef.get(id)!,
  }));

  const newPersons: IdentityNewPerson[] = [];
  const seenPlanRefs = new Set<string>();
  for (const outcome of rowOutcomes) {
    if (outcome.method !== "new" && outcome.method !== "review") continue;
    const ref = outcome.personRef;
    if (!ref || seenPlanRefs.has(ref)) continue;
    seenPlanRefs.add(ref);
    const firstRow = rowByRef.get(ref)!;
    newPersons.push({
      planRef: ref,
      profileKey: firstRow.profileKey ?? null,
      sourceKey: sourceKeyFor(firstRow),
      merged: mergedByRef.get(ref)!,
      migrationRunId: firstRow.migrationRunId ?? null,
    });
  }

  return {
    rowOutcomes,
    newPersons,
    existingUpdates,
    reviewPairs,
    report: {
      rowsRead: rows.length,
      ownCompanySkipped,
      autoMerged,
      flaggedForReview,
      new: newCount,
    },
  };
}

// --- Prefetch (task 4B.2, design D13) ---------------------------------------

export interface PrefetchKeys {
  profileKeys: string[];
  verifiedEmails: string[];
  companyKeys: string[];
  /** hubspot_import only (fresh-review CRITICAL fix, contact-identity
   * spec "not-verified-side exact-email review rule"): HubSpot rows are
   * ALWAYS `emailStatus:'probable'`, so `verifiedEmails` above never
   * includes their own email — the D4 `email_unverified` dedup rule then
   * has nothing to match against, and duplicates get created instead of
   * routed to review. A SEPARATE key set, scoped strictly to
   * `legacyTable==='hubspot_contact'`, so the live-ingestion prefetch
   * (plain `contact`/`lead` rows) is provably unaffected — pinned by
   * tests/unit/identityResolve.test.ts's scoping test. */
  hubspotEmails: string[];
}

/** Pure key extraction so prefetchIdentityIndex's queries stay unit-testable. */
export function buildPrefetchKeys(rows: readonly IdentityIngestRow[]): PrefetchKeys {
  const profileKeys = new Set<string>();
  const verifiedEmails = new Set<string>();
  const companyKeys = new Set<string>();
  const hubspotEmails = new Set<string>();
  for (const row of rows) {
    if (row.profileKey) profileKeys.add(row.profileKey);
    if (row.emailStatus === "verified" && row.email) verifiedEmails.add(row.email.trim().toLowerCase());
    if (row.legacyTable === "hubspot_contact" && row.email) hubspotEmails.add(row.email.trim().toLowerCase());
    const key = row.companyKey ?? (row.company ? normalizeCompanyKey(row.company) : null);
    if (key) companyKeys.add(key);
  }
  return {
    profileKeys: [...profileKeys],
    verifiedEmails: [...verifiedEmails],
    companyKeys: [...companyKeys],
    hubspotEmails: [...hubspotEmails],
  };
}

// --- Write-row building (pure); apply lives in ./resolveDb.ts (thin DB) ----

export interface IdentityWriteRows {
  persons: (typeof person.$inferInsert)[];
  connections: (typeof personBdConnection.$inferInsert)[];
  idMap: (typeof personIdMap.$inferInsert)[];
  duplicateCandidates: (typeof duplicateCandidate.$inferInsert)[];
  existingUpdates: IdentityExistingUpdate[];
}

/** Pure: resolves plan refs to generated ids and builds insert-ready rows (mirrors collapseWriteRows.ts/foldWriteRows.ts). */
export function buildIdentityWriteRows(plan: IdentityWritePlan, newId: () => string): IdentityWriteRows {
  const idByPlanRef = new Map<string, string>();
  const persons: (typeof person.$inferInsert)[] = [];
  for (const np of plan.newPersons) {
    const id = newId();
    idByPlanRef.set(np.planRef, id);
    persons.push({
      id,
      profileKey: np.profileKey,
      firstName: np.merged.firstName,
      lastName: np.merged.lastName,
      company: np.merged.company,
      companyKey: np.merged.companyKey,
      jobTitle: np.merged.jobTitle,
      roleGroup: np.merged.roleGroup,
      industry: np.merged.industry,
      city: np.merged.city,
      country: np.merged.country,
      email: np.merged.email,
      emailNormalized: np.merged.emailNormalized,
      emailStatus: np.merged.emailStatus,
      emailConfidence: np.merged.emailConfidence,
      emailSource: np.merged.emailSource,
      sourceKey: np.sourceKey,
      ownerBdId: np.merged.ownerBdId,
      migrationRunId: np.migrationRunId,
    });
  }

  const resolveRef = (ref: string): string => idByPlanRef.get(ref) ?? ref;

  const connections: (typeof personBdConnection.$inferInsert)[] = [];
  const idMap: (typeof personIdMap.$inferInsert)[] = [];
  for (const outcome of plan.rowOutcomes) {
    if (outcome.method === "skipped_own_company") {
      idMap.push({
        legacyTable: outcome.row.legacyTable,
        legacyId: outcome.row.legacyId,
        personId: null,
        method: outcome.method,
        migrationRunId: outcome.row.migrationRunId ?? null,
      });
      continue;
    }
    const personId = resolveRef(outcome.personRef!);
    idMap.push({
      legacyTable: outcome.row.legacyTable,
      legacyId: outcome.row.legacyId,
      personId,
      method: outcome.method,
      migrationRunId: outcome.row.migrationRunId ?? null,
    });
    // No person_bd_connection for a null bdId (design D4) — a HubSpot
    // owner is not a LinkedIn connection; the owner itself is written onto
    // person.ownerBdId (np.merged.ownerBdId / mergeFields) instead.
    if (outcome.row.bdId) {
      connections.push({
        personId,
        bdId: outcome.row.bdId,
        connectedOn: outcome.row.legacyTable === "contact" ? (outcome.row.connectedOn ?? null) : null,
        legacyContactId: outcome.row.legacyTable === "contact" ? outcome.row.legacyId : null,
      });
    }
  }

  const duplicateCandidates: (typeof duplicateCandidate.$inferInsert)[] = [];
  for (const pair of plan.reviewPairs) {
    const a = resolveRef(pair.refA);
    const b = resolveRef(pair.refB);
    const [personAId, personBId] = a < b ? [a, b] : [b, a];
    duplicateCandidates.push({ personAId, personBId, reason: pair.reason, matchKey: pair.matchKey });
  }

  return { persons, connections, idMap, duplicateCandidates, existingUpdates: plan.existingUpdates };
}

/**
 * Pure (task 4B.2 fix): repoints every row that references a "loser" person
 * id — one that lost the `ON CONFLICT (profile_key) DO NOTHING` race in
 * applyIdentityWrites — to the "winner" id that actually persisted.
 *
 * Before this fix, applyIdentityWrites only repointed `connections` and
 * `idMap`, never `duplicateCandidates` (built from `reviewPairs` in
 * buildIdentityWriteRows). A duplicate-candidate row referencing a
 * never-persisted loser id violates the `person_a_id`/`person_b_id` FK and
 * rolls back the whole chunk transaction.
 *
 * `existingUpdates` is untouched on purpose: it only ever references real,
 * already-persisted person ids (see `updatedExisting` in planIdentityWrites),
 * never a plan ref that could become a loser.
 */
export function repointIdentityWriteRows(
  rows: IdentityWriteRows,
  winnerByLoserId: ReadonlyMap<string, string>,
): IdentityWriteRows {
  if (winnerByLoserId.size === 0) return rows;

  const resolve = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (winnerByLoserId.has(current) && !seen.has(current)) {
      seen.add(current);
      current = winnerByLoserId.get(current)!;
    }
    return current;
  };

  const connections = rows.connections.map((c) =>
    winnerByLoserId.has(c.personId as string) ? { ...c, personId: resolve(c.personId as string) } : c,
  );

  const idMap = rows.idMap.map((m) =>
    m.personId && winnerByLoserId.has(m.personId as string) ? { ...m, personId: resolve(m.personId as string) } : m,
  );

  const seenPairs = new Set<string>();
  const duplicateCandidates: (typeof duplicateCandidate.$inferInsert)[] = [];
  for (const pair of rows.duplicateCandidates) {
    const a = resolve(pair.personAId as string);
    const b = resolve(pair.personBId as string);
    if (a === b) continue; // collapsed to a self-pair — drop it
    const [personAId, personBId] = a < b ? [a, b] : [b, a];
    const key = `${personAId}:${personBId}`;
    if (seenPairs.has(key)) continue; // became identical to another pair — dedupe
    seenPairs.add(key);
    duplicateCandidates.push({ ...pair, personAId, personBId });
  }

  return { ...rows, connections, idMap, duplicateCandidates };
}

// A person-creating transaction's advisory lock key (design D14) — an
// arbitrary but fixed int4 constant, distinct from any other lock this app
// takes. Global (not per-key): the writes it serializes are rare (uploads,
// lead ingest), so a single lock is cheap enough to skip per-key ordering.
// Used by withIdentityLock in ./resolveDb.ts.
export const IDENTITY_LOCK_KEY = 0x4944_454e; // "IDEN" packed into 4 bytes

// --- Kill switch (design D11) ------------------------------------------------

/**
 * Defaults to enabled (dual-write): only the literal string "false" disables
 * the identity resolver on live paths, so an unset or misconfigured env var
 * fails safe (stays on) rather than silently going legacy-only.
 */
export function isIdentityDualWriteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.IDENTITY_DUAL_WRITE !== "false";
}
