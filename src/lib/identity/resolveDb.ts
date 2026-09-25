/**
 * Thin DB layer for the live-ingestion identity resolver (design.md D11-D14;
 * contact-identity spec "Live ingestion resolves identity at write time").
 * `prefetchIdentityIndex`, `withIdentityLock` and `applyIdentityWrites` touch
 * the database and are intentionally thin, delegating all real logic to the
 * pure helpers in ./resolve.ts (`buildPrefetchKeys`, `buildIdentityWriteRows`)
 * — importing `db` (as opposed to `@/db/schema`, which has no side effects)
 * throws without DATABASE_URL, so these functions can't be unit-tested the
 * way ./resolve.ts is; this mirrors src/lib/migration/queries.ts's split
 * between pure planners/write-row builders and thin DB wrappers.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { duplicateCandidate, person, personBdConnection, personIdMap } from "@/db/schema";
import type { EmailStatus } from "@/lib/identity/matcher";
import {
  buildIdentityWriteRows,
  buildPrefetchKeys,
  IDENTITY_LOCK_KEY,
  type ExistingPersonCandidate,
  type IdentityIngestRow,
  type IdentityWritePlan,
} from "@/lib/identity/resolve";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toCandidate(r: typeof person.$inferSelect): ExistingPersonCandidate {
  return {
    id: r.id,
    profileKey: r.profileKey,
    firstName: r.firstName,
    lastName: r.lastName,
    companyKey: r.companyKey,
    jobTitle: r.jobTitle,
    industry: r.industry,
    email: r.email,
    emailNormalized: r.emailNormalized,
    emailStatus: r.emailStatus as EmailStatus,
    emailConfidence: r.emailConfidence,
    emailSource: r.emailSource,
  };
}

/**
 * 3 indexed queries (design D13) — never loads all persons. Profile key and
 * verified-email lookups only ever match live, non-merged persons; the
 * company-key lookup is narrowed by the DB index and then filtered app-side
 * against each row's exact name+company key (the name index is on raw, not
 * accent-folded, names — same reasoning as foldPlanner.ts).
 */
export async function prefetchIdentityIndex(
  tx: DbTransaction,
  rows: readonly IdentityIngestRow[],
): Promise<ExistingPersonCandidate[]> {
  const { profileKeys, verifiedEmails, companyKeys } = buildPrefetchKeys(rows);
  const byId = new Map<string, ExistingPersonCandidate>();

  const [byProfile, byEmail, byCompany] = await Promise.all([
    profileKeys.length
      ? tx.select().from(person).where(and(inArray(person.profileKey, profileKeys), isNull(person.mergedIntoId)))
      : Promise.resolve([]),
    verifiedEmails.length
      ? tx
          .select()
          .from(person)
          .where(
            and(
              inArray(person.emailNormalized, verifiedEmails),
              eq(person.emailStatus, "verified"),
              isNull(person.mergedIntoId),
            ),
          )
      : Promise.resolve([]),
    companyKeys.length
      ? tx.select().from(person).where(and(inArray(person.companyKey, companyKeys), isNull(person.mergedIntoId)))
      : Promise.resolve([]),
  ]);

  for (const r of [...byProfile, ...byEmail, ...byCompany]) byId.set(r.id, toCandidate(r));
  return [...byId.values()];
}

/**
 * Callers that may CREATE a new person (any chunk containing a "new" or
 * "review" outcome) MUST wrap prefetch+match+write in this lock (design
 * D14) so two concurrent chunks racing to create the same profile key
 * serialize instead of both attempting an insert; the `ON CONFLICT
 * (profile_key) DO NOTHING` below is the second line of defense for the
 * rows that lose that race. Callers that only ever update existing persons
 * (e.g. recomputeMessageSignals) don't need it. Wired into upsertContacts/
 * importLeads in task 4B.3 — not exercised here.
 */
export async function withIdentityLock<T>(tx: DbTransaction, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(${IDENTITY_LOCK_KEY})`);
  return fn();
}

/**
 * Thin DB layer (task 4B.2): batched inserts/updates from a plan already
 * built by planIdentityWrites. Callers are responsible for taking
 * withIdentityLock first when the plan may create persons (see above).
 */
export async function applyIdentityWrites(tx: DbTransaction, plan: IdentityWritePlan): Promise<void> {
  const rows = buildIdentityWriteRows(plan, randomUUID);

  for (const batch of chunk(rows.persons, WRITE_BATCH_SIZE)) {
    if (!batch.length) continue;
    const inserted = await tx
      .insert(person)
      .values(batch)
      .onConflictDoNothing({ target: person.profileKey })
      .returning({ id: person.id, profileKey: person.profileKey });
    const insertedIds = new Set(inserted.map((r) => r.id));
    const losingKeys = batch
      .filter((b) => !insertedIds.has(b.id!) && b.profileKey)
      .map((b) => b.profileKey!);
    if (!losingKeys.length) continue;

    // A concurrent chunk beat us to the same profile key (design D14): the
    // conflict losers never got an id, so re-point their rows' connection
    // and id-map entries at the row that actually persisted.
    const winners = await tx
      .select({ id: person.id, profileKey: person.profileKey })
      .from(person)
      .where(inArray(person.profileKey, losingKeys));
    const winnerByKey = new Map(winners.map((w) => [w.profileKey!, w.id]));
    for (const b of batch) {
      if (!b.profileKey || insertedIds.has(b.id!)) continue;
      const winnerId = winnerByKey.get(b.profileKey);
      if (!winnerId) continue;
      for (const c of rows.connections) if (c.personId === b.id) c.personId = winnerId;
      for (const m of rows.idMap) if (m.personId === b.id) m.personId = winnerId;
    }
  }

  for (const batch of chunk(rows.connections, WRITE_BATCH_SIZE)) {
    if (batch.length) await tx.insert(personBdConnection).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(rows.idMap, WRITE_BATCH_SIZE)) {
    if (batch.length) await tx.insert(personIdMap).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(rows.duplicateCandidates, WRITE_BATCH_SIZE)) {
    if (batch.length) await tx.insert(duplicateCandidate).values(batch).onConflictDoNothing();
  }

  for (const update of rows.existingUpdates) {
    await tx
      .update(person)
      .set({
        firstName: update.merged.firstName,
        lastName: update.merged.lastName,
        companyKey: update.merged.companyKey,
        jobTitle: update.merged.jobTitle,
        industry: update.merged.industry,
        email: update.merged.email,
        emailNormalized: update.merged.emailNormalized,
        emailStatus: update.merged.emailStatus,
        emailConfidence: update.merged.emailConfidence,
        emailSource: update.merged.emailSource,
        updatedAt: new Date(),
      })
      .where(eq(person.id, update.personId));
  }
}
