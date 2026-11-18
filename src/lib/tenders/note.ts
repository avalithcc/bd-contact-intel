export const MAX_NOTE_CHARS = 5000;

/** Blank means "no note"; otherwise the stored value is trimmed and bounded. Pure, so the form and the server share it. */
export function normalizeNote(raw: string): string | null {
  const t = raw.trim().slice(0, MAX_NOTE_CHARS);
  return t === "" ? null : t;
}
