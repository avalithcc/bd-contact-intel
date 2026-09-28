/**
 * Pure row-mapping and fill-empty planner behind
 * scripts/backfill-hubspot-company-fields.ts (company-fields change,
 * owner-approved 2026-09-26). No I/O — the script parses the companies CSV,
 * resolves each row's `company_key` via
 * src/lib/hubspot/companies.ts#planCompanyResolution (the SAME resolution
 * the main import uses) and each row's owner via
 * src/lib/hubspot/owners.ts#matchHubSpotOwner, then calls
 * `planCompanyFieldsBackfill` with the result before writing anything.
 *
 * "Sector" -> industry, "Ciudad" -> city, "País/región" -> country,
 * "Propietario del registro de empresa" -> ownerBdId (owner mapping).
 *
 * Fill-empty only: a column already holding a value is never overwritten.
 * Two HubSpot company rows can resolve to the same `companyKey` (duplicate
 * export entries for the same real company, same as the main import's
 * grouping) — the first non-null value encountered, in the order the script
 * supplies rows, wins for each field.
 */
function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface RawCompanyFieldsRow {
  hubspotCompanyId: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  ownerRaw: string | null;
}

/** Maps one parsed CSV row (csv-parse's `Record<string,string>` projection,
 * same shape src/lib/hubspot/parse.ts#parseHubSpotCsv returns) to the raw
 * fields this backfill fills. `ownerRaw` still needs
 * src/lib/hubspot/owners.ts#matchHubSpotOwner against the current `bd` list
 * before it can be written. */
export function mapCompanyFieldsBackfillRow(row: Record<string, string>): RawCompanyFieldsRow {
  return {
    hubspotCompanyId: row["ID de registro"]!.trim(),
    industry: blank(row["Sector"]),
    city: blank(row["Ciudad"]),
    country: blank(row["País/región"]),
    ownerRaw: blank(row["Propietario del registro de empresa"]),
  };
}

/** One CSV row after both resolutions have run: `companyKey` from
 * `planCompanyResolution`, `ownerBdId` from `matchHubSpotOwner` (null for a
 * blank, deactivated, or unmatched HubSpot owner — never written). */
export interface CompanyFieldsBackfillRow {
  hubspotCompanyId: string;
  companyKey: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  ownerBdId: string | null;
}

/** One matched company's CURRENT field state, as the script reads it from
 * `company` before planning. */
export interface ExistingCompanyFieldsRow {
  industry: string | null;
  city: string | null;
  country: string | null;
  ownerBdId: string | null;
}

/** One company's fill-empty update — only the keys that actually changed
 * are present, so the script's batched `UPDATE ... FROM (VALUES ...)`
 * (mirrors scripts/backfill-hubspot-phones.ts) only ever sets a column that
 * was previously null. */
export interface CompanyFieldsBackfillUpdate {
  companyKey: string;
  industry?: string;
  city?: string;
  country?: string;
  ownerBdId?: string;
}

export interface CompanyFieldsBackfillFieldCounts {
  industry: number;
  city: number;
  country: number;
  ownerBdId: number;
}

export interface CompanyFieldsBackfillPlan {
  updates: CompanyFieldsBackfillUpdate[];
  /** Distinct companies that at least one row resolved to. */
  matched: number;
  /** Matched companies where every already-empty field stayed empty in the
   * CSV too (fill-empty rule). */
  skippedNoNewData: number;
  /** Per-field fill counts across `updates` — never row-level values. */
  fieldCounts: CompanyFieldsBackfillFieldCounts;
}

/**
 * `existingByKey` is keyed by `company.company_key` — the script builds
 * this once for every `companyKey` that `planCompanyResolution` resolved,
 * never re-querying per row. Rows whose `companyKey` has no entry in
 * `existingByKey` are silently skipped (defensive: should not happen, since
 * every `companyKey` here came from `planCompanyResolution` matching an
 * existing company).
 */
export function planCompanyFieldsBackfill(
  rows: readonly CompanyFieldsBackfillRow[],
  existingByKey: ReadonlyMap<string, ExistingCompanyFieldsRow>,
): CompanyFieldsBackfillPlan {
  const pending = new Map<string, CompanyFieldsBackfillUpdate>();
  const matchedKeys = new Set<string>();

  for (const row of rows) {
    const existing = existingByKey.get(row.companyKey);
    if (!existing) continue;
    matchedKeys.add(row.companyKey);

    const update = pending.get(row.companyKey) ?? { companyKey: row.companyKey };
    if (existing.industry === null && update.industry === undefined && row.industry !== null) {
      update.industry = row.industry;
    }
    if (existing.city === null && update.city === undefined && row.city !== null) {
      update.city = row.city;
    }
    if (existing.country === null && update.country === undefined && row.country !== null) {
      update.country = row.country;
    }
    if (existing.ownerBdId === null && update.ownerBdId === undefined && row.ownerBdId !== null) {
      update.ownerBdId = row.ownerBdId;
    }
    pending.set(row.companyKey, update);
  }

  const updates: CompanyFieldsBackfillUpdate[] = [];
  const fieldCounts: CompanyFieldsBackfillFieldCounts = { industry: 0, city: 0, country: 0, ownerBdId: 0 };
  let skippedNoNewData = 0;

  for (const update of pending.values()) {
    const hasAny =
      update.industry !== undefined ||
      update.city !== undefined ||
      update.country !== undefined ||
      update.ownerBdId !== undefined;
    if (!hasAny) {
      skippedNoNewData++;
      continue;
    }
    if (update.industry !== undefined) fieldCounts.industry++;
    if (update.city !== undefined) fieldCounts.city++;
    if (update.country !== undefined) fieldCounts.country++;
    if (update.ownerBdId !== undefined) fieldCounts.ownerBdId++;
    updates.push(update);
  }

  return { updates, matched: matchedKeys.size, skippedNoNewData, fieldCounts };
}
