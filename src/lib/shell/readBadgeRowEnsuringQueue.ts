/**
 * F5 (launch-readiness pass): the Seguimientos badge counted only queue rows
 * that already existed, and the queue was built only by visiting /follow-ups,
 * so the badge was blank every morning until Mariel opened that page.
 *
 * The shell now builds today's queue the first time it sees a BD on a given
 * day: the badge query returns a cheap `queue_built` scalar (an `exists` on
 * today's rows); only when it is false do we call the existing, race-safe
 * `ensureTodayFollowUpQueue` (advisory lock + ON CONFLICT DO NOTHING, so it
 * cannot collide with a concurrent /follow-ups build) and re-read.
 *
 * Why not compute the badge straight from the candidate query instead: that
 * is a full `activity` aggregate over ~26,600 persons on EVERY navigation,
 * which is exactly what PERFORMANCE.md warns against. This costs one extra
 * `exists` per page render and the build itself once per BD per day.
 *
 * BEHAVIOUR CHANGE: the day's queue now freezes at the first page load of the
 * day (any page), not at the first /follow-ups visit. It reflects the morning
 * state rather than whenever she happened to open Seguimientos.
 *
 * `attempted` memoizes (bd, day) per server instance: a BD with nothing due
 * leaves `queue_built` false forever (zero rows were inserted), and without
 * the memo every navigation would re-run the build transaction. The key is
 * recorded BEFORE the attempt, so a failing build is not retried on every
 * page either; /follow-ups still builds on its own.
 *
 * A build failure must never break every page: it is swallowed and the first
 * read (badge 0) is returned. Dependencies are injected so this stays
 * importable without `@/db`.
 */
export async function readBadgeRowEnsuringQueue<Row extends { queue_built: boolean }>({
  read,
  ensure,
  attemptKey,
  attempted,
}: {
  read: () => Promise<Row>;
  ensure: () => Promise<void>;
  attemptKey: string;
  attempted: Set<string>;
}): Promise<Row> {
  const first = await read();
  if (first.queue_built || attempted.has(attemptKey)) return first;
  attempted.add(attemptKey);
  try {
    await ensure();
  } catch {
    return first;
  }
  return read();
}
