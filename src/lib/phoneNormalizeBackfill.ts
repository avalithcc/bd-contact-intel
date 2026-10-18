import { normalizePhone, type PhoneColumn, type PhoneFlagReason, type PhoneRule } from "@/lib/phoneNormalize";

/**
 * Pure planner for scripts/normalize-phones.ts. Reads rows, never mutates
 * them, and tallies into a caller-owned object so a dry run and an execute
 * share one code path.
 */

export const PHONE_COLUMNS: readonly PhoneColumn[] = ["phone", "mobilePhone"];

export interface PersonPhoneRow {
  id: string;
  sourceKey: string | null;
  country: string | null;
  phone: string | null;
  mobilePhone: string | null;
}

export interface PhoneChange {
  id: string;
  column: PhoneColumn;
  oldValue: string;
  newValue: string;
  rule: PhoneRule;
}

export interface PhoneFlag {
  id: string;
  column: PhoneColumn;
  reason: PhoneFlagReason;
  /** Shape only, see maskPhoneShape. */
  masked: string;
}

export interface PhoneTally {
  scanned: number;
  /** `<column>:<rule>` -> count, built by tallyKey. */
  rules: Record<string, number>;
  /** `<column>:<reason>` -> count, built by tallyKey. */
  flagged: Record<string, number>;
}

export function newTally(): PhoneTally {
  return { scanned: 0, rules: {}, flagged: {} };
}

/** The single key builder for PhoneTally.rules and PhoneTally.flagged. */
export function tallyKey(column: PhoneColumn, ruleOrReason: PhoneRule | PhoneFlagReason): string {
  return `${column}:${ruleOrReason}`;
}

/** Digits become 9 and letters a, punctuation stays: enough to see the shape of a bad value without printing a number or a name. */
export function maskPhoneShape(raw: string): string {
  return raw.replace(/[0-9]/g, "9").replace(/\p{L}/gu, "a");
}

export function planPhonePage(rows: readonly PersonPhoneRow[], tally: PhoneTally): { changes: PhoneChange[]; flags: PhoneFlag[] } {
  const changes: PhoneChange[] = [];
  const flags: PhoneFlag[] = [];
  for (const row of rows) {
    tally.scanned += 1;
    for (const column of PHONE_COLUMNS) {
      const stored = row[column];
      if (stored === null) continue;
      const result = normalizePhone(stored, { column, source: row.sourceKey, country: row.country });
      if ("flagged" in result) {
        const key = tallyKey(column, result.reason);
        tally.flagged[key] = (tally.flagged[key] ?? 0) + 1;
        flags.push({ id: row.id, column, reason: result.reason, masked: maskPhoneShape(stored) });
        continue;
      }
      const key = tallyKey(column, result.rule);
      tally.rules[key] = (tally.rules[key] ?? 0) + 1;
      if (result.value !== stored) changes.push({ id: row.id, column, oldValue: stored, newValue: result.value, rule: result.rule });
    }
  }
  return { changes, flags };
}

/** Old values keyed by person id then column: the shape stored in the audit row and read back by the revert SQL. */
export function previousValues(changes: readonly PhoneChange[]): Record<string, Partial<Record<PhoneColumn, string>>> {
  const out: Record<string, Partial<Record<PhoneColumn, string>>> = {};
  for (const c of changes) (out[c.id] ??= {})[c.column] = c.oldValue;
  return out;
}
