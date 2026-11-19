import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd } from "@/db/schema";
import { readAdminBdIds } from "@/lib/identity/ownerBackfillRun";
import { consumeSignals } from "@/lib/prospecting/consumer";
import { produceHiringSignals } from "@/lib/prospecting/producer";
import { AUTO_PROSPECTING_RUN_ACTION, type CronDeps } from "@/lib/prospecting/cronRun";

/** The real wiring for runAutoProspectingCron. Separate from cronRun.ts so that module stays loadable without a database. */
export const realDeps: CronDeps = {
  clock: Date.now,
  anyBdEnabled: async () => {
    const [row] = await db.select({ id: bd.id }).from(bd).where(eq(bd.autoProspectingEnabled, true)).limit(1);
    return !!row;
  },
  readAdminBdIds: () => readAdminBdIds(db),
  produce: (actor) => produceHiringSignals(actor, { execute: true }),
  consume: (o) => consumeSignals({ execute: true, ...o }),
  audit: async (actorBdId, metadata) => {
    await db.insert(auditLog).values({ actorBdId, action: AUTO_PROSPECTING_RUN_ACTION, metadata });
  },
};
