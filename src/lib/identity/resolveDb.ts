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
  personIdMapKey,
  repointIdentityWriteRows,
  type ExistingPersonCandidate,
  type IdentityIngestRow,
  type IdentityWritePlan,
} from "@/lib/identity/resolve";
import type { PersonIdLookup } from "@/lib/identity/referenceWrite";
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
    company: r.company,
    ownerBdId: r.ownerBdId,
    city: r.city,
    country: r.country,
  };
}

/**
 * 3 indexed queries (design D13) — never loads all persons. Profile key and
 * verified-email lookups only ever match live, non-merged persons; the
 * company-key lookup is narrowed by the DB index and then filtered app-side
 * against each row's exact name+company key (the name index is on raw, not
 * accent-folded, names — same reasoning as foldPlanner.ts).
 *
 * A 4th query, scoped to `hubspotEmails` (fresh-review CRITICAL fix,
 * contact-identity spec "not-verified-side exact-email review rule"),
 * prefetches existing persons by email regardless of THEIR OWN
 * `emailStatus` too — the `verifiedEmails` query above only ever matches an
 * existing person whose stored email is `verified`, which would silently
 * miss a `probable`-vs-`probable` collision the `email_unverified` rule is
 * specifically meant to catch. `hubspotEmails` is empty for every live
 * ingestion caller (contact/lead rows never populate it — see
 * buildPrefetchKeys), so this query is a no-op outside hubspot_import.
 * Batched via `chunk` (unlike the 3 queries above): a HubSpot export can
 * carry ~9k rows in one call, well past a single `IN (...)` list's
 * practical size.
 */
export async function prefetchIdentityIndex(
  tx: DbTransaction,
  rows: readonly IdentityIngestRow[],
): Promise<ExistingPersonCandidate[]> {
  const { profileKeys, verifiedEmails, companyKeys, hubspotEmails } = buildPrefetchKeys(rows);
  const byId = new Map<string, ExistingPersonCandidate>();

  const [byProfile, byEmail, byCompany, byHubspotEmail] = await Promise.all([
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
    hubspotEmails.length
      ? Promise.all(
          chunk(hubspotEmails, WRITE_BATCH_SIZE).map((batch) =>
            tx
              .select()
              .from(person)
              .where(and(inArray(person.emailNormalized, batch), isNull(person.mergedIntoId))),
          ),
        ).then((pages) => pages.flat())
      : Promise.resolve([]),
  ]);

  for (const r of [...byProfile, ...byEmail, ...byCompany, ...byHubspotEmail]) byId.set(r.id, toCandidate(r));
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
 *
 * Caller contract: callers MUST take this lock, in the SAME transaction,
 * BEFORE calling prefetchIdentityIndex — verified-email dedupe (unlike
 * profile_key) has no unique DB constraint, so nothing else prevents two
 * concurrent chunks from both prefetching a "no match" result for the same
 * verified email and each creating their own person. Enforced by the 4B-2
 * wiring (task 4B.3); this comment only documents the requirement.
 */
export async function withIdentityLock<T>(tx: DbTransaction, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(${IDENTITY_LOCK_KEY})`);
  return fn();
}

/**
 * Thin DB layer (task 4B.2): batched inserts/updates from a plan already
 * built by planIdentityWrites. Callers are responsible for taking
 * withIdentityLock first when the plan may create persons (see above).
 *
 * Person batches are inserted (and their conflict losers collected) BEFORE
 * any dependent row (connections/idMap/duplicateCandidates) is inserted, so
 * a loser id from one batch can never slip into a dependent insert before
 * it's been repointed — see repointIdentityWriteRows in ./resolve.ts.
 *
 * Returns the FINAL, post-conflict-repoint `person_id_map` rows just
 * written, keyed by `${legacyTable}:${legacyId}` (fresh-review CRITICAL
 * fix): `rows.idMap` already resolves every row outcome — including
 * `new`/`review` rows, whose `IdentityWritePlan` only ever carries a
 * plan-local ref like `"np1"` until this function inserts the real row —
 * to the real, persisted `person.id`. Callers that need to write a
 * DEPENDENT row keyed by the same legacy id after this call returns (e.g.
 * hubspot_import's status-evidence activities, keyed by
 * `hubspotLegacyId(hubspotContactId)`) MUST resolve through this map
 * instead of trusting an in-memory plan ref — see
 * src/lib/hubspot/executeWriteRows.ts.
 */
export async function applyIdentityWrites(
  tx: DbTransaction,
  plan: IdentityWritePlan,
): Promise<Map<string, string>> {
  const builtRows = buildIdentityWriteRows(plan, randomUUID);
  const winnerByLoserId = new Map<string, string>();

  for (const batch of chunk(builtRows.persons, WRITE_BATCH_SIZE)) {
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
    // conflict losers never got an id. Record loser -> winner so every
    // dependent row (connections/idMap/duplicateCandidates) across ALL
    // person batches gets repointed once, after every batch has run.
    const winners = await tx
      .select({ id: person.id, profileKey: person.profileKey })
      .from(person)
      .where(inArray(person.profileKey, losingKeys));
    const winnerByKey = new Map(winners.map((w) => [w.profileKey!, w.id]));
    for (const b of batch) {
      if (!b.profileKey || insertedIds.has(b.id!)) continue;
      const winnerId = winnerByKey.get(b.profileKey);
      if (!winnerId) continue;
      winnerByLoserId.set(b.id!, winnerId);
    }
  }

  const rows = repointIdentityWriteRows(builtRows, winnerByLoserId);

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
        company: update.merged.company,
        companyKey: update.merged.companyKey,
        jobTitle: update.merged.jobTitle,
        roleGroup: update.merged.roleGroup,
        industry: update.merged.industry,
        city: update.merged.city,
        country: update.merged.country,
        ownerBdId: update.merged.ownerBdId,
        email: update.merged.email,
        emailNormalized: update.merged.emailNormalized,
        emailStatus: update.merged.emailStatus,
        emailConfidence: update.merged.emailConfidence,
        emailSource: update.merged.emailSource,
        updatedAt: new Date(),
      })
      .where(eq(person.id, update.personId));
  }

  const legacyIdToPersonId = new Map<string, string>();
  for (const row of rows.idMap) {
    if (!row.personId) continue; // skipped_own_company rows have a null personId
    legacyIdToPersonId.set(personIdMapKey(row.legacyTable as IdentityIngestRow["legacyTable"], row.legacyId), row.personId);
  }
  return legacyIdToPersonId;
}

/**
 * Same-statement `person_id` subquery for "reference writes" (design
 * "Reference writes" addendum; task 4B.5/4B.6): activity/task/signal rows
 * never create or lock a person, they only resolve one via `person_id_map`.
 * Resolves to null when a row was created before its legacy row was ever
 * mapped — the catch-up phase (task 4B.7) re-points it later.
 */
export function personIdLookupSql(lookup: PersonIdLookup) {
  return sql<string | null>`(select person_id from person_id_map where legacy_table = ${lookup.legacyTable} and legacy_id = ${lookup.legacyId})`;
}
