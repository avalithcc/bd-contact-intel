/**
 * DRY RUN of the duplicates re-scan against the real database. WRITES NOTHING.
 *
 * Why it exists: the re-scan's write path (jsonb_to_recordset join,
 * onConflictDoNothing().returning()) has no DB test, because the scratch database
 * is stuck at migration 0057. This runs the REAL code with dryRun: true, which
 * returns before opening any transaction (duplicateRescanRun.ts:103), so it
 * exercises both reads and the planner against production data and proves the SQL
 * works before the change is merged.
 *
 * The number to check is that the arithmetic closes:
 *   found == planned + remaining + sum(skipped)
 * and that the two already-closed pairs show up as skipped rather than vanishing.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/duplicates-rescan-dry-run.ts
 */
import { db } from "../src/db";
import { runDuplicateRescan } from "../src/lib/identity/duplicateRescanRun";

async function main() {
  const report = await runDuplicateRescan(db, { dryRun: true, trigger: "manual", actorBdId: "", cap: 50 });
  console.log(JSON.stringify(report, null, 2));

  const skipped = Object.values(report.skipped as Record<string, number>).reduce((a, b) => a + b, 0);
  const sum = report.planned + (report.remaining ?? 0) + skipped;
  console.log(`\n--- the check ---`);
  console.log(`found                 ${report.found}`);
  console.log(`planned               ${report.planned}`);
  console.log(`remaining (cap)       ${report.remaining ?? 0}`);
  console.log(`skipped (all reasons) ${skipped}`);
  console.log(`planned+remaining+skipped = ${sum}  ${sum === report.found ? "== found  OK" : `!= found (${report.found})  ARITHMETIC BROKEN`}`);
  const closed = (report.skipped as Record<string, number>).existing_merged + (report.skipped as Record<string, number>).existing_not_duplicate;
  console.log(`already-closed pairs skipped: ${closed}  ${closed === 2 ? "(expected 2)  OK" : "(expected 2)  CHECK"}`);
  console.log(`wrote anything?       ${report.created === 0 && report.dryRun ? "NO — dry run" : "YES — NOT A DRY RUN"}`);
  process.exit(sum === report.found ? 0 : 1);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
