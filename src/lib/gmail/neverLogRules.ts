/**
 * Pure helpers for the per-BD "never log" list — split out from
 * src/lib/gmail/neverLog.ts (which imports `@/db`) so this stays importable
 * from a unit test with no DATABASE_URL, same pattern as
 * src/lib/status/deriveStatus.ts vs. recompute.ts.
 *
 * UI copy TODO (fresh-review note, 2026-09-30 — no code change needed, this
 * is a documentation-only reminder for whoever builds the never-log
 * settings screen, slice 5): a `kind: "domain"` rule matches EXACTLY that
 * domain (src/lib/gmail/classify.ts's `isNeverLogged`), not its subdomains —
 * `"prospect.com"` does NOT suppress `mail.prospect.com`. The settings UI
 * copy must say "exact domain" (or similar) so a BD doesn't assume it's a
 * wildcard/suffix match.
 */
export type NeverLogKind = "address" | "domain";

/** Lowercases/trims an address, or strips a leading "@" and lowercases a domain. */
export function normalizeNeverLogValue(kind: NeverLogKind, rawValue: string): string {
  const trimmed = rawValue.trim().toLowerCase();
  return kind === "domain" ? trimmed.replace(/^@/, "") : trimmed;
}

// Deliberately simple — this only needs to reject obvious typos before a row
// reaches classify.ts's exact-match check (isNeverLogged), not validate
// against the full RFC 5322/5890 grammar.
const ADDRESS_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_SHAPE = /^[^\s@]+\.[^\s@]+$/;

export type NeverLogValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: "empty" | "invalid_address" | "invalid_domain" };

/**
 * Validates + normalizes one "Nunca registrar" form submission
 * (email-sync.html:315-319's Tipo/Valor fields) before it reaches
 * `addNeverLogEntry` (neverLog.ts). A `kind: "domain"` value is matched
 * EXACTLY against `email_message`'s sender/recipient domain — never as a
 * suffix/wildcard — so this only accepts a bare domain shape (no `@`), not
 * an address; see this file's own doc comment above for why the settings
 * screen's copy must say so explicitly.
 */
export function validateNeverLogInput(kind: NeverLogKind, rawValue: string): NeverLogValidationResult {
  const trimmed = rawValue.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  const value = normalizeNeverLogValue(kind, trimmed);
  if (kind === "address") {
    return ADDRESS_SHAPE.test(value) ? { ok: true, value } : { ok: false, error: "invalid_address" };
  }
  return DOMAIN_SHAPE.test(value) && !value.includes("@")
    ? { ok: true, value }
    : { ok: false, error: "invalid_domain" };
}
