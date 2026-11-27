/**
 * Read-only: can the "Para enviar correo" lane show WHO of the CRM users had
 * the contact?
 *
 * The lane's population is `readyForEmailCondition()` (contacted + verified
 * email) with the default role-group hide — imported from the lane's own
 * modules rather than transcribed, so this cannot measure a different
 * population than the screen renders (memory: "count the population the
 * screen uses").
 *
 * Three candidate attributions, measured independently because they overlap:
 *   1. `activity.actor_bd_id` — who performed a touch. Explicitly NULL for
 *      system-derived rows, including the migration-written `status_backfill`
 *      that made 2,973 of these people "contacted" (schema.ts comment).
 *   2. `person_bd_connection` with `sent_count > 0` — a LinkedIn message a BD
 *      sent, folded in by the LinkedIn import.
 *   3. `person.owner_bd_id` — the HubSpot owner, name-matched to a `bd` row
 *      by the import (src/lib/hubspot/owners.ts).
 *
 * GUARD SCOPE (README rule 1): every statement here is a read; no write.
 */
import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { person } from "@/db/schema";
import { roleGroupVisibilityCondition } from "@/lib/contacts/roleVisibility";
import { readyForEmailCondition } from "@/lib/outreach/queries";
import { NOT_WORTH_PRIORITIZING } from "@/lib/roleGroupPlaybook";

async function main() {
  const hidden = [...NOT_WORTH_PRIORITIZING.noPriorizar.keys];
  const where = and(
    isNull(person.mergedIntoId),
    readyForEmailCondition(),
    roleGroupVisibilityCondition(hidden),
  )!;

  const coverage = await db.execute(sql`
    with pop as (
      select ${person.id} as id, ${person.ownerBdId} as owner_bd_id
      from ${person}
      where ${where}
    )
    select
      count(*)::int as total,
      count(*) filter (where owner_bd_id is not null)::int as with_owner,
      count(*) filter (where exists (
        select 1 from activity a where a.person_id = pop.id and a.actor_bd_id is not null
      ))::int as with_activity_actor,
      count(*) filter (where exists (
        select 1 from person_bd_connection c where c.person_id = pop.id and c.sent_count > 0
      ))::int as with_linkedin_sender,
      count(*) filter (where exists (
        select 1 from person_bd_connection c where c.person_id = pop.id
      ))::int as with_any_connection,
      count(*) filter (where
        owner_bd_id is not null
        or exists (select 1 from activity a where a.person_id = pop.id and a.actor_bd_id is not null)
        or exists (select 1 from person_bd_connection c where c.person_id = pop.id and c.sent_count > 0)
      )::int as with_any_signal
    from pop
  `);
  console.log("coverage:", coverage[0]);

  const byType = await db.execute(sql`
    with pop as (select ${person.id} as id from ${person} where ${where})
    select a.type, count(*)::int as rows, count(distinct a.person_id)::int as persons,
           count(*) filter (where a.actor_bd_id is not null)::int as with_actor
    from activity a
    join pop on pop.id = a.person_id
    group by a.type
    order by persons desc
  `);
  console.log("\nactivity types in the lane (actor coverage per type):");
  for (const r of byType) console.log(" ", r);

  // The attribution a column would render, with the priority the UI would use.
  const resolved = await db.execute(sql`
    with pop as (
      select ${person.id} as id, ${person.ownerBdId} as owner_bd_id
      from ${person}
      where ${where}
    ),
    att as (
      select
        pop.id,
        coalesce(
          (select a.actor_bd_id from activity a
            where a.person_id = pop.id and a.actor_bd_id is not null
            order by a.created_at desc limit 1),
          (select c.bd_id from person_bd_connection c
            where c.person_id = pop.id and c.sent_count > 0
            order by c.sent_count desc limit 1),
          pop.owner_bd_id
        ) as bd_id
      from pop
    )
    select coalesce(b.name, '(sin atribucion)') as who, count(*)::int as persons
    from att left join bd b on b.id = att.bd_id
    group by 1 order by 2 desc
  `);
  console.log("\nresolved attribution (actor -> linkedin sender -> hubspot owner):");
  for (const r of resolved) console.log(" ", r);

  process.exit(0);
}

void main();
