/**
 * `<Link>` prefetches its target in production (every link in the viewport, again after each router.refresh). A route
 * handler is not a page: prefetching it RUNS it. /contacts/export is a 5,000-row CSV query, so a `<Link>` to it ran that
 * query in the background on every /contacts render and every live-update refresh (2026-10-20: it timed out at 25 s next to
 * a refresh of /scheduled). A download link must be a plain `<a>`, never a `<Link>`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("no <Link> points at a route handler that runs a query (the contacts export)", () => {
  const source = readFileSync("src/app/(app)/contacts/page.tsx", "utf8");
  assert.doesNotMatch(source, /<Link[^>]*href=\{toolbarExportHref\(\)\}/);
  assert.doesNotMatch(source, /<Link[^>]*href=["'`]\/contacts\/export/);
});
