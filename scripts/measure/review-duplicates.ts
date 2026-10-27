/**
 * Read-only review dump of the whole open /admin/duplicates queue, so the
 * `review`-tier pairs (the ones scripts/merge-duplicates.ts never touches)
 * can be grouped by rule and decided in batches instead of one by one.
 *
 * The population comes from the application's own bulk read
 * (loadOpenDuplicatePairsForTiering) and the bucket/tier from the same pure
 * classifier the bulk script uses (classifyDuplicatePairBucket /
 * tierForBucket / findChainedPersonIds): nothing here re-derives which pairs
 * are open or how they are classified. The extra per-person columns
 * (company, city, country, status, counts) are descriptive only.
 *
 * Prints one JSON document on stdout. Names and emails stay local: do not
 * paste this output into a PR body or any shared artifact.
 *
 * GUARD SCOPE (README rule 1): `set session characteristics` applies to ONE
 * Postgres connection, and `src/db/index.ts` holds a pool of up to 5. Every
 * read this file issues is therefore sequential, so they all run on the
 * connection the guard was set and verified on. `loadOpenDuplicatePairsForTiering`
 * still fans out internally, so a second, unguarded connection can serve part
 * of that call — the guarantee there is that neither it nor anything else here
 * issues a write statement at all.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, duplicateCandidate, person } from "@/db/schema";
import { loadOpenDuplicatePairsForTiering } from "@/lib/identity/duplicateBulkQueries";
import {
  classifyDuplicatePairBucket,
  findChainedPersonIds,
  isPairChained,
  tierForBucket,
} from "@/lib/identity/duplicateTiering";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.error(`read_only: ${JSON.stringify(guard[0] ?? guard)} (this connection; see GUARD SCOPE above)`);

  const pairs = await loadOpenDuplicatePairsForTiering();
  const personIds = [...new Set(pairs.flatMap((p) => [p.personA.id, p.personB.id]))];

  // The loader drops a pair whose person row is missing, so the dump can be
  // SHORTER than the queue it claims to show. Print both numbers rather than
  // letting a silent gap pass as the whole queue.
  const [{ n: openRows }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(duplicateCandidate)
    .where(eq(duplicateCandidate.status, "open"))) as unknown as { n: number }[];
  console.error(`open duplicate_candidate rows: ${openRows} | pairs dumped: ${pairs.length}`);
  if (Number(openRows) !== pairs.length) {
    console.error(`WARNING: ${Number(openRows) - pairs.length} open pair(s) were dropped by the loader (missing person row).`);
  }

  const rows = await db
    .select({
      id: person.id,
      company: person.company,
      companyKey: person.companyKey,
      city: person.city,
      country: person.country,
      status: person.status,
      sourceKey: person.sourceKey,
      createdAt: person.createdAt,
      activities: sql<number>`(select count(*)::int from activity a where a.person_id = ${person.id})`,
      tasks: sql<number>`(select count(*)::int from task t where t.person_id = ${person.id})`,
      messages: sql<number>`(select count(*)::int from email_message_person m where m.person_id = ${person.id})`,
    })
    .from(person)
    .where(inArray(person.id, personIds));
  const bdRows = await db.select({ id: bd.id, name: bd.name }).from(bd);

  const extraById = new Map(rows.map((r) => [r.id, r]));
  const bdNameById = new Map(bdRows.map((r) => [r.id, r.name]));
  const chained = findChainedPersonIds(
    pairs.map((p) => ({ candidateId: p.candidateId, personAId: p.personA.id, personBId: p.personB.id })),
  );

  const side = (p: (typeof pairs)[number]["personA"]) => {
    const extra = extraById.get(p.id);
    return {
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "(sin nombre)",
      jobTitle: p.jobTitle,
      email: p.email,
      emailStatus: p.emailStatus,
      hasProfileKey: p.profileKey !== null,
      profileKey: p.profileKey,
      company: extra?.company ?? null,
      companyKey: extra?.companyKey ?? null,
      city: extra?.city ?? null,
      country: extra?.country ?? null,
      status: extra?.status ?? null,
      sourceKey: extra?.sourceKey ?? null,
      owner: p.ownerBdId ? (bdNameById.get(p.ownerBdId) ?? p.ownerBdId) : null,
      createdAt: p.createdAt,
      connections: p.connections.length,
      activities: Number(extra?.activities ?? 0),
      tasks: Number(extra?.tasks ?? 0),
      messages: Number(extra?.messages ?? 0),
    };
  };

  const out = pairs.map((p) => {
    const bucket = classifyDuplicatePairBucket(p.personA, p.personB);
    return {
      candidateId: p.candidateId,
      reason: p.reason,
      bucket,
      tier: tierForBucket(bucket),
      chained: isPairChained(
        { candidateId: p.candidateId, personAId: p.personA.id, personBId: p.personB.id },
        chained,
      ),
      a: side(p.personA),
      b: side(p.personB),
    };
  });

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

void main();
