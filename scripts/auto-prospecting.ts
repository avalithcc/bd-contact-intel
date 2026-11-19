/**
 * Auto-prospecting run: writes `hiring` signals, then drafts one message per unconsumed signal. It NEVER sends.
 *
 * DRY RUN is the default: the producer statement runs and is rolled back, the consumer plans without calling the model or writing,
 * and only COUNTS are printed. Nothing is drafted for a BD whose `auto_prospecting_enabled` is false (it is false for everyone).
 *
 *   npx tsx --env-file=.env.local scripts/auto-prospecting.ts
 *   npx tsx --env-file=.env.local scripts/auto-prospecting.ts --execute --actor=<admin bd email>
 *
 * `--execute` needs `--actor` because the signals batch writes one audit_log row (its metadata lists the signal ids to revert).
 * Revert: delete from signal where id in (<audit_log.metadata.signalIds>); drafts cascade. Read the result at /admin/auto-prospecting.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bd } from "@/db/schema";
import { produceHiringSignals } from "@/lib/prospecting/producer";
import { consumeSignals } from "@/lib/prospecting/consumer";

async function main() {
  const execute = process.argv.includes("--execute");
  const actorEmail = process.argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length);
  let actorId = "";
  if (execute) {
    if (!actorEmail) throw new Error("--execute requires --actor=<admin bd email>");
    const [actor] = await db.select({ id: bd.id, role: bd.role }).from(bd).where(eq(bd.email, actorEmail));
    if (!actor || actor.role !== "admin") throw new Error("--actor must be an existing admin BD");
    actorId = actor.id;
  }

  const signals = await produceHiringSignals(actorId, { execute });
  const summary = await consumeSignals({ execute });
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", signalsProduced: signals.length, ...summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
