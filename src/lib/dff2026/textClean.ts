/**
 * Control-character stripping + blank-to-null helper for the Digital Finance
 * Forum 2026 attendee import (scripts/import-dff-2026.ts). The source
 * .xlsx-exported CSV contains embedded NUL bytes (0x00) — Postgres rejects
 * those with `invalid byte sequence for encoding "UTF8"` if a value reaches
 * a write untouched, so every field from the file passes through here
 * before it's ever compared, planned, or written.
 */

// Strips every C0 control character except tab/newline/carriage-return
// (kept so this can also run over the WHOLE raw file text before csv-parse
// sees it, without breaking line splitting), plus DEL (0x7F). Covers the
// NUL bytes the Excel export embeds and any other stray control character.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_RE, "");
}

/** Strips control characters, trims, and collapses an empty result to
 * `null` — the one blank-to-null rule every field in this import uses. */
export function cleanField(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const cleaned = stripControlChars(raw).trim();
  return cleaned ? cleaned : null;
}
