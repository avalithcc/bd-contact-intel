/**
 * The content version of a draft: what a reader was looking at. `editedAt` alone is not enough, because a regenerate
 * resets it to null, so two regenerations in a row would look identical; `generatedAt` moves on every regenerate and
 * `editedAt` on every save-edit. Millisecond integers, so the SQL side (approvalQueries) compares exactly what a JS Date holds.
 */
export type DraftVersionParts = { generatedMs: number; editedMs: number };

export function draftVersion(generatedAt: Date, editedAt: Date | null): string {
  return `${generatedAt.getTime()}:${editedAt ? editedAt.getTime() : 0}`;
}

/** Null for anything the producer above could not have made. */
export function parseDraftVersion(version: unknown): DraftVersionParts | null {
  if (typeof version !== "string") return null;
  const m = /^(\d+):(\d+)$/.exec(version);
  if (!m) return null;
  const parts = { generatedMs: Number(m[1]), editedMs: Number(m[2]) };
  // Beyond 2^53 the digits no longer round-trip, and Postgres would throw on the comparison instead of answering `stale`.
  return Number.isSafeInteger(parts.generatedMs) && Number.isSafeInteger(parts.editedMs) ? parts : null;
}
