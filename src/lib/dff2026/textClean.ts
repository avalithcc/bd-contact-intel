/**
 * Control-character stripping + mojibake repair + blank-to-null helper for
 * the Digital Finance Forum 2026 attendee import
 * (scripts/import-dff-2026.ts). The source .xlsx-exported CSV contains
 * embedded NUL bytes (0x00) — Postgres rejects those with `invalid byte
 * sequence for encoding "UTF8"` if a value reaches a write untouched — AND,
 * separately, 4 already-corrupted characters (see `repairMojibake` below).
 * Every field from the file passes through `cleanField` before it's ever
 * compared, planned, or written.
 */

// Strips every C0 control character except tab/newline/carriage-return
// (kept so this can also run over the WHOLE raw file text before csv-parse
// sees it, without breaking line splitting), plus DEL (0x7F). Covers the
// NUL bytes the Excel export embeds and any other stray control character.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_RE, "");
}

/**
 * Repairs 4 already-mangled characters (verified upstream, owner report
 * 2026-09-30, from the real dry run against prod): the file is valid UTF-8,
 * but its CONTENT was corrupted before it got here — text originally
 * encoded CP850 was read as CP437 and re-saved as UTF-8. Every OTHER accent
 * in the file (í á ó é ñ É Ñ ü ú Ó Ü) is intact; only these 4 code points
 * are affected. Mapping is the verified reverse (CP437 glyph that arrived
 * -> the character the original CP850 byte actually represents):
 *
 *   "╡" U+2561 (340x) -> "Á"  e.g. "Jefe De ╡rea" -> "Jefe De Área"
 *   "α" U+03B1 (16x)  -> "Ó"  e.g. "FUNDACIαN"     -> "FUNDACIÓN"
 *   "╓" U+2553 (7x)   -> "Í"  e.g. "ENERG╓A"       -> "ENERGÍA"
 *   "╖" U+2556 (13x)  -> "Á"  e.g. "Gerente De ╖rea" -> "Gerente De Área"
 *
 * The 4th mapping is deliberately NOT the faithful CP850 byte: "╖" faithfully
 * decodes to "À", but every one of its 13 occurrences is the same job title
 * that appears correctly 340 times as "╡rea" -> "Área" — mapping "╖" to "Á"
 * (not "À") avoids shipping those 13 rows with a visible, inconsistent typo.
 *
 * Scoped to THIS import's text cleaning only (not a general-purpose/shared
 * encoding fixer) — applying it to every field (names, company, job titles,
 * even email/phone, where these 4 code points can never legitimately occur
 * anyway) is simplest and safe via `cleanField` below.
 */
const MOJIBAKE_MAP: Record<string, string> = {
  "╡": "Á", // "╡"
  "α": "Ó", // "α"
  "╓": "Í", // "╓"
  "╖": "Á", // "╖" — faithful byte is "À"; normalized to "Á", see above
};
const MOJIBAKE_RE = /[╡α╓╖]/g;

export function repairMojibake(value: string): string {
  return value.replace(MOJIBAKE_RE, (ch) => MOJIBAKE_MAP[ch] ?? ch);
}

/** Strips control characters, repairs known mojibake, trims, and collapses
 * an empty result to `null` — the one blank-to-null rule every field in
 * this import uses. */
export function cleanField(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const cleaned = repairMojibake(stripControlChars(raw)).trim();
  return cleaned ? cleaned : null;
}
