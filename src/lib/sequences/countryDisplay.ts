/**
 * Display helpers for a country code. No libphonenumber, no country table.
 * `countryNameEs` is used by AudienceBlock, a SERVER component: leave it. Client components must NOT call anything here that
 * uses `Intl.DisplayNames` (hydration would compare two different ICU builds); the picker gets its labels from the server.
 */
/** The flag emoji of an ISO 3166-1 alpha-2 code (two regional indicator symbols). */
export function flagEmoji(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

/** The Spanish name of an ISO region, for display only; falls back to the code. */
export function countryNameEs(iso: string): string {
  return new Intl.DisplayNames(["es"], { type: "region", fallback: "code" }).of(iso) ?? iso;
}

/** `countryLabelEs` for a set of values, keeping only the ones it renames. SERVER ONLY: see CountryCounts.labels. */
export function countryLabelsEs(values: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) {
    const label = countryLabelEs(v);
    if (label !== v) out[v] = label;
  }
  return out;
}

let namesToIso: Map<string, string> | null = null;
/**
 * The Spanish name for a country as the data stores it (English: "United States", "Mexico"), for display only. There is no
 * name table in the repo, so the English names are reversed from `Intl.DisplayNames` once (676 two-letter combinations); a text
 * it does not recognize ("USA", "Atlantis") is shown as stored. Never use the label as a filter value.
 */
export function countryLabelEs(name: string): string {
  if (!namesToIso) {
    const en = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    namesToIso = new Map();
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const iso = String.fromCharCode(a, b);
      try { const n = en.of(iso); if (n && n !== iso) namesToIso.set(n, iso); } catch { /* not a region code */ }
    }
  }
  const iso = namesToIso.get(name);
  return iso ? countryNameEs(iso) : name;
}
