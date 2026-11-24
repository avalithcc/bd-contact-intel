// Read-only FEASIBILITY ESTIMATE, not a promise. The 107 repliers with no job_title cannot be
// backfilled from HubSpot (93 are in the export with a blank "Cargo", 14 are not in it at all), so
// the title does not exist in any file we hold. But we DO already store the text of their own
// inbound replies, and a reply usually carries a signature with the person's title.
//
// This measures only the CEILING: how many of the 107 have a stored inbound body at all, and in how
// many does some line of the last part of that body classify as a real role group. A line that
// classifies is not proof it is that person's title - it could be a quoted sentence - so treat the
// yield as an upper bound to decide whether the idea is worth designing, nothing more.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { classifyPosition, type RoleGroupKey } from "@/lib/roleGroups";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const rows = await db.execute<{ person_id: string; body_text: string | null }>(sql`
    select distinct on (person.id) person.id as person_id, m.body_text
    from person
    join activity a on a.person_id = person.id and a.type = 'reply_received' and a.deleted_at is null
    join email_message m
      on m.bd_id = a.actor_bd_id
     and m.gmail_message_id = a.metadata->>'gmailMessageId'
     and m.direction = 'inbound'
    where person.role_group = 'no_position'
    order by person.id, length(coalesce(m.body_text, '')) desc
  `);

  let withBody = 0;
  const hits = new Map<RoleGroupKey, number>();
  let personsWithHit = 0;
  for (const r of rows) {
    const body = (r.body_text ?? "").trim();
    if (body === "") continue;
    withBody++;
    // A reply carries TWO signatures: the sender's own, and OURS inside the quoted original. Reading
    // the whole body credits the contact with our BD's title - which is why the naive pass returned
    // sales_bd and c_level_business (a BD and a COO: us) as the top two groups. So cut the body at
    // the first quote marker and only read what the person wrote themselves.
    const cut = body.search(/^\s*>|^\s*El .{0,80}escribi(ó|o):|^\s*On .{0,80}wrote:|^\s*-{2,}\s*(Mensaje|Forwarded)/im);
    const own = cut > 0 ? body.slice(0, cut) : cut === 0 ? "" : body;
    const lines = own.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2 && l.length <= 60);
    const tail = lines.slice(-14);
    let best: RoleGroupKey | null = null;
    for (const line of tail) {
      const g = classifyPosition(line);
      if (g !== "no_position" && g !== "other") { best = g; break; }
    }
    if (best) { personsWithHit++; hits.set(best, (hits.get(best) ?? 0) + 1); }
  }

  console.log(JSON.stringify({
    personas_no_position_con_reply: rows.length,
    con_cuerpo_guardado: withBody,
    sin_cuerpo: rows.length - withBody,
    techo_estimado_recuperable: personsWithHit,
    sin_texto_propio_arriba_de_la_cita: rows.filter((r) => {
      const b = (r.body_text ?? "").trim();
      if (b === "") return false;
      const c = b.search(/^\s*>|^\s*El .{0,80}escribi(ó|o):|^\s*On .{0,80}wrote:|^\s*-{2,}\s*(Mensaje|Forwarded)/im);
      return c === 0;
    }).length,
    grupos_que_saldrian: [...hits.entries()].sort((a, b) => b[1] - a[1]),
  }, null, 2));
  process.exit(0);
}

void main();
