/**
 * Owner-run, READ-ONLY dump of the won-companies drilldown, exactly as the
 * app produces it (`getWonCompaniesDrilldown({ bdId: null })`).
 *
 * That query coalesces `activity.created_at` (naive until slice 5) with
 * `company.updated_at` (timestamptz after slice 4), so Postgres casts the
 * naive side with the session TimeZone. Run this before and after the slice 4
 * ALTER (and again around slice 5, which makes both sides timestamptz) and
 * diff the output: the dumps must be IDENTICAL, including the rows with
 * `wonAtExact === true`.
 *
 * Output is deterministic JSON: rows sorted by companyKey (the SQL orders by
 * won_at, which can tie), `wonAt` as ISO-8601 UTC. Only SELECTs run.
 *
 * Usage (owner-run, requires DATABASE_URL):
 *
 *   TZ=UTC npx tsx scripts/dump-won-drilldown.ts > before.json
 *   # ... apply the migration ...
 *   TZ=UTC npx tsx scripts/dump-won-drilldown.ts > after.json
 *   diff before.json after.json   # expect: no output
 */
import { getWonCompaniesDrilldown } from "../src/lib/reports/queriesDb";

async function main() {
  if (process.env.TZ !== "UTC") {
    throw new Error("Refusing to run: set TZ=UTC so both dumps share the same process timezone.");
  }
  const rows = await getWonCompaniesDrilldown({ bdId: null });
  const sorted = [...rows]
    .sort((a, b) => (a.companyKey < b.companyKey ? -1 : a.companyKey > b.companyKey ? 1 : 0))
    .map((r) => ({ ...r, wonAt: r.wonAt.toISOString() }));
  console.log(JSON.stringify({ count: sorted.length, exact: sorted.filter((r) => r.wonAtExact).length, rows: sorted }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
