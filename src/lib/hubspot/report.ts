/**
 * Wraps a raw `planHubSpotImport` result into the persisted dry-run report
 * shape (design D7) and its PII-safe stdout projection (design D8, task
 * 4.8). No DB access — the caller (hubspotRun.ts) supplies the prefetched
 * existing-person snapshot this needs for the review sample.
 */
import { createHash } from "node:crypto";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";
import type { HubSpotImportReport, PlanHubSpotImportResult } from "@/lib/hubspot/planner";

/** hubspot-import spec "Review-count threshold gate": above this, the
 * approve action (and, defense-in-depth, --execute itself) requires an
 * explicit owner confirmation. */
export const HUBSPOT_REVIEW_THRESHOLD = 300;
const REVIEW_SAMPLE_SIZE = 20;

export interface HubSpotReviewSampleEntry {
  reason: string;
  incoming: { name: string | null; companyKey: string | null; emailDomain: string | null };
  existing: { personId: string; name: string | null; companyKey: string | null };
}

export interface HubSpotRunReport extends HubSpotImportReport {
  reviewThreshold: number;
  overThreshold: boolean;
  createdCompanyKeys: string[];
  domainFilledCompanyKeys: string[];
  /** ≤20 pairs, admin-only (design D8) — email LOCAL PARTS are never
   * included, only the domain. Never printed to stdout: see
   * redactReportForLog. */
  reviewSample: HubSpotReviewSampleEntry[];
}

/** Subset of an existing person candidate the review sample needs. */
export interface HubSpotReviewExistingPerson {
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
}

function personDisplayName(firstName: string | null, lastName: string | null): string | null {
  const name = [firstName, lastName].filter((v): v is string => !!v).join(" ").trim();
  return name || null;
}

function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase() || null;
}

/** Lowest sha256(hubspotContactId) first — deterministic across reruns of
 * the same dry run (design D7: "20 pairs chosen deterministically"). */
function sampleSortKey(hubspotContactId: string): string {
  return createHash("sha256").update(hubspotContactId).digest("hex");
}

function buildReviewSample(
  plan: PlanHubSpotImportResult,
  contactsByHubspotId: ReadonlyMap<string, HubSpotContactRow>,
  existingById: ReadonlyMap<string, HubSpotReviewExistingPerson>,
): HubSpotReviewSampleEntry[] {
  if (!plan.identityPlan) return [];

  const hubspotIdByRef = new Map<string, string>();
  for (const outcome of plan.outcomes) {
    if (outcome.outcome === "review" && outcome.personId) hubspotIdByRef.set(outcome.personId, outcome.hubspotContactId);
  }

  const entries: (HubSpotReviewSampleEntry & { sortKey: string })[] = [];
  for (const pair of plan.identityPlan.reviewPairs) {
    const incomingRef = hubspotIdByRef.has(pair.refA)
      ? pair.refA
      : hubspotIdByRef.has(pair.refB)
        ? pair.refB
        : null;
    if (!incomingRef) continue;
    const existingRef = incomingRef === pair.refA ? pair.refB : pair.refA;
    const hubspotContactId = hubspotIdByRef.get(incomingRef)!;
    const contact = contactsByHubspotId.get(hubspotContactId);
    if (!contact) continue;
    const existing = existingById.get(existingRef);

    entries.push({
      reason: pair.reason,
      incoming: {
        name: personDisplayName(contact.firstName, contact.lastName),
        companyKey: contact.associatedCompanyIdPrimary
          ? (plan.outcomes.find((o) => o.hubspotContactId === hubspotContactId)?.companyKey ?? null)
          : null,
        emailDomain: emailDomain(contact.email),
      },
      existing: {
        personId: existingRef,
        name: existing ? personDisplayName(existing.firstName, existing.lastName) : null,
        companyKey: existing?.companyKey ?? null,
      },
      sortKey: sampleSortKey(hubspotContactId),
    });
  }

  return entries
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .slice(0, REVIEW_SAMPLE_SIZE)
    .map(({ sortKey: _sortKey, ...entry }) => entry);
}

/** Builds the full, persisted `migration_run.report` for a `hubspot_import`
 * dry run (design D7). `contactsByHubspotId`/`existingById` feed the review
 * sample only — every other field comes straight from the planner's
 * `HubSpotImportReport`. */
export function buildHubSpotRunReport(
  plan: PlanHubSpotImportResult,
  contactsByHubspotId: ReadonlyMap<string, HubSpotContactRow>,
  existingById: ReadonlyMap<string, HubSpotReviewExistingPerson>,
): HubSpotRunReport {
  const reviewCount = plan.report.outcomes.review;
  return {
    ...plan.report,
    reviewThreshold: HUBSPOT_REVIEW_THRESHOLD,
    overThreshold: reviewCount > HUBSPOT_REVIEW_THRESHOLD,
    createdCompanyKeys: plan.companyResolution.companiesToCreate.map((c) => c.companyKey),
    domainFilledCompanyKeys: plan.companyResolution.domainFills.map((f) => f.companyKey),
    reviewSample: buildReviewSample(plan, contactsByHubspotId, existingById),
  };
}

export interface RedactedHubSpotRunReport extends Omit<HubSpotRunReport, "reviewSample" | "owners"> {
  owners: { mapped: number; unassigned: number; unknown: number };
}

/** PII-safe stdout projection (design D8): `reviewSample` is removed
 * entirely (it stays DB-only, admin-reviewed) and the owner name maps
 * collapse to counts — BD names aren't PII, but there's no reason for a
 * per-name breakdown to ever hit a log line. */
export function redactReportForLog(report: HubSpotRunReport): RedactedHubSpotRunReport {
  const { reviewSample: _reviewSample, owners, ...rest } = report;
  const mapped = Object.values(owners.mapped).reduce((sum, n) => sum + n, 0);
  const unknown = Object.values(owners.unknown).reduce((sum, n) => sum + n, 0);
  return { ...rest, owners: { mapped, unassigned: owners.unassigned, unknown } };
}
