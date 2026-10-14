/**
 * Cache key for a /admin/reports drill-down list. It must cover EVERYTHING the
 * fetch depends on (population/kind, period, BD filter): the client hook keeps
 * fetched rows only while this key is unchanged, so a missing input would
 * replay another filter's rows. JSON encoding keeps fields unambiguous and
 * distinguishes null (absent) from a set value.
 */
export interface DrilldownKeyParts {
  kind: string;
  fromIso?: string | null;
  toIso?: string | null;
  bdId: string | null;
}

export function drilldownCacheKey({ kind, fromIso = null, toIso = null, bdId }: DrilldownKeyParts): string {
  return JSON.stringify([kind, fromIso, toIso, bdId]);
}
