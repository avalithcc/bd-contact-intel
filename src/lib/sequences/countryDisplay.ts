/** Display helpers for a country code. Client-safe on purpose: no libphonenumber, no country table (the card is a client component). */
/** The flag emoji of an ISO 3166-1 alpha-2 code (two regional indicator symbols). */
export function flagEmoji(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

/** The Spanish name of an ISO region, for display only; falls back to the code. */
export function countryNameEs(iso: string): string {
  return new Intl.DisplayNames(["es"], { type: "region", fallback: "code" }).of(iso) ?? iso;
}
