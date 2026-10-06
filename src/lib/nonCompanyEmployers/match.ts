/**
 * "Freelance" and "Independiente" are not employers, so a contact that put one where a company goes has no company.
 * Matching is on the SQUASHED key (src/lib/companyMerge/keys.ts), never on a list of literal strings, so a spelling
 * nobody listed is still caught. A key matches only when, after removing the non-company words, nothing is left
 * and at least one of freelance/independiente was there: "Freelance Studio" and "Club Atletico Independiente"
 * stay real companies, and a bare "Self employed" is NOT matched (the owner named freelance and independientes).
 */
import { refCount, squashCompanyKey } from "../companyMerge/keys";

// Anchored, so the engine backtracks: "independiente" + "selfemployed" must not be eaten as "independientes" + "elf...".
const ONLY_NON_COMPANY_WORDS = /^(?:selfemployed|freelancer|freelance|independientes|independiente)+$/;

export function isNonCompanyEmployer(companyKey: string): boolean {
  const squashed = squashCompanyKey(companyKey);
  return /freelance|independiente/.test(squashed) && ONLY_NON_COMPANY_WORDS.test(squashed);
}

export const findNonCompanyKeys = (keys: readonly string[]): string[] => [...new Set(keys.filter(isNonCompanyEmployer))].sort();

/** What happens to the rows that reference a matched key. Together they cover all 14 company_key tables (tested). */
export const CLEARED_TABLES = ["person", "contact", "lead"] as const; // company/company_key (and category) set to null
export const DELETED_TABLES = ["board_candidate", "company_probe", "company", "company_property_history"] as const; // junk-only rows
/**
 * Rows a company delete would CASCADE into (activity/task/signal/history via real FKs, hiring rows via
 * target_company), or that have no honest "no company" form (a company-scoped activity with its company removed is
 * a subject-less row). Any of these on a matched key STOPS the run: the owner decides, nothing is deleted.
 */
export const STOP_TABLES = ["activity", "company_alias", "job_posting", "signal", "sync_run", "target_company", "task"] as const;

export function cascadeBlockers(counts: ReadonlyMap<string, number>, keys: readonly string[]): string[] {
  return STOP_TABLES.map((t) => [t, keys.reduce((n, k) => n + refCount(counts, t, k), 0)] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t}: ${n} row(s)`);
}

/** Never 'edit': that marker makes a contact's owner sticky and freezes it out of the automatic last-worked rule. */
export const CLEANUP_HISTORY_SOURCE = "company_cleanup";

export interface ClearedPerson {
  id: string;
  company: string | null;
  companyKey: string | null;
  companyCategory: string | null;
}
const CLEARED_PROPERTIES = ["company", "companyKey", "companyCategory"] as const;

export const clearedHistoryRows = (cleared: readonly ClearedPerson[], actorBdId: string) =>
  cleared.flatMap((p) =>
    CLEARED_PROPERTIES.filter((prop) => p[prop] !== null).map((prop) => ({
      personId: p.id, property: prop, oldValue: p[prop], newValue: null, changedByBdId: actorBdId, source: CLEANUP_HISTORY_SOURCE,
    })),
  );

const MAX_EXPLICIT_KEYS = 500;

/** A confirmed list: one company_key per line, blanks and `#` comments skipped, trimmed, deduped (order kept). */
export function parseKeyList(lines: readonly string[]): string[] {
  const keys = [...new Set(lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))];
  if (!keys.length) throw new Error("The confirmed list needs at least one company_key.");
  if (keys.length > MAX_EXPLICIT_KEYS) throw new Error(`At most ${MAX_EXPLICIT_KEYS} keys per run.`);
  return keys;
}

/** `existing` = the requested keys found in any company_key table. A key found nowhere is a typo, not a no-op. */
export const resolveExplicitKeys = (requested: readonly string[], existing: ReadonlySet<string>) => ({
  keys: requested.filter((k) => existing.has(k)),
  unknown: requested.filter((k) => !existing.has(k)),
});
