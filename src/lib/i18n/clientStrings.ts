/**
 * Compile-time guard for dictionary slices passed to client ("use client")
 * components (D10, tasks.md 8.4).
 *
 * Only plain strings — or flat records of plain strings, like
 * `Dictionary["leadStatuses"]` — may cross the server -> client boundary.
 * The full `Dictionary` also contains formatter functions (e.g.
 * `dict.home.searchChip`), which React cannot serialize as a prop; passing
 * one directly to a client component caused two production crashes.
 *
 * Wrap any client-bound label type in `ClientStrings<T>` so that adding a
 * formatter function to the picked slice becomes a compile error (the type
 * alias fails to satisfy the constraint) instead of a runtime crash:
 *
 * ```ts
 * export type GenerateMessageLabels = ClientStrings<
 *   Pick<Dictionary["outreach"], "generateMessage" | "copyMessage">
 * >;
 * ```
 */
export type ClientStrings<T extends Record<string, string | Record<string, string>>> = T;

/**
 * Runtime counterpart to `ClientStrings<T>` (tasks.md 8.5). The compile-time
 * type check can be bypassed with `as`/`any`, so this walks an actual
 * dictionary slice and throws if it finds anything other than a string or a
 * flat record of strings — the same shape `ClientStrings<T>` allows.
 */
export function assertClientStrings(value: unknown, path = "$"): void {
  if (typeof value === "string") return;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      assertClientStrings(nested, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(
    `ClientStrings violation at "${path}": expected a string or a nested record of strings, got ${typeof value}`,
  );
}
