/**
 * Pure single entry point (task 3.9) orchestrating the whole HubSpot import
 * plan: companies (Phase 2) -> contacts -> identity (planIdentityWrites) ->
 * refill (already-imported rows) -> status-evidence activities. No DB
 * access — the DB-wiring phase (Phase 4, importQueries.ts/hubspotRun.ts)
 * prefetches every input this module needs and feeds them in, then reads
 * this plan back out to build the actual insert/update rows.
 *
 * Row outcome classification (hubspot-import spec "Row classification per
 * contact", task 3.10): every contact row lands in EXACTLY ONE of
 * `new` / `review` / `profile_key` / `skipped_own_company` /
 * `already_imported` / `invalid`.
 *
 *   1. A hubspotContactId repeated more than once in the same export is
 *      `invalid` on every occurrence AFTER the first — csv-parse dropping
 *      one silently would be worse than surfacing it.
 *   2. A hubspotContactId already present in `existingHubspotPersonIds`
 *      (a prior run's person_id_map) is `already_imported` — it skips the
 *      matcher entirely (design D4) and is planned through
 *      `planHubSpotRefill` instead.
 *   3. A row whose resolved company is the own company is
 *      `skipped_own_company` (design D3) — it never reaches the matcher.
 *   4. Everything else is batched through `planIdentityWrites` (mergePolicy
 *      'fill_empty'), which classifies it `new` / `review` / `profile_key`.
 */
import {
  planCompanyResolution,
  resolveContactCompanyKey,
  type CompanyResolutionResult,
  type ExistingCompanyRef,
  type HubSpotCompanyRow,
} from "@/lib/hubspot/companies";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import { mapHubSpotContactToIdentityRow } from "@/lib/hubspot/identity";
import { matchHubSpotOwner } from "@/lib/hubspot/owners";
import {
  planHubSpotRefill,
  type HubSpotRefillExistingPerson,
  type HubSpotRefillPlan,
} from "@/lib/hubspot/refill";
import { planStatusEvidence, type StatusEvidencePlan } from "@/lib/hubspot/statusEvidence";
import {
  planIdentityWrites,
  type IdentityIngestRow,
  type IdentityWritePlan,
  type PrefetchedIdentityIndex,
} from "@/lib/identity/resolve";

export type HubSpotContactOutcome =
  | "new"
  | "review"
  | "profile_key"
  | "skipped_own_company"
  | "already_imported"
  | "invalid";

export interface HubSpotContactPlanOutcome {
  hubspotContactId: string;
  outcome: HubSpotContactOutcome;
  /** A real person id (already_imported, or an in-run auto-match), a plan
   * ref (new/review — resolved to a generated id downstream, same
   * convention as planIdentityWrites), or null (skipped_own_company,
   * invalid). */
  personId: string | null;
  /** The row's resolved company key (Phase 2), for report.ts's reviewSample
   * (design D7) — null when unresolved/own-company/invalid. */
  companyKey: string | null;
}

export interface HubSpotRefillOutcome {
  hubspotContactId: string;
  personId: string;
  plan: HubSpotRefillPlan;
}

export interface HubSpotStatusEvidenceOutcome {
  hubspotContactId: string;
  /** Real person id or plan ref — same duality as HubSpotContactPlanOutcome. */
  personRef: string;
  plan: StatusEvidencePlan;
}

export interface HubSpotImportReport {
  rowsRead: number;
  outcomes: Record<HubSpotContactOutcome, number>;
  owners: {
    mapped: Record<string, number>;
    unassigned: number;
    unknown: Record<string, number>;
  };
  companies: {
    matchedByDomain: number;
    matchedByName: number;
    /** Matched via the compact-key fallback (H6 dry-run finding: company.domain
     * is not populated yet, so exact-name matching alone missed ~60 near-
     * duplicates). See src/lib/hubspot/companies.ts#normalizeCompactCompanyKey. */
    matchedByCompact: number;
    created: number;
    ownCompany: number;
    noCompanyResolved: number;
    notes: number;
  };
  backfills: { contacted: number; replied: number; discarded: number };
  dateFallback: number;
  warnings: {
    duplicateHubspotContactIds: string[];
    associatedCompanyIdPrimaryMultiple: number;
    noCompanyResolved: number;
    domainConflicts: number;
    /** Compact-key candidates that matched more than one existing company —
     * reported instead of guessing; the group still gets created (H6 dry-
     * run finding). */
    ambiguousCompactMatches: number;
    /** Non-empty HubSpot lead status values this module doesn't recognize
     * (value -> row count) — never used to plan evidence, just surfaced so
     * an unmapped label doesn't silently disappear (H6 dry-run finding).
     * Status labels are not PII. */
    unknownLeadStatuses: Record<string, number>;
  };
}

export interface PlanHubSpotImportInput {
  contacts: readonly HubSpotContactRow[];
  companies: readonly HubSpotCompanyRow[];
  existingCompanies: readonly ExistingCompanyRef[];
  existingNoteHubspotCompanyIds: ReadonlySet<string>;
  bds: readonly { id: string; name: string }[];
  /** Prior-run mapping (person_id_map, legacy_table='hubspot_contact'). */
  existingHubspotPersonIds: ReadonlyMap<string, string>;
  /** Existing person snapshot for every id in existingHubspotPersonIds, keyed by personId. */
  existingPersonsForRefill: ReadonlyMap<string, HubSpotRefillExistingPerson>;
  /** Prefetched existing-person candidates for the matcher (planIdentityWrites). */
  identityIndex: PrefetchedIdentityIndex;
  migrationRunId: string | null;
  runAt: Date;
}

export interface PlanHubSpotImportResult {
  companyResolution: CompanyResolutionResult;
  identityPlan: IdentityWritePlan | null;
  refillPlans: HubSpotRefillOutcome[];
  statusEvidence: HubSpotStatusEvidenceOutcome[];
  outcomes: HubSpotContactPlanOutcome[];
  report: HubSpotImportReport;
}

function buildPrimaryContactCounts(contacts: readonly HubSpotContactRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of contacts) {
    if (!c.associatedCompanyIdPrimary) continue;
    counts.set(c.associatedCompanyIdPrimary, (counts.get(c.associatedCompanyIdPrimary) ?? 0) + 1);
  }
  return counts;
}

function emptyReport(rowsRead: number): HubSpotImportReport {
  return {
    rowsRead,
    outcomes: { new: 0, review: 0, profile_key: 0, skipped_own_company: 0, already_imported: 0, invalid: 0 },
    owners: { mapped: {}, unassigned: 0, unknown: {} },
    companies: {
      matchedByDomain: 0,
      matchedByName: 0,
      matchedByCompact: 0,
      created: 0,
      ownCompany: 0,
      noCompanyResolved: 0,
      notes: 0,
    },
    backfills: { contacted: 0, replied: 0, discarded: 0 },
    dateFallback: 0,
    warnings: {
      duplicateHubspotContactIds: [],
      associatedCompanyIdPrimaryMultiple: 0,
      noCompanyResolved: 0,
      domainConflicts: 0,
      ambiguousCompactMatches: 0,
      unknownLeadStatuses: {},
    },
  };
}

/**
 * Plans the whole HubSpot contacts import (task 3.9). Pure — every DB read
 * this needs is prefetched by the caller and passed in.
 */
export function planHubSpotImport(input: PlanHubSpotImportInput): PlanHubSpotImportResult {
  const report = emptyReport(input.contacts.length);

  const primaryContactCounts = buildPrimaryContactCounts(input.contacts);
  const companyResolution = planCompanyResolution(
    input.companies,
    input.existingCompanies,
    primaryContactCounts,
    input.existingNoteHubspotCompanyIds,
  );
  for (const resolution of companyResolution.byHubspotCompanyId.values()) {
    if (resolution.matchReason === "domain") report.companies.matchedByDomain++;
    else if (resolution.matchReason === "name") report.companies.matchedByName++;
    else if (resolution.matchReason === "compact") report.companies.matchedByCompact++;
    else if (resolution.matchReason === "created") report.companies.created++;
    else if (resolution.matchReason === "own_company") report.companies.ownCompany++;
  }
  report.companies.notes = companyResolution.notesToCreate.length;
  report.warnings.domainConflicts = companyResolution.domainConflicts.length;
  report.warnings.ambiguousCompactMatches = companyResolution.ambiguousCompactMatches;

  // Indexed by the row's position in input.contacts, so the final
  // `outcomes` array preserves original row order regardless of which
  // branch (immediate classification vs. the batched identity plan,
  // resolved after this loop) produced each row's outcome.
  const outcomesByIndex: (HubSpotContactPlanOutcome | undefined)[] = new Array(input.contacts.length);
  const refillPlans: HubSpotRefillOutcome[] = [];
  const statusEvidence: HubSpotStatusEvidenceOutcome[] = [];
  const identityRows: IdentityIngestRow[] = [];
  // Parallel to identityRows: the original input.contacts index each row
  // came from, so the outcome list can be filled in by index AFTER
  // planIdentityWrites resolves each row's method.
  const identityRowIndices: number[] = [];
  // Parallel to input.contacts: the row's resolved companyKey (Phase 2),
  // kept so the batched identity branch below (which resolves AFTER this
  // loop) can still attach it to each outcome for report.ts's reviewSample.
  const companyKeyByIndex: (string | null)[] = new Array(input.contacts.length).fill(null);
  const seenContactIds = new Set<string>();

  input.contacts.forEach((contact, index) => {
    if (seenContactIds.has(contact.hubspotContactId)) {
      outcomesByIndex[index] = { hubspotContactId: contact.hubspotContactId, outcome: "invalid", personId: null, companyKey: null };
      report.outcomes.invalid++;
      if (!report.warnings.duplicateHubspotContactIds.includes(contact.hubspotContactId)) {
        report.warnings.duplicateHubspotContactIds.push(contact.hubspotContactId);
      }
      return;
    }
    seenContactIds.add(contact.hubspotContactId);

    if (contact.associatedCompanyIdPrimaryMultiple) report.warnings.associatedCompanyIdPrimaryMultiple++;

    const companyResolved = resolveContactCompanyKey(
      contact.associatedCompanyIdPrimary,
      companyResolution.byHubspotCompanyId,
    );
    if (companyResolved.noCompanyResolved) report.warnings.noCompanyResolved++;
    companyKeyByIndex[index] = companyResolved.companyKey;

    if (companyResolved.ownCompany) {
      outcomesByIndex[index] = { hubspotContactId: contact.hubspotContactId, outcome: "skipped_own_company", personId: null, companyKey: null };
      report.outcomes.skipped_own_company++;
      return;
    }

    const existingPersonId = input.existingHubspotPersonIds.get(contact.hubspotContactId);
    if (existingPersonId) {
      outcomesByIndex[index] = {
        hubspotContactId: contact.hubspotContactId,
        outcome: "already_imported",
        personId: existingPersonId,
        companyKey: companyResolved.companyKey,
      };
      report.outcomes.already_imported++;

      const owner = contact.ownerRaw ? matchHubSpotOwner(contact.ownerRaw, input.bds) : { bdId: null, unknownOwnerName: null };
      trackOwner(report, contact.ownerRaw, owner, input.bds);

      const existingForRefill = input.existingPersonsForRefill.get(existingPersonId);
      if (existingForRefill) {
        const refillPlan = planHubSpotRefill(existingForRefill, {
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: null,
          companyKey: companyResolved.companyKey,
          jobTitle: contact.jobTitle,
          industry: null,
          city: contact.city,
          country: contact.country,
          ownerBdId: owner.bdId,
          email: contact.email,
          emailStatus: contact.email ? "probable" : "none",
          emailConfidence: null,
          emailSource: contact.email ? "hubspot_import" : null,
        });
        refillPlans.push({ hubspotContactId: contact.hubspotContactId, personId: existingPersonId, plan: refillPlan });
      }

      trackStatusEvidence(report, statusEvidence, contact, existingPersonId, owner.bdId, input.runAt);
      return;
    }

    const owner = contact.ownerRaw ? matchHubSpotOwner(contact.ownerRaw, input.bds) : { bdId: null, unknownOwnerName: null };
    trackOwner(report, contact.ownerRaw, owner, input.bds);

    identityRows.push(
      mapHubSpotContactToIdentityRow({
        contact,
        companyKey: companyResolved.companyKey,
        ownerBdId: owner.bdId,
        migrationRunId: input.migrationRunId,
      }),
    );
    identityRowIndices.push(index);
  });

  let identityPlan: IdentityWritePlan | null = null;
  if (identityRows.length > 0) {
    identityPlan = planIdentityWrites(identityRows, input.identityIndex, "fill_empty");
    identityPlan.rowOutcomes.forEach((rowOutcome, i) => {
      const index = identityRowIndices[i]!;
      const contact = input.contacts[index]!;
      const outcome: HubSpotContactOutcome =
        rowOutcome.method === "skipped_own_company"
          ? "skipped_own_company"
          : rowOutcome.method === "review"
            ? "review"
            : rowOutcome.method === "new"
              ? "new"
              : "profile_key";
      outcomesByIndex[index] = {
        hubspotContactId: contact.hubspotContactId,
        outcome,
        personId: rowOutcome.personRef,
        companyKey: companyKeyByIndex[index] ?? null,
      };
      report.outcomes[outcome]++;

      if (outcome !== "skipped_own_company" && rowOutcome.personRef) {
        trackStatusEvidence(report, statusEvidence, contact, rowOutcome.personRef, rowOutcome.row.ownerBdId ?? null, input.runAt);
      }
    });
  }

  const outcomes = outcomesByIndex.map((outcome, index) => {
    if (!outcome) throw new Error(`Planner invariant violated: row ${index} was never classified`);
    return outcome;
  });

  return { companyResolution, identityPlan, refillPlans, statusEvidence, outcomes, report };
}

function trackOwner(
  report: HubSpotImportReport,
  ownerRaw: string | null,
  owner: { bdId: string | null; unknownOwnerName: string | null },
  bds: readonly { id: string; name: string }[],
): void {
  if (!ownerRaw || !ownerRaw.trim()) {
    report.owners.unassigned++;
    return;
  }
  if (owner.bdId) {
    // Key by the BD's own canonical name (not the raw HubSpot spelling),
    // so "Macarena Davila" and any other accent variant of the same BD
    // collapse into one report bucket.
    const bdName = bds.find((bd) => bd.id === owner.bdId)?.name ?? ownerRaw.trim();
    report.owners.mapped[bdName] = (report.owners.mapped[bdName] ?? 0) + 1;
    return;
  }
  if (owner.unknownOwnerName) {
    report.owners.unknown[owner.unknownOwnerName] = (report.owners.unknown[owner.unknownOwnerName] ?? 0) + 1;
    return;
  }
  report.owners.unassigned++;
}

function trackStatusEvidence(
  report: HubSpotImportReport,
  statusEvidence: HubSpotStatusEvidenceOutcome[],
  contact: HubSpotContactRow,
  personRef: string,
  ownerBdId: string | null,
  runAt: Date,
): void {
  const plan = planStatusEvidence(contact, ownerBdId, runAt);
  if (plan.unknownLeadStatus) {
    report.warnings.unknownLeadStatuses[plan.unknownLeadStatus] =
      (report.warnings.unknownLeadStatuses[plan.unknownLeadStatus] ?? 0) + 1;
  }
  if (plan.activities.length === 0) return;
  statusEvidence.push({ hubspotContactId: contact.hubspotContactId, personRef, plan });
  if (plan.dateFallback) report.dateFallback++;
  for (const activity of plan.activities) {
    if (activity.status === "contacted") report.backfills.contacted++;
    else if (activity.status === "replied") report.backfills.replied++;
    else if (activity.status === "discarded") report.backfills.discarded++;
  }
}
