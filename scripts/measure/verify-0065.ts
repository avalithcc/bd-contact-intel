// Read-only verification that migration 0065 actually landed in production,
// against the catalog rather than drizzle's "applied successfully" message
// (which prints on success even when the journal made it apply nothing).
// Also proves the new selection predicate is a no-op today: every BD's
// deny-list is empty, so the queue selection is provably unchanged.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getFollowUpRoleGroupCounts } from "@/lib/followUp/roleGroupPreferenceDb";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const column = await db.execute(sql`
    select column_name, data_type, udt_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'bd'
      and column_name = 'follow_up_excluded_role_groups'
  `);
  console.log("1. column in catalog:", JSON.stringify(column, null, 2));

  const ledger = await db.execute(sql`select count(*)::int as rows from drizzle.__drizzle_migrations`);
  console.log("2. ledger rows:", JSON.stringify(ledger));

  // Every BD must have the empty default: no backfill was intended.
  const arrays = await db.execute(sql`
    select name, follow_up_excluded_role_groups as excluded,
           cardinality(follow_up_excluded_role_groups)::int as n
    from bd order by name
  `);
  console.log("3. per-BD deny-list:", JSON.stringify(arrays));

  // The predicate excludes a person when their role_group is in their owner's
  // deny-list. If this is 0, the new filter removes nobody today, so the
  // selected set is identical to the pre-change set.
  const wouldExclude = await db.execute(sql`
    select count(*)::int as n
    from person p join bd b on b.id = p.owner_bd_id
    where p.merged_into_id is null
      and p.role_group = any(b.follow_up_excluded_role_groups)
  `);
  console.log("4. contacts the new predicate excludes TODAY:", JSON.stringify(wouldExclude));

  const classification = await db.execute(sql`
    select count(*) filter (where role_group is null)::int as null_role_group,
           count(*) filter (where role_group = 'no_position')::int as no_position,
           count(*)::int as total
    from person where merged_into_id is null
  `);
  console.log("5. role_group classification:", JSON.stringify(classification));

  // Exercise the real new app read against the real schema.
  const bdRow = (await db.execute(
    sql`select id::text as id, name from bd order by name limit 1`,
  )) as unknown as Array<{ id: string; name: string }>;
  const counts = await getFollowUpRoleGroupCounts(bdRow[0]!.id);
  console.log(`6. getFollowUpRoleGroupCounts("${bdRow[0]!.name}"):`, JSON.stringify(counts));

  process.exit(0);
}

void main();
