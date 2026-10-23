/**
 * Source-level guard, NOT a render test: the page is an async Server Component
 * behind requireAdmin and the DB, so it cannot be rendered in a unit test, and a
 * source regex is the strongest check reachable here. It proves the text is
 * arranged right, not that the browser streams the skeleton.
 * Without `key={selectedId}` the detail Suspense boundary does not re-suspend
 * on selection change, and without `scroll={false}` Next jumps to the top.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync("src/app/(app)/admin/duplicates/page.tsx", "utf8");

test("the detail Suspense boundary is keyed by the selection", () => {
  assert.match(src, /<Suspense\s+key=\{selectedId[^}]*\}\s+fallback=\{<DetailSkeleton \/>\}>/);
});

test("the queue candidate link does not scroll to top", () => {
  assert.match(src, /href=\{`\/admin\/duplicates\?candidate=\$\{item\.id\}`\}\s+scroll=\{false\}/);
});

// Without this, moving the detail await back into the page body keeps the markup and re-blocks the page.
test("only DetailPane fetches the detail; the page body does not", () => {
  const callSites = [...src.matchAll(/getDuplicateCandidateDetail\(/g)].map((m) => m.index as number);
  assert.equal(callSites.length, 1);
  const paneStart = src.indexOf("async function DetailPane");
  const pageStart = src.indexOf("export default async function DuplicatesAdminPage");
  assert.ok(paneStart >= 0 && pageStart > paneStart);
  const paneEnd = src.indexOf("\nfunction ", paneStart);
  assert.ok(callSites[0] > paneStart && callSites[0] < paneEnd, "the call must sit inside DetailPane");
});
