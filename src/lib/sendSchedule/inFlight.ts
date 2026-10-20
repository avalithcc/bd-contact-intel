/** What a send control is doing right now. `null` is idle. */
export type InFlightKind = "send" | "schedule";

/**
 * One-at-a-time guard for a send control's server call. `run` ignores a second call while one is in flight (a repeated click
 * must not send twice), reports every change to `onChange` and always settles back to idle, whether the work resolves,
 * returns a failure or throws. Plain TypeScript so the rules are testable without a DOM.
 */
export function createInFlight(onChange: (kind: InFlightKind | null) => void) {
  let current: InFlightKind | null = null;
  return {
    get current(): InFlightKind | null {
      return current;
    },
    async run<T>(kind: InFlightKind, work: () => Promise<T> | T): Promise<T | undefined> {
      if (current) return undefined;
      current = kind;
      onChange(kind);
      try {
        return await work();
      } finally {
        current = null;
        onChange(null);
      }
    },
  };
}
