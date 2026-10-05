/**
 * Dry-run / execute report: counts only. No names, emails or phone numbers are
 * ever printed (the PDF is PII).
 */
import { NAME_INFERRED_PROPERTY, type ComercialPlan } from "./plan";

export function formatComercialReport(plan: ComercialPlan): string[] {
  const r = plan.report;
  return [
    `Contacts parsed from the file: ${r.rowsParsed}   (in-file duplicate emails collapsed: ${r.duplicatesInFile})`,
    "",
    `Already in the CRM (matched by email): ${r.matched}`,
    `  phone would be FILLED (contact had no number): ${r.phonePersonsFilled}  (${r.phoneColumnsFilled} column(s))`,
    `  file brings a number but the contact already has one, SKIPPED: ${r.skippedHasPhone}`,
    `  matched by several live persons, left alone: ${r.ambiguous}`,
    `Not in the CRM, to CREATE (owner Mariel): ${r.toCreate}   (${r.newWithPhone} with a phone)`,
    `Skipped as own company: ${r.skippedOwnCompany}`,
    "",
    `Extensions dropped from stored numbers: ${r.extensionsDropped}   (anywhere in the file: ${r.extensionsDroppedInFile})`,
    `Invalid numbers (nothing stored): ${r.invalidNumbers}`,
    `Valid numbers beyond the second (no column, not stored): ${r.extraNumbersDropped}`,
    `Inferred names loaded on new contacts (history marker '${NAME_INFERRED_PROPERTY}'): ${r.inferredNamesLoaded}   (on existing contacts, left untouched: ${r.inferredNamesOnExisting})`,
    `New contacts with NO name (email only; they can be found and called, but show no name in the CRM): ${r.createdWithoutName}`,
    `Rows carrying a last-contact date: ${r.rowsWithLastContact}   (NOT written anywhere; no activity is created)`,
  ];
}
