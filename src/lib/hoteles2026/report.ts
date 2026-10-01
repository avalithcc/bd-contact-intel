/**
 * Renders the dry-run report. Counts and sheet row numbers only: no names,
 * emails or phone numbers are ever printed (rule: scripts print counts).
 * "Row N" is the 1-based data row of the CSV, header excluded.
 */
import type { HotelPlan } from "./plan";

const dist = (m: Record<string, number>) =>
  Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `    ${k}: ${v}`);
const rowsOf = (lines: number[]) => (lines.length ? ` (rows ${lines.join(", ")})` : "");

export function formatHotelReport(plan: HotelPlan): string[] {
  const r = plan.report;
  const out = [
    `Rows read: ${r.rowsRead}`,
    `Rows after collapsing in-file duplicates: ${r.rowsKept}`,
    `In-file duplicates collapsed (same person, most complete row kept): ${r.collapsedInFile.length}`,
    ...r.collapsedInFile.map((c) => `    rows ${c.lines.join(" + ")}`),
    "",
    `People to CREATE: ${r.toCreate}`,
    `People already imported (re-run, no-op): ${r.alreadyImported}`,
    `Rows SKIPPED: ${r.skipped.length}`,
    ...r.skipped.map((s) => `    row ${s.line}: ${s.reason}${s.personId ? ` (existing person ${s.personId})` : ""}`),
    "",
    `Companies to CREATE: ${r.companiesToCreate}`,
    `Existing companies whose owner becomes Mariel: ${plan.companyOwnerUpdates.length}`,
    ...plan.companyOwnerUpdates.map((k) => `    ${k}`),
    `Existing companies owned by ANOTHER BD, left untouched: ${r.companiesOwnedByOther.length}`,
    ...r.companiesOwnedByOther.map((k) => `    ${k}`),
    "",
    `With email: ${r.withEmail}   Without email: ${r.withoutEmail}`,
    `Email-less rows are the FRAGILE ones: ${r.emailLess.total} keyed by LinkedIn profile (${r.emailLess.keyedByProfile}) or name+company (${r.emailLess.keyedByNameCompany}).`,
    "  A different URL for the same person (e.g. percent-encoded accents) defeats the LinkedIn key and would create a duplicate.",
    "",
    "contact_type:",
    ...dist(r.contactTypes),
    "role_group (derived by classifyPosition(job title)):",
    ...dist(r.roleGroups),
    "country:",
    ...dist(r.countries),
    "",
    `Phones: phone written ${r.phones.phoneWritten}, mobile written ${r.phones.mobileWritten}`,
    `  rejected as not a phone${rowsOf(r.phones.rejectedLines)}`,
    `  leading '+' added (digits already start with the row country's dial code)${rowsOf(r.phones.addedPlusLines)}`,
    `  whitespace collapsed${rowsOf(r.phones.collapsedLines)}`,
    `  dial code does not match the row's country, stored as entered${rowsOf(r.phones.dialMismatchLines)}`,
    "",
    `Columns not imported: ${r.ignoredColumns.join(", ") || "none"}`,
  ];
  return out;
}
