/**
 * Processes the board-discovery backlog locally, without a serverless time
 * budget. The weekly cron (src/app/api/hiring/discover/route.ts) probes a
 * small batch per run so it fits inside the function limit; that pace is
 * fine for companies added from here on, but not for the initial backlog of
 * every company already present in the contact bases.
 *
 * Runs the same `runDiscovery` worker in a loop until a pass probes nothing,
 * so results are identical to what the cron would eventually produce.
 *
 * Usage: npx tsx scripts/discover-backlog.ts [batchSize] [maxBatches]
 */
import { runDiscovery } from "@/lib/hiring/discovery";

async function main() {
  const batchSize = Number(process.argv[2] ?? 100);
  const maxBatches = Number(process.argv[3] ?? 1000);

  let totalProbed = 0;
  let totalHits = 0;

  for (let batch = 1; batch <= maxBatches; batch++) {
    const result = await runDiscovery({
      limit: batchSize,
      // No serverless deadline here: let each batch finish.
      maxDurationMs: 60 * 60 * 1000,
    });
    totalProbed += result.companiesProbed;
    totalHits += result.hits;
    console.log(
      `batch ${batch}: probed ${result.companiesProbed}, hits ${result.hits} ` +
        `(total probed ${totalProbed}, total hits ${totalHits})`,
    );
    // A failed run reports zero progress, which is indistinguishable from
    // "backlog is empty" unless the status is checked — stop loudly instead.
    if (result.status === "error") {
      console.error(`Discovery run failed: ${result.error}`);
      process.exit(1);
    }
    if (result.companiesProbed === 0) break;
  }

  console.log(`Done. Probed ${totalProbed} companies, found ${totalHits} boards.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
