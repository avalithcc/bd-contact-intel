/**
 * Parity check for getDuplicateCandidateDetail (perf/duplicates-detail-waves).
 * READ-ONLY: the function under test only runs SELECTs, and this script opens
 * no transaction of its own.
 *
 * Loads a baseline captured from the OLD implementation (a JSON object mapping
 * candidate id -> the full result serialized with JSON.stringify), calls the
 * current function for every id, round-trips the result through JSON the same
 * way, and deep-compares. Prints every differing path and exits 1 on any
 * difference, on a baseline id that no longer resolves, or on an empty baseline.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/duplicates-detail-parity.ts <baseline.json>
 */
import { readFileSync } from "node:fs";
import { getDuplicateCandidateDetail } from "../src/lib/identity/duplicateReviewQueries";

export function diffPaths(a: unknown, b: unknown, path = "$"): string[] {
  if (Object.is(a, b)) return [];
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return [`${path}: baseline=${JSON.stringify(a)} new=${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) !== Array.isArray(b)) return [`${path}: array vs non-array`];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`));
}

async function main(): Promise<number> {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: duplicates-detail-parity.ts <baseline.json>");
    return 1;
  }
  const baseline = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const ids = Object.keys(baseline);
  if (ids.length === 0) {
    console.error("empty baseline: nothing to compare");
    return 1;
  }

  let failures = 0;
  for (const id of ids) {
    const fresh = await getDuplicateCandidateDetail(id);
    const diffs = diffPaths(baseline[id], JSON.parse(JSON.stringify(fresh)));
    if (diffs.length === 0) {
      console.log(`OK    ${id}`);
    } else {
      failures++;
      console.log(`DIFF  ${id}`);
      for (const d of diffs) console.log(`        ${d}`);
    }
  }
  console.log(`\n${ids.length - failures}/${ids.length} identical`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
