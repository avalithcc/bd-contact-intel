/**
 * Pure company resolution planning for the HubSpot import (design D3,
 * hubspot-import spec "Company matching and creation" / "Company domain
 * storage" / "Contact-to-company linking" / "Company notes become
 * company-level activities" / "Own-company skip"). No DB dependency — see
 * src/lib/hubspot/companyQueries.ts for the thin read-only reader this
 * plans against.
 *
 * Resolution order per HubSpot company group (design D3):
 *   1. group HubSpot company rows that share a normalized domain (primary
 *      or "Dominios adicionales") — duplicate HubSpot entries for the same
 *      real company are common in exports;
 *   2. match the group to an existing `company` by domain;
 *   3. failing that, by the `companyKey` (normalizeCompanyKey) of any row's
 *      name in the group — a name match fills the existing company's
 *      `domain` only if it was empty, never overwrites one already set;
 *   4. failing that, create a new company — but ONLY if the group is the
 *      primary company of at least one imported contact, or carries a
 *      non-empty "Associated Note" (an unlinked, note-less company creates
 *      nothing);
 *   5. own-company groups (see src/lib/ownCompany.ts) short-circuit all of
 *      the above: they create nothing and get no note, matching the
 *      existing own-company skip rule for contacts.
 */
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { ownCompanyMatchReason, type OwnCompanyMatchReason } from "@/lib/ownCompany";

export interface HubSpotCompanyRow {
  hubspotCompanyId: string;
  name: string | null;
  domain: string | null;
  additionalDomains: string[];
  note: string | null;
  city: string | null;
  country: string | null;
  sector: string | null;
}

/** An existing `company` row, as read by companyQueries.ts. `domain` is
 * null both for "no domain on file" and for "read before migration 0015
 * was applied" — the resolution logic treats both identically. */
export interface ExistingCompanyRef {
  companyKey: string;
  domain: string | null;
}

export type CompanyMatchReason = "domain" | "name" | "created" | "own_company" | "unresolved";

export interface CompanyResolution {
  /** Resolved/created company key, or null when unresolved or own-company. */
  companyKey: string | null;
  matchReason: CompanyMatchReason;
  ownCompanyMatchReason: OwnCompanyMatchReason;
}

export interface CompanyToCreate {
  companyKey: string;
  displayName: string;
  domain: string | null;
  /** The representative HubSpot company row this creation was derived from
   * (most primary contacts, ties -> lowest numeric/lexicographic id). */
  hubspotCompanyId: string;
}

export interface DomainFill {
  companyKey: string;
  domain: string;
}

export interface CompanyNoteToCreate {
  companyKey: string;
  hubspotCompanyId: string;
  body: string;
}

export interface CompanyResolutionResult {
  byHubspotCompanyId: Map<string, CompanyResolution>;
  companiesToCreate: CompanyToCreate[];
  domainFills: DomainFill[];
  notesToCreate: CompanyNoteToCreate[];
}

export interface CompanyGroup {
  /** All normalized domains carried by any row in this group, deduped. */
  domains: string[];
  rows: HubSpotCompanyRow[];
}

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Lowercase, strip scheme, strip a leading `www.`, strip path/query/fragment. */
export function normalizeDomain(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const noScheme = lower.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const noWww = noScheme.replace(/^www\./, "");
  const host = noWww.split(/[/?#]/)[0]!.trim();
  return host || null;
}

function splitAdditionalDomains(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[;,]/)
    .map((d) => normalizeDomain(d))
    .filter((d): d is string => d !== null);
}

export function mapHubSpotCompanyRow(row: Record<string, string>): HubSpotCompanyRow {
  return {
    hubspotCompanyId: row["ID de registro"]!.trim(),
    name: blank(row["Nombre de la empresa"]),
    domain: normalizeDomain(row["Nombre de dominio de la empresa"]),
    additionalDomains: splitAdditionalDomains(row["Dominios adicionales"]),
    note: blank(row["Associated Note"]),
    city: blank(row["Ciudad"]),
    country: blank(row["País/región"]),
    sector: blank(row["Sector"]),
  };
}

function rowDomains(row: HubSpotCompanyRow): string[] {
  return row.domain ? [row.domain, ...row.additionalDomains] : [...row.additionalDomains];
}

/** Union-find: rows sharing at least one normalized domain (primary or
 * additional) merge into one group. Domain-less rows are singleton groups. */
export function groupHubSpotCompanies(rows: readonly HubSpotCompanyRow[]): CompanyGroup[] {
  const parent = rows.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }

  const domainToFirstIndex = new Map<string, number>();
  rows.forEach((row, i) => {
    for (const d of rowDomains(row)) {
      const existing = domainToFirstIndex.get(d);
      if (existing === undefined) domainToFirstIndex.set(d, i);
      else union(existing, i);
    }
  });

  const groups = new Map<number, HubSpotCompanyRow[]>();
  rows.forEach((row, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(row);
  });

  return [...groups.values()].map((groupRows) => ({
    domains: [...new Set(groupRows.flatMap(rowDomains))],
    rows: groupRows,
  }));
}

/** Numeric compare when both ids parse as numbers (the common HubSpot
 * case), falling back to lexicographic so a non-numeric id never throws. */
function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function pickRepresentative(
  rows: readonly HubSpotCompanyRow[],
  primaryContactCounts: ReadonlyMap<string, number>,
): HubSpotCompanyRow {
  return rows.reduce((best, candidate) => {
    const bestCount = primaryContactCounts.get(best.hubspotCompanyId) ?? 0;
    const candidateCount = primaryContactCounts.get(candidate.hubspotCompanyId) ?? 0;
    if (candidateCount > bestCount) return candidate;
    if (candidateCount === bestCount && compareIds(candidate.hubspotCompanyId, best.hubspotCompanyId) < 0) {
      return candidate;
    }
    return best;
  }, rows[0]!);
}

function groupOwnCompanyReason(group: CompanyGroup): OwnCompanyMatchReason {
  for (const row of group.rows) {
    const reason = ownCompanyMatchReason(row.name);
    if (reason) return reason;
  }
  for (const domain of group.domains) {
    const reason = ownCompanyMatchReason(null, domain);
    if (reason) return reason;
  }
  return null;
}

/**
 * Plans company resolution/creation/domain-fills/notes for one HubSpot
 * companies export, against the existing `company` snapshot.
 *
 * `primaryContactCounts` and `existingNoteHubspotCompanyIds` are supplied by
 * the caller (Phase 3's planner wires this from the contacts export and
 * existing activity rows respectively) — this module stays pure and DB-free.
 */
export function planCompanyResolution(
  hubspotCompanies: readonly HubSpotCompanyRow[],
  existingCompanies: readonly ExistingCompanyRef[],
  primaryContactCounts: ReadonlyMap<string, number>,
  existingNoteHubspotCompanyIds: ReadonlySet<string>,
): CompanyResolutionResult {
  const existingByDomain = new Map<string, ExistingCompanyRef>();
  const existingByKey = new Map<string, ExistingCompanyRef>();
  for (const c of existingCompanies) {
    existingByKey.set(c.companyKey, c);
    if (c.domain) existingByDomain.set(c.domain, c);
  }

  const byHubspotCompanyId = new Map<string, CompanyResolution>();
  const companiesToCreate: CompanyToCreate[] = [];
  const domainFills: DomainFill[] = [];
  const notesToCreate: CompanyNoteToCreate[] = [];

  const addNotes = (companyKey: string, rows: readonly HubSpotCompanyRow[]) => {
    for (const row of rows) {
      if (row.note && !existingNoteHubspotCompanyIds.has(row.hubspotCompanyId)) {
        notesToCreate.push({ companyKey, hubspotCompanyId: row.hubspotCompanyId, body: row.note });
      }
    }
  };

  for (const group of groupHubSpotCompanies(hubspotCompanies)) {
    const ownReason = groupOwnCompanyReason(group);
    if (ownReason) {
      for (const row of group.rows) {
        byHubspotCompanyId.set(row.hubspotCompanyId, {
          companyKey: null,
          matchReason: "own_company",
          ownCompanyMatchReason: ownReason,
        });
      }
      continue;
    }

    let matched: ExistingCompanyRef | undefined;
    for (const d of group.domains) {
      matched = existingByDomain.get(d);
      if (matched) break;
    }
    let matchReason: "domain" | "name" = "domain";
    if (!matched) {
      for (const row of group.rows) {
        if (!row.name) continue;
        const hit = existingByKey.get(normalizeCompanyKey(row.name));
        if (hit) {
          matched = hit;
          matchReason = "name";
          break;
        }
      }
    }

    if (matched) {
      if (matchReason === "name" && !matched.domain && group.domains.length > 0) {
        domainFills.push({ companyKey: matched.companyKey, domain: group.domains[0]! });
      }
      for (const row of group.rows) {
        byHubspotCompanyId.set(row.hubspotCompanyId, {
          companyKey: matched.companyKey,
          matchReason,
          ownCompanyMatchReason: null,
        });
      }
      addNotes(matched.companyKey, group.rows);
      continue;
    }

    const hasPrimaryLink = group.rows.some((r) => (primaryContactCounts.get(r.hubspotCompanyId) ?? 0) > 0);
    const hasNote = group.rows.some((r) => r.note);
    if (!hasPrimaryLink && !hasNote) {
      for (const row of group.rows) {
        byHubspotCompanyId.set(row.hubspotCompanyId, {
          companyKey: null,
          matchReason: "unresolved",
          ownCompanyMatchReason: null,
        });
      }
      continue;
    }

    const representative = pickRepresentative(group.rows, primaryContactCounts);
    const displayName = representative.name ?? representative.hubspotCompanyId;
    const companyKey = normalizeCompanyKey(displayName);
    const domain = group.domains[0] ?? null;
    companiesToCreate.push({ companyKey, displayName, domain, hubspotCompanyId: representative.hubspotCompanyId });
    for (const row of group.rows) {
      byHubspotCompanyId.set(row.hubspotCompanyId, { companyKey, matchReason: "created", ownCompanyMatchReason: null });
    }
    addNotes(companyKey, group.rows);
  }

  return { byHubspotCompanyId, companiesToCreate, domainFills, notesToCreate };
}

export interface ContactCompanyResolution {
  companyKey: string | null;
  /** True when `Associated Company IDs (Primary)` was absent, or present
   * but did not resolve to any company (hubspot-import spec "no company
   * resolved" fallback) — distinct from an own-company skip. */
  noCompanyResolved: boolean;
  ownCompany: boolean;
}

/** Resolves one contact row's `Associated Company IDs (Primary)` value
 * against the company resolution plan (hubspot-import spec "Contact-to-
 * company linking"). */
export function resolveContactCompanyKey(
  associatedCompanyIdPrimary: string | null,
  byHubspotCompanyId: ReadonlyMap<string, CompanyResolution>,
): ContactCompanyResolution {
  if (!associatedCompanyIdPrimary) {
    return { companyKey: null, noCompanyResolved: true, ownCompany: false };
  }
  const resolution = byHubspotCompanyId.get(associatedCompanyIdPrimary);
  if (!resolution) {
    return { companyKey: null, noCompanyResolved: true, ownCompany: false };
  }
  if (resolution.matchReason === "own_company") {
    return { companyKey: null, noCompanyResolved: false, ownCompany: true };
  }
  if (resolution.companyKey === null) {
    return { companyKey: null, noCompanyResolved: true, ownCompany: false };
  }
  return { companyKey: resolution.companyKey, noCompanyResolved: false, ownCompany: false };
}
