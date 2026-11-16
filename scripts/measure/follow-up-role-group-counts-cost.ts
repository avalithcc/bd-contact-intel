// Read-only: EXPLAIN ANALYZE of the per-role-group due counts the "Roles a
// seguir" panel adds to every /follow-ups load (PR for change
// follow-up-role-groups). Reviewer flagged that fuq_activity/fuq_connection
// aggregate over the whole activity table with the BD filter applied after,
// so the cost could scale with the activity table rather than with the BD's
// own contacts. This measures it on the heaviest BD instead of guessing.
//
// Safe to run before migration 0065: the query reads only fuq_due and
// person.role_group, both of which already exist in production.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildFollowUpRoleGroupCountsQuery } from "@/lib/followUp/candidateQuery";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const owners = (await db.execute(sql`
    select owner_bd_id::text as bd_id, b.name as bd, count(*)::int as owned
    from person
    join bd b on b.id = person.owner_bd_id
    where person.merged_into_id is null
    group by owner_bd_id, b.name
    order by owned desc
  `)) as unknown as Array<{ bd_id: string; bd: string; owned: number }>;

  console.log("owned contacts per BD:", JSON.stringify(owners, null, 2));

  const activity = (await db.execute(
    sql`select count(*)::int as n from activity`,
  )) as unknown as Array<{ n: number }>;
  console.log("activity rows:", activity[0]?.n);

  for (const owner of owners.slice(0, 3)) {
    const q = buildFollowUpRoleGroupCountsQuery(owner.bd_id);
    const started = Date.now();
    const plan = (await db.execute(
      sql`explain (analyze, buffers, timing) ${q}`,
    )) as unknown as Array<Record<string, string>>;
    const wallMs = Date.now() - started;
    console.log(`\n===== ${owner.bd} (${owner.owned} contacts) — wall ${wallMs}ms =====`);
    for (const row of plan) console.log(Object.values(row)[0]);
  }

  process.exit(0);
}

void main();
