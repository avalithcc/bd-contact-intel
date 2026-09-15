/**
 * Pure, DB-free helper for turning a flat list of (name, count) rows into a
 * top-N slice, sorted by count descending with a stable name tie-break.
 *
 * Extracted out of src/lib/queries.ts so the bucketing logic used for the
 * role-group / company-category summaries on the home page can be unit
 * tested without pulling in the DB client.
 */
export function bucketTopN<T extends { count: number }>(
  items: T[],
  getName: (item: T) => string,
  limit: number,
): T[] {
  return [...items]
    .sort((a, b) => b.count - a.count || getName(a).localeCompare(getName(b)))
    .slice(0, limit);
}
