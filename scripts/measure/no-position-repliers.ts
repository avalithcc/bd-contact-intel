// Read-only. The 107 contacts with role_group = 'no_position' among the people who reply.
// Three questions, in the order that decides whether this is a data hole or a stale classification:
//   1. Is `job_title` actually empty, or filled while `role_group` stayed 'no_position'?
//      classifyPosition() maps null/blank -> 'no_position' and an unmatched title -> 'other', so a
//      stored 'no_position' on a person who HAS a title is a stale backfill, fixable for free.
//   2. Of them, how many produced a reply that answers mail WE sent (the report's own rule)?
//   3. What do the titles look like, and does re-running the real classifier move them?
// The classifier is imported, never reimplemented, so what is measured is what ships.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { classifyPosition } from "@/lib/roleGroups";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const linkedReply = sql`exists (
    select 1 from activity a
    join email_message inb
      on inb.bd_id = a.actor_bd_id
     and inb.gmail_message_id = a.metadata->>'gmailMessageId'
     and inb.direction = 'inbound'
    where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id
      and (
        exists (select 1 from email_message o where o.direction='outbound'
                 and o.bd_id = inb.bd_id and o.gmail_thread_id = inb.gmail_thread_id
                 and o.sent_at <= inb.sent_at)
        or (inb.rfc_references is not null and exists (
             select 1 from email_message o where o.direction='outbound'
               and o.bd_id = inb.bd_id and o.rfc_message_id is not null and o.rfc_message_id <> ''
               and position(o.rfc_message_id in inb.rfc_references) > 0))
      )
  )`;

  const rows = await db.execute<{
    id: string; job_title: string | null; seniority: string | null;
    source_key: string | null; linked_reply: boolean;
  }>(sql`
    select person.id, person.job_title, person.seniority, person.source_key,
           ${linkedReply} as linked_reply
    from person
    where person.role_group = 'no_position'
      and exists (select 1 from activity a
                  where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id)
  `);

  const blank = (t: string | null) => t === null || t.trim() === "";
  const withTitle = rows.filter((r) => !blank(r.job_title));
  // Re-run the REAL classifier on whatever title is stored now.
  const reclassified = withTitle.map((r) => ({ title: r.job_title as string, would_be: classifyPosition(r.job_title) }));
  const movesOff = reclassified.filter((r) => r.would_be !== "no_position");
  const tally = new Map<string, number>();
  for (const r of movesOff) tally.set(r.would_be, (tally.get(r.would_be) ?? 0) + 1);

  console.log(JSON.stringify({
    total_no_position_repliers: rows.length,
    con_titulo_cargado: withTitle.length,
    sin_titulo_de_verdad: rows.length - withTitle.length,
    reclasificarian_a_algo: movesOff.length,
    destino: [...tally.entries()].sort((a, b) => b[1] - a[1]),
    respondieron_algo_nuestro: rows.filter((r) => r.linked_reply).length,
    respondieron_algo_nuestro_y_sin_titulo: rows.filter((r) => r.linked_reply && blank(r.job_title)).length,
    con_seniority_cargada_pero_sin_titulo: rows.filter((r) => blank(r.job_title) && r.seniority !== null).length,
    procedencia_de_los_sin_titulo: [...rows.filter((r) => blank(r.job_title))
      .reduce((m, r) => m.set(r.source_key ?? "(null)", (m.get(r.source_key ?? "(null)") ?? 0) + 1), new Map<string, number>())
      .entries()].sort((a, b) => b[1] - a[1]),
    muestra_de_titulos_mal_clasificados: reclassified.slice(0, 25),
  }, null, 2));
  process.exit(0);
}

void main();
