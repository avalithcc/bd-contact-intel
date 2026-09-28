/**
 * Pure row-mapping and fill-empty planner behind
 * scripts/backfill-hubspot-phones.ts (phone-calls change, Step 2.7). No I/O
 * — the script reads the CSV (parseHubSpotCsv), resolves the existing
 * `person`/`person_id_map` rows for the batch of HubSpot record ids present
 * in the file (one query, never per-row), and calls `planPhoneBackfill`
 * with the result before writing anything.
 *
 * "Número de teléfono" -> person.phone, "Número de móvil" -> person.mobile_phone
 * (owner mapping). Matching goes through `person_id_map` keyed by
 * `legacy_table = 'hubspot_contact'` and `legacy_id = hubspotLegacyId(hubspotContactId)`
 * (src/lib/hubspot/uuidv5.ts — the SAME deterministic uuid v5 derivation the
 * main HubSpot import already uses), never a fresh name/email match.
 *
 * Fill-empty only: a column already holding a value is never overwritten,
 * even with different incoming data — this is a backfill for rows that
 * predate migration 0016's phone columns, not a re-sync.
 */
import { hubspotLegacyId } from "@/lib/hubspot/uuidv5";

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface HubspotPhoneRow {
  hubspotContactId: string;
  phone: string | null;
  mobilePhone: string | null;
}

/** Maps one parsed CSV row (csv-parse's `Record<string,string>` projection,
 * same shape src/lib/hubspot/parse.ts#parseHubSpotCsv returns) to the two
 * phone columns this backfill fills. */
export function mapPhoneBackfillRow(row: Record<string, string>): HubspotPhoneRow {
  return {
    hubspotContactId: row["ID de registro"]!.trim(),
    phone: blank(row["Número de teléfono"]),
    mobilePhone: blank(row["Número de móvil"]),
  };
}

/** One matched person's CURRENT phone/mobilePhone state, as the script
 * reads it (joining `person_id_map` -> `person`) before planning. */
export interface ExistingPersonPhoneRow {
  personId: string;
  phone: string | null;
  mobilePhone: string | null;
}

/** One person's fill-empty update — only the keys that actually changed are
 * present, so the script's batched `UPDATE ... FROM (VALUES ...)` (mirrors
 * scripts/backfill-company-categories.ts) only ever sets a column that was
 * previously null. */
export interface PhoneBackfillUpdate {
  personId: string;
  phone?: string;
  mobilePhone?: string;
}

export interface PhoneBackfillPlan {
  updates: PhoneBackfillUpdate[];
  /** Rows whose HubSpot record id resolved to a `person_id_map` row. */
  matched: number;
  /** Rows with no `person_id_map` entry for their HubSpot record id (e.g.
   * a contact never imported, or an own-company row skipped at import). */
  skippedNoMatch: number;
  /** Matched rows where every already-empty column stayed empty in the
   * CSV too (no new data to fill), or every non-empty CSV value already had
   * a value in the DB (fill-empty rule). */
  skippedNoNewData: number;
}

/**
 * `existingByLegacyId` is keyed by `person_id_map.legacy_id`
 * (`hubspotLegacyId(hubspotContactId)`) — the script builds this map once
 * per page/batch, never re-querying per row.
 */
export function planPhoneBackfill(
  rows: readonly HubspotPhoneRow[],
  existingByLegacyId: ReadonlyMap<string, ExistingPersonPhoneRow>,
): PhoneBackfillPlan {
  const updates: PhoneBackfillUpdate[] = [];
  let matched = 0;
  let skippedNoMatch = 0;
  let skippedNoNewData = 0;

  for (const row of rows) {
    const legacyId = hubspotLegacyId(row.hubspotContactId);
    const existing = existingByLegacyId.get(legacyId);
    if (!existing) {
      skippedNoMatch++;
      continue;
    }
    matched++;

    const update: PhoneBackfillUpdate = { personId: existing.personId };
    let changed = false;
    if (existing.phone === null && row.phone !== null) {
      update.phone = row.phone;
      changed = true;
    }
    if (existing.mobilePhone === null && row.mobilePhone !== null) {
      update.mobilePhone = row.mobilePhone;
      changed = true;
    }

    if (changed) updates.push(update);
    else skippedNoNewData++;
  }

  return { updates, matched, skippedNoMatch, skippedNoNewData };
}
