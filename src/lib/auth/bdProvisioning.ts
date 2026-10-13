/**
 * Whether `getCurrentBd` (src/lib/queries.ts) may insert a `bd` row on a
 * session's first visit.
 *
 * Why this exists: the read-only e2e guard (tests/e2e/fixtures.ts) works at
 * the request level, and the first-visit insert happens during a plain GET
 * render, which that guard cannot see. So the guard marks every request it
 * lets through with READ_ONLY_MARKER_HEADER, and the render path refuses to
 * insert when it sees the marker.
 *
 * Production safety: when NODE_ENV is "production" the marker is ignored
 * outright. A real BD's first visit therefore always provisions their row,
 * even if someone sends the header by hand. Only a non-production server (a
 * dev server the e2e suite drives) honors it. Without the marker the answer
 * is always "yes", which is the behavior before this module existed.
 *
 * Pure, no framework imports: the producer (the Playwright fixture) and the
 * reader (getCurrentBd) share these exports, and
 * tests/unit/e2eBdProvisioning.test.ts builds its fixtures from them.
 */
export const READ_ONLY_MARKER_HEADER = "x-e2e-read-only";
const READ_ONLY_MARKER_VALUE = "1";

/** Copy of `headers` carrying the read-only marker. Never mutates the input. */
export function withReadOnlyMarker(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== READ_ONLY_MARKER_HEADER) out[name] = value;
  }
  out[READ_ONLY_MARKER_HEADER] = READ_ONLY_MARKER_VALUE;
  return out;
}

export function mayProvisionBd(
  requestHeaders: { get(name: string): string | null },
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv === "production") return true;
  return requestHeaders.get(READ_ONLY_MARKER_HEADER) !== READ_ONLY_MARKER_VALUE;
}
