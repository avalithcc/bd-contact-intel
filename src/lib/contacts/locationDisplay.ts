/**
 * Pure composer for the record page's single "Ubicación" row (mockup-port
 * fix; contact-record.html:86 — "Buenos Aires, Argentina", composed from
 * `city`+`country`; the mockup never shows `region`). `city`/`region`/
 * `country` stay independently editable columns with their own audit
 * history (planPropertyEdit, propertyEdit.ts) — this module only decides
 * what the collapsed, read-only text looks like.
 */
function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `null` when both parts are missing — the caller renders the usual empty-value dash. */
export function composeLocation(city: string | null, country: string | null): string | null {
  const parts = [clean(city), clean(country)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}
