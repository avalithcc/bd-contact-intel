/**
 * Generic "latest request wins" guard (fix/timeline-filter-no-reload,
 * follow-up review WARNING): a component that fires more than one async
 * request over its lifetime — Timeline.tsx's scoped pill fetch
 * (`fetchScope`) — can be superseded either by a NEWER fetch (a different
 * pill clicked before the first one resolves) or by a background data
 * refresh (`router.refresh()`, which invalidates every in-flight fetch's
 * result since the pool it would apply to just changed underneath it).
 * Either way, a resolving promise must be able to tell it is no longer the
 * latest before it is allowed to touch any shared state (cache, active
 * scope, pending indicator).
 *
 * The whole decision is one monotonically increasing counter — bumped at
 * every point that supersedes whatever came before (a pill click, a fresh
 * server-props arrival) — plus this pure comparison: a request's own
 * generation (captured the instant it started) must still equal the
 * CURRENT generation at the moment it resolves. No DB/React import, so this
 * stays independently unit-testable, same convention as
 * @/lib/activity/timelinePills.
 */
export function isRequestCurrent(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}
