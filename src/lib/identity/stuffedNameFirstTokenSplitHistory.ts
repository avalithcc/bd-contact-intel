/**
 * Pure `person_property_history` row builders for
 * scripts/backfill-split-remaining-stuffed-names.ts (owner ask, 2026-09-30:
 * "every override and fill writes the same audit and history rows as the
 * rest"). Property names ("firstName"/"lastName"/"company"/"companyKey")
 * and `source: "migration"` match the existing convention (see
 * src/lib/contacts/companyChange.ts's "company"/"companyKey" property names
 * and src/lib/identity/emailPatternInferenceBackfillDb.ts's `source:
 * "migration"` for a system-driven backfill). `changedByBdId` is always
 * `null` — same convention as emailPatternInferenceBackfillDb.ts: this is a
 * system-derived fill, not a BD's own edit, even though an operator ran the
 * script under `--actor`.
 */

export interface FirstTokenSplitHistoryRow {
  personId: string;
  property: "firstName" | "lastName" | "company" | "companyKey";
  oldValue: string | null;
  newValue: string | null;
  changedByBdId: null;
  source: "migration";
}

/**
 * One row per CHANGED field only (same "skip a no-op field" convention as
 * src/lib/contacts/companyChange.ts#historyRow) — the manual "Smart Gen"
 * override only ever changes first_name, so it must NOT also write a
 * misleading "lastName changed" row when last_name was left untouched.
 */
export function buildFirstTokenSplitNameHistoryRows(fill: {
  personId: string;
  originalFirstName: string;
  originalLastName: string | null;
  firstName: string | null;
  lastName: string | null;
}): FirstTokenSplitHistoryRow[] {
  const rows: FirstTokenSplitHistoryRow[] = [];
  if (fill.originalFirstName !== fill.firstName) {
    rows.push({
      personId: fill.personId,
      property: "firstName",
      oldValue: fill.originalFirstName,
      newValue: fill.firstName,
      changedByBdId: null,
      source: "migration",
    });
  }
  if (fill.originalLastName !== fill.lastName) {
    rows.push({
      personId: fill.personId,
      property: "lastName",
      oldValue: fill.originalLastName,
      newValue: fill.lastName,
      changedByBdId: null,
      source: "migration",
    });
  }
  return rows;
}

/** Only called for the "create a company and link it" override, and only
 * once the person's row (previously no company at all) has actually been
 * linked — both fields always move together from null. */
export function buildFirstTokenSplitCompanyLinkHistoryRows(input: {
  personId: string;
  displayName: string;
  companyKey: string;
}): FirstTokenSplitHistoryRow[] {
  return [
    { personId: input.personId, property: "company", oldValue: null, newValue: input.displayName, changedByBdId: null, source: "migration" },
    { personId: input.personId, property: "companyKey", oldValue: null, newValue: input.companyKey, changedByBdId: null, source: "migration" },
  ];
}
