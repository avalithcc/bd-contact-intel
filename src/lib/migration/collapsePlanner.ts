/**
 * Pure collapse-phase migration planner (design.md "Migration plan" step 1;
 * contact-migration spec "Collapse duplicate `contact` rows"). Turns a flat
 * list of legacy `contact` rows into a plan of unified persons, own-company
 * skips and review pairs — no DB access, so it's unit-testable on fixtures
 * (tests/unit/collapsePlanner.test.ts). scripts/unify-contacts.ts and
 * src/lib/migration/collapseRun.ts wire this to the real database.
 *
 * Reuses src/lib/identity/matcher.ts's matchIdentity/mergeProperty (design
 * D3) by building an in-memory IdentityIndex that grows as rows are
 * processed — the exact same matcher every other ingestion path uses.
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
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { parseConnectedOnDate } from "./connectedOn";

export interface CollapseContactRow {
  id: string;
  bdId: string;
  profileKey: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  companyCategory: string | null;
  roleGroup: string | null;
  position: string | null;
  industry: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
  connectedOn: string | null;
}

export interface CollapseConnection {
  bdId: string;
  legacyContactId: string;
  connectedOn: string | null;
}

// 'profile_key' | 'verified_email' — this row auto-merged into an existing
// plan person via one of the matcher's strong keys.
// 'new' — this row is the first sighting of this person.
// 'review' — this row is the first sighting, but it was ALSO flagged
// against an existing person (never auto-merged) — see design D3.
export type CollapseLegacyMethod = "profile_key" | "verified_email" | "new" | "review";

export interface CollapseLegacyMapping {
  legacyContactId: string;
  method: CollapseLegacyMethod;
}

export interface CollapsePersonMerged {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  companyCategory: string | null;
  roleGroup: string | null;
  jobTitle: string | null;
  industry: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
}

export interface CollapsePlanPerson {
  planId: string;
  profileKey: string;
  merged: CollapsePersonMerged;
  legacyMappings: CollapseLegacyMapping[];
  connections: CollapseConnection[];
  ownerBdId: string | null;
}

export interface CollapseReviewPair {
  planIdA: string;
  planIdB: string;
  reason: ReviewReason;
  matchKey: string;
}

export interface CollapseOwnCompanySkip {
  legacyContactId: string;
  bdId: string;
  reason: "name" | "domain";
}

export interface CollapseReport {
  // Mutually exclusive buckets that sum to rowsRead (contact-migration
  // spec: "Dry-run report shows counts per table").
  contact: {
    rowsRead: number;
    ownCompanySkipped: number;
    autoMergedByProfileKey: number;
    flaggedForReview: number;
    new: number;
  };
  persons: {
    created: number;
    multiBd: number;
  };
  connections: {
    total: number;
    unparseableConnectedOn: number;
  };
}

export interface CollapsePlan {
  persons: CollapsePlanPerson[];
  ownCompanySkipped: CollapseOwnCompanySkip[];
  reviewPairs: CollapseReviewPair[];
  report: CollapseReport;
}

function toMerged(row: CollapseContactRow): CollapsePersonMerged {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    companyKey: row.companyKey ?? (row.company ? normalizeCompanyKey(row.company) : null),
    companyCategory: row.companyCategory,
    roleGroup: row.roleGroup,
    jobTitle: row.position,
    industry: row.industry,
    email: row.email,
    emailNormalized: row.email ? row.email.trim().toLowerCase() : null,
    emailStatus: row.emailStatus,
    emailConfidence: row.emailConfidence,
    emailSource: row.emailSource,
  };
}

function mergeStringField(a: string | null, b: string | null): string | null {
  return mergeProperty({ value: a }, { value: b }).value ?? null;
}

type EmailFields = Pick<
  CollapsePersonMerged,
  "email" | "emailNormalized" | "emailStatus" | "emailConfidence" | "emailSource"
>;

/**
 * Email-related fields move together as one unit (contact-identity R7) —
 * picking `email` from one row and `emailStatus` from the other would
 * produce an inconsistent pair. The side with the higher emailStatusRank
 * wins; a present email beats an absent one on a status tie; ties beyond
 * that keep `a` (the plan-person accumulated so far) for determinism.
 */
function mergeEmailFields(a: EmailFields, b: EmailFields): EmailFields {
  const aHas = !!a.email;
  const bHas = !!b.email;
  if (aHas && !bHas) return a;
  if (bHas && !aHas) return b;
  if (!aHas && !bHas) return a;
  return emailStatusRank(b.emailStatus) > emailStatusRank(a.emailStatus) ? b : a;
}

function mergePersonMerged(
  existing: CollapsePersonMerged,
  row: CollapseContactRow,
): CollapsePersonMerged {
  const incoming = toMerged(row);
  const email = mergeEmailFields(existing, incoming);
  return {
    firstName: mergeStringField(existing.firstName, incoming.firstName),
    lastName: mergeStringField(existing.lastName, incoming.lastName),
    company: mergeStringField(existing.company, incoming.company),
    companyKey: mergeStringField(existing.companyKey, incoming.companyKey),
    companyCategory: mergeStringField(existing.companyCategory, incoming.companyCategory),
    roleGroup: mergeStringField(existing.roleGroup, incoming.roleGroup),
    jobTitle: mergeStringField(existing.jobTitle, incoming.jobTitle),
    industry: mergeStringField(existing.industry, incoming.industry),
    ...email,
  };
}

/** Earliest parsed connectedOn wins ownership; unparseable/missing sorts last. */
function pickOwner(connections: CollapseConnection[]): {
  ownerBdId: string | null;
  unparseableCount: number;
} {
  let unparseableCount = 0;
  let best: { bdId: string; time: number } | null = null;
  for (const c of connections) {
    const parsed = parseConnectedOnDate(c.connectedOn);
    if (!parsed) unparseableCount++;
    const time = parsed ? parsed.getTime() : Number.POSITIVE_INFINITY;
    if (!best || time < best.time) best = { bdId: c.bdId, time };
  }
  return { ownerBdId: best?.bdId ?? null, unparseableCount };
}

export function planCollapse(rows: CollapseContactRow[]): CollapsePlan {
  const byProfileKey = new Map<string, string>();
  const byVerifiedEmail = new Map<string, string>();
  const byNameCompany = new Map<string, string[]>();
  const personsByPlanId = new Map<string, CollapsePlanPerson>();

  const ownCompanySkipped: CollapseOwnCompanySkip[] = [];
  const reviewPairs: CollapseReviewPair[] = [];

  let nextPlanId = 1;
  let autoMergedByProfileKey = 0;
  let flaggedForReview = 0;
  let newCount = 0;

  const index: IdentityIndex = {
    byProfileKey: (key) => byProfileKey.get(key) ?? null,
    byVerifiedEmail: (email) => byVerifiedEmail.get(email) ?? null,
    byNameCompany: (key) => byNameCompany.get(key) ?? [],
  };

  /**
   * Registers `row`'s OWN strong keys (not the plan-person's merged/winning
   * values) as pointing at `planId` — set-if-absent, NEVER repointing a key
   * that already maps to a different plan-person.
   *
   * This matters for two cases:
   *  - A "conflicting_strong_keys" review row creates a brand-new plan
   *    person C, but its profile key and/or email may already be claimed by
   *    the two persons it conflicts with (A, B). Without the set-if-absent
   *    guard, registering C would repoint those keys away from A/B, so a
   *    LATER row carrying only one of those keys would wrongly merge into C
   *    instead of the person that actually owns it.
   *  - A row that auto-merges into an existing person via ONE strong key
   *    (say, verified email) may carry a second strong key (a profile key)
   *    that isn't indexed yet. Registering it here (also set-if-absent, so
   *    it can never conflict — see matchIdentity's precedence order, which
   *    guarantees a truly "auto" match only when the unindexed key is
   *    genuinely unclaimed) lets a LATER row carrying only that second key
   *    still find the same person, instead of becoming "new".
   */
  function registerRowKeys(planId: string, row: CollapseContactRow) {
    if (row.profileKey && !byProfileKey.has(row.profileKey)) {
      byProfileKey.set(row.profileKey, planId);
    }
    if (row.emailStatus === "verified" && row.email) {
      const emailKey = row.email.trim().toLowerCase();
      if (!byVerifiedEmail.has(emailKey)) byVerifiedEmail.set(emailKey, planId);
    }
    const nameCompanyKey = buildNameCompanyKey(row);
    if (nameCompanyKey) {
      const list = byNameCompany.get(nameCompanyKey) ?? [];
      if (!list.includes(planId)) list.push(planId);
      byNameCompany.set(nameCompanyKey, list);
    }
  }

  for (const row of rows) {
    const matchRow = {
      profileKey: row.profileKey,
      email: row.email,
      emailStatus: row.emailStatus,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
    };
    const result = matchIdentity(matchRow, index);

    if (result.kind === "skip_own_company") {
      ownCompanySkipped.push({ legacyContactId: row.id, bdId: row.bdId, reason: result.reason });
      continue;
    }

    if (result.kind === "auto") {
      const person = personsByPlanId.get(result.personId);
      if (!person) {
        throw new Error(`Planner invariant violated: unknown plan person ${result.personId}`);
      }
      person.merged = mergePersonMerged(person.merged, row);
      person.legacyMappings.push({ legacyContactId: row.id, method: result.key });
      person.connections.push({
        bdId: row.bdId,
        legacyContactId: row.id,
        connectedOn: row.connectedOn,
      });
      // Learn any strong key this row carries that isn't indexed yet (e.g.
      // matched via verified email but carries a not-yet-seen profile key)
      // — see registerRowKeys for why this is always safe.
      registerRowKeys(result.personId, row);
      autoMergedByProfileKey++;
      continue;
    }

    // "review" and "new" both create a fresh plan-person for this row
    // (design D3: "It creates the new person and opens a duplicate_candidate,
    // so no data waits on the review").
    const planId = `p${nextPlanId++}`;
    const person: CollapsePlanPerson = {
      planId,
      profileKey: row.profileKey,
      merged: toMerged(row),
      legacyMappings: [{ legacyContactId: row.id, method: result.kind === "review" ? "review" : "new" }],
      connections: [{ bdId: row.bdId, legacyContactId: row.id, connectedOn: row.connectedOn }],
      ownerBdId: null,
    };
    personsByPlanId.set(planId, person);
    registerRowKeys(planId, row);

    if (result.kind === "review") {
      flaggedForReview++;
      for (const otherId of result.personIds) {
        if (otherId === planId) continue;
        const [planIdA, planIdB] = otherId < planId ? [otherId, planId] : [planId, otherId];
        reviewPairs.push({
          planIdA,
          planIdB,
          reason: result.reason,
          matchKey:
            result.reason === "name_company"
              ? (buildNameCompanyKey(matchRow) ?? "")
              : `conflicting:${row.profileKey}:${row.email?.trim().toLowerCase() ?? ""}`,
        });
      }
    } else {
      newCount++;
    }
  }

  let multiBd = 0;
  let unparseableConnectedOn = 0;
  let totalConnections = 0;
  for (const person of personsByPlanId.values()) {
    totalConnections += person.connections.length;
    const distinctBds = new Set(person.connections.map((c) => c.bdId));
    if (distinctBds.size >= 2) multiBd++;
    const { ownerBdId, unparseableCount } = pickOwner(person.connections);
    person.ownerBdId = ownerBdId;
    unparseableConnectedOn += unparseableCount;
  }

  const persons = [...personsByPlanId.values()];

  return {
    persons,
    ownCompanySkipped,
    reviewPairs,
    report: {
      contact: {
        rowsRead: rows.length,
        ownCompanySkipped: ownCompanySkipped.length,
        autoMergedByProfileKey,
        flaggedForReview,
        new: newCount,
      },
      persons: {
        created: persons.length,
        multiBd,
      },
      connections: {
        total: totalConnections,
        unparseableConnectedOn,
      },
    },
  };
}
