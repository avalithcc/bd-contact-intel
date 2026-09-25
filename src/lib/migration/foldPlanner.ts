/**
 * Pure fold-leads migration planner (design.md "Migration plan" step 4;
 * contact-migration spec "Fold `lead` rows via the matcher"). Matches `lead`
 * rows against the persons ALREADY in the `person` table (the Phase 3
 * collapse has already run in production) using the same
 * `src/lib/identity/matcher.ts` precedence every ingestion path shares —
 * unlike collapsePlanner.ts, the `IdentityIndex` here is SEEDED from
 * existing persons rather than built empty, and matched rows update an
 * EXISTING person instead of creating a plan person. No DB access, so it's
 * unit-testable on fixtures (tests/unit/foldPlanner.test.ts).
 * scripts/unify-contacts.ts wires this to the real database.
 */
import {
  buildNameCompanyKey,
  emailStatusRank,
  matchIdentity,
  mergeProperty,
  type EmailStatus,
  type IdentityIndex,
  type ReviewReason,
} from "@/lib/identity/matcher";
import { normalizeNameKey } from "@/lib/leads/csv";

/** The subset of an existing `person` row the matcher and merge need. */
export interface FoldExistingPerson {
  id: string;
  profileKey: string | null;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
  jobTitle: string | null;
  industry: string | null;
}

export interface FoldLeadRow {
  id: string;
  ownerBdId: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  industry: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
  sourceKey: string;
}

// Same vocabulary as collapsePlanner's CollapseLegacyMethod, plus
// 'skipped_own_company' (leads can be own-company too — matchIdentity
// checks it the same way for every ingestion source).
export type FoldLeadMethod =
  | "profile_key"
  | "verified_email"
  | "new"
  | "review"
  | "skipped_own_company";

export interface FoldLeadMapping {
  legacyLeadId: string;
  method: FoldLeadMethod;
  // The person this row resolved to. Null only for skipped_own_company.
  // For "new"/"review" rows, this is a fresh plan id (`np1`, `np2`, ...)
  // that foldWriteRows.ts resolves to a real generated person id.
  personRef: string | null;
}

export interface FoldMergedFields {
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
}

/** An existing person whose properties change because a lead merged in. */
export interface FoldMatchedUpdate {
  personId: string;
  merged: FoldMergedFields;
}

/** A brand-new person created from an unmatched lead (contact-migration spec). */
export interface FoldNewPerson {
  planId: string;
  merged: FoldMergedFields;
  ownerBdId: string | null;
  sourceKey: string;
}

export interface FoldReviewPair {
  // Either a real person id (existing person) or a fresh plan id (`np...`).
  refA: string;
  refB: string;
  reason: ReviewReason;
  matchKey: string;
}

export interface FoldReport {
  lead: {
    rowsRead: number;
    ownCompanySkipped: number;
    autoMerged: number;
    flaggedForReview: number;
    new: number;
  };
  persons: { created: number; updated: number };
}

export interface FoldPlan {
  mappings: FoldLeadMapping[];
  matchedUpdates: FoldMatchedUpdate[];
  newPersons: FoldNewPerson[];
  reviewPairs: FoldReviewPair[];
  report: FoldReport;
}

function toMerged(person: FoldExistingPerson): FoldMergedFields {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    companyKey: person.companyKey,
    jobTitle: person.jobTitle,
    industry: person.industry,
    email: person.email,
    emailNormalized: person.emailNormalized,
    emailStatus: person.emailStatus,
    emailConfidence: person.emailConfidence,
    emailSource: person.emailSource,
  };
}

function leadAsMerged(lead: FoldLeadRow): FoldMergedFields {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    companyKey: lead.companyKey,
    jobTitle: lead.jobTitle,
    industry: lead.industry,
    email: lead.email,
    emailNormalized: lead.email ? lead.email.trim().toLowerCase() : null,
    emailStatus: lead.emailStatus,
    emailConfidence: lead.emailConfidence,
    emailSource: lead.emailSource,
  };
}

function mergeStringField(a: string | null, b: string | null): string | null {
  return mergeProperty({ value: a }, { value: b }).value ?? null;
}

/**
 * Existing persons already carry a normalized `companyKey` (produced by the
 * same `normalizeCompanyKey` collapse used), so this builds the name+company
 * key directly from it instead of going through `buildNameCompanyKey`, which
 * expects a RAW `company` string to normalize itself.
 */
function nameCompanyKeyFromPerson(person: FoldExistingPerson): string | null {
  const name = normalizeNameKey(`${person.firstName ?? ""} ${person.lastName ?? ""}`);
  if (!name || !person.companyKey) return null;
  return `${name}::${person.companyKey}`;
}

type EmailFields = Pick<
  FoldMergedFields,
  "email" | "emailNormalized" | "emailStatus" | "emailConfidence" | "emailSource"
>;

/**
 * Same "email fields move together" rule as collapsePlanner (contact-identity
 * R7) — picks ONLY the email-related keys from the winning side, never the
 * whole side, so a caller spreading the result can't accidentally clobber
 * unrelated fields (firstName, jobTitle, ...) already merged elsewhere. The
 * side with the higher emailStatusRank wins; a present email beats an absent
 * one on a status tie; ties beyond that keep `a` for determinism — mirrors
 * collapsePlanner.ts's mergeEmailFields exactly.
 */
export function mergeEmailFields(a: FoldMergedFields, b: FoldMergedFields): EmailFields {
  const aHas = !!a.email;
  const bHas = !!b.email;
  const winner =
    aHas && !bHas
      ? a
      : bHas && !aHas
        ? b
        : !aHas && !bHas
          ? a
          : emailStatusRank(b.emailStatus) > emailStatusRank(a.emailStatus)
            ? b
            : a;
  return {
    email: winner.email,
    emailNormalized: winner.emailNormalized,
    emailStatus: winner.emailStatus,
    emailConfidence: winner.emailConfidence,
    emailSource: winner.emailSource,
  };
}

function mergeFields(existing: FoldMergedFields, incoming: FoldMergedFields): FoldMergedFields {
  return {
    firstName: mergeStringField(existing.firstName, incoming.firstName),
    lastName: mergeStringField(existing.lastName, incoming.lastName),
    companyKey: mergeStringField(existing.companyKey, incoming.companyKey),
    jobTitle: mergeStringField(existing.jobTitle, incoming.jobTitle),
    industry: mergeStringField(existing.industry, incoming.industry),
    ...mergeEmailFields(existing, incoming),
  };
}

/**
 * Plans the fold-leads phase: `existingPersons` seeds the matcher index (the
 * Phase 3 collapse has already run), then every `lead` row is matched
 * against it, in order, the exact same way collapsePlanner matches
 * `contact` rows — the only difference is a match updates an EXISTING
 * person's plan instead of merging into an in-memory plan person.
 */
export function planFoldLeads(
  existingPersons: FoldExistingPerson[],
  leads: FoldLeadRow[],
): FoldPlan {
  const byProfileKey = new Map<string, string>();
  const byVerifiedEmail = new Map<string, string>();
  const byNameCompany = new Map<string, string[]>();
  const mergedByRef = new Map<string, FoldMergedFields>();
  const updatedRefs = new Set<string>();

  for (const person of existingPersons) {
    mergedByRef.set(person.id, toMerged(person));
    if (person.profileKey) byProfileKey.set(person.profileKey, person.id);
    if (person.emailStatus === "verified" && person.emailNormalized) {
      byVerifiedEmail.set(person.emailNormalized, person.id);
    }
    const key = nameCompanyKeyFromPerson(person);
    if (key) {
      const list = byNameCompany.get(key) ?? [];
      list.push(person.id);
      byNameCompany.set(key, list);
    }
  }

  const index: IdentityIndex = {
    byProfileKey: (key) => byProfileKey.get(key) ?? null,
    byVerifiedEmail: (email) => byVerifiedEmail.get(email) ?? null,
    byNameCompany: (key) => byNameCompany.get(key) ?? [],
  };

  const mappings: FoldLeadMapping[] = [];
  const reviewPairs: FoldReviewPair[] = [];
  let nextPlanId = 1;
  let ownCompanySkipped = 0;
  let autoMerged = 0;
  let flaggedForReview = 0;
  let newCount = 0;

  function registerRefKeys(ref: string, lead: FoldLeadRow) {
    // No profileKey on leads (contact-identity spec: "Lead without email or
    // LinkedIn falls back to name+company") — only email/name+company grow.
    if (lead.emailStatus === "verified" && lead.email) {
      const key = lead.email.trim().toLowerCase();
      if (!byVerifiedEmail.has(key)) byVerifiedEmail.set(key, ref);
    }
    const key = buildNameCompanyKey(lead);
    if (key) {
      const list = byNameCompany.get(key) ?? [];
      if (!list.includes(ref)) list.push(ref);
      byNameCompany.set(key, list);
    }
  }

  for (const lead of leads) {
    const matchRow = {
      email: lead.email,
      emailStatus: lead.emailStatus,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
    };
    const result = matchIdentity(matchRow, index);

    if (result.kind === "skip_own_company") {
      mappings.push({ legacyLeadId: lead.id, method: "skipped_own_company", personRef: null });
      ownCompanySkipped++;
      continue;
    }

    if (result.kind === "auto") {
      const existing = mergedByRef.get(result.personId);
      if (!existing) {
        throw new Error(`Planner invariant violated: unknown person ${result.personId}`);
      }
      mergedByRef.set(result.personId, mergeFields(existing, leadAsMerged(lead)));
      updatedRefs.add(result.personId);
      registerRefKeys(result.personId, lead);
      mappings.push({ legacyLeadId: lead.id, method: result.key, personRef: result.personId });
      autoMerged++;
      continue;
    }

    // "review" and "new" both create a fresh plan person for this lead
    // (design D3: no data waits on the review).
    const planId = `np${nextPlanId++}`;
    mergedByRef.set(planId, leadAsMerged(lead));
    registerRefKeys(planId, lead);
    mappings.push({
      legacyLeadId: lead.id,
      method: result.kind === "review" ? "review" : "new",
      personRef: planId,
    });

    if (result.kind === "review") {
      flaggedForReview++;
      for (const otherRef of result.personIds) {
        if (otherRef === planId) continue;
        const [refA, refB] = otherRef < planId ? [otherRef, planId] : [planId, otherRef];
        reviewPairs.push({
          refA,
          refB,
          reason: result.reason,
          matchKey:
            result.reason === "name_company"
              ? (buildNameCompanyKey(matchRow) ?? "")
              : `conflicting:${lead.email?.trim().toLowerCase() ?? ""}`,
        });
      }
    } else {
      newCount++;
    }
  }

  const matchedUpdates: FoldMatchedUpdate[] = [...updatedRefs].map((personId) => ({
    personId,
    merged: mergedByRef.get(personId)!,
  }));

  const newPersons: FoldNewPerson[] = [];
  for (const mapping of mappings) {
    if (mapping.method !== "new" && mapping.method !== "review") continue;
    if (!mapping.personRef) continue;
    // Same planId may be referenced by only one lead (fold rows never merge
    // with each other, only with existing persons), so this always emits
    // exactly one FoldNewPerson per plan id.
    if (newPersons.some((p) => p.planId === mapping.personRef)) continue;
    const lead = leads.find((l) => l.id === mapping.legacyLeadId)!;
    newPersons.push({
      planId: mapping.personRef,
      merged: mergedByRef.get(mapping.personRef)!,
      ownerBdId: lead.ownerBdId,
      sourceKey: lead.sourceKey,
    });
  }

  return {
    mappings,
    matchedUpdates,
    newPersons,
    reviewPairs,
    report: {
      lead: {
        rowsRead: leads.length,
        ownCompanySkipped,
        autoMerged,
        flaggedForReview,
        new: newCount,
      },
      persons: { created: newPersons.length, updated: matchedUpdates.length },
    },
  };
}
