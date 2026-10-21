/**
 * Tiny in-process, single-value TTL cache for slow-changing reference reads
 * (dropdown options and the like). Module-level state means ONE copy per
 * serverless instance, so the worst case is one load per instance per TTL.
 *
 * Contract, because a cache in a CRM is a staleness decision:
 *  - Only for data that is the same for every viewer and that no BD edits and
 *    expects to see on the next click. Never viewer-scoped or per-BD data.
 *  - Concurrent callers share ONE in-flight load (no stampede).
 *  - A failed load is never stored; every caller waiting on it sees the error
 *    and the next call retries.
 *  - Each caller gets its own structuredClone, so a caller that sorts or
 *    pushes into the result cannot corrupt what the next caller sees.
 */
export interface TtlCache<T> {
  get(): Promise<T>;
  clear(): void;
}

export function createTtlCache<T>(
  load: () => Promise<T>,
  opts: { ttlMs: number; now?: () => number },
): TtlCache<T> {
  const now = opts.now ?? Date.now;
  let value: { data: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;
  // Bumped by clear() so a load that started before it cannot store its result.
  let generation = 0;

  return {
    async get() {
      if (value && now() < value.expiresAt) return structuredClone(value.data);
      if (!inFlight) {
        const startedIn = generation;
        const p = load().then(
          (data) => {
            if (startedIn === generation) {
              value = { data, expiresAt: now() + opts.ttlMs };
              inFlight = null;
            }
            return data;
          },
          (err) => {
            if (startedIn === generation) inFlight = null;
            throw err;
          },
        );
        inFlight = p;
      }
      return structuredClone(await inFlight);
    },
    clear() {
      generation++;
      value = null;
      inFlight = null;
    },
  };
}
