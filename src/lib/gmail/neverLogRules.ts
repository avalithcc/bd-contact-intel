/**
 * Pure helpers for the per-BD "never log" list — split out from
 * src/lib/gmail/neverLog.ts (which imports `@/db`) so this stays importable
 * from a unit test with no DATABASE_URL, same pattern as
 * src/lib/status/deriveStatus.ts vs. recompute.ts.
 */
export type NeverLogKind = "address" | "domain";

/** Lowercases/trims an address, or strips a leading "@" and lowercases a domain. */
export function normalizeNeverLogValue(kind: NeverLogKind, rawValue: string): string {
  const trimmed = rawValue.trim().toLowerCase();
  return kind === "domain" ? trimmed.replace(/^@/, "") : trimmed;
}
