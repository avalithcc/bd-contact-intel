// Read-only. The 107 contacts that reply but carry role_group = 'no_position' all have a genuinely
// empty job_title (measured: 0 of 107 have one stored, so this is a data hole, not a stale
// classifier). 93 of them came from `hubspot_import`.
//
// The HubSpot export already maps "Cargo" -> jobTitle (src/lib/hubspot/contacts.ts), and
// planHubSpotRefill only ever fills a field that is CURRENTLY empty. So the only question left is
// whether the export actually carries a Cargo for these people. If it does, the fix is an existing
// tested path, not new code.
//
// Uses the repo's own parser and classifier - never a reimplementation.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { parseHubSpotCsv } from "../../src/lib/hubspot/parse";
import { REQUIRED_CONTACT_HEADERS } from "@/lib/hubspot/columns";
import { classifyPosition, type RoleGroupKey } from "@/lib/roleGroups";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);

  const people = await db.execute<{ id: string; email: string | null; source_key: string | null }>(sql`
    select person.id, person.email, person.source_key
    from person
    where person.role_group = 'no_position'
      and exists (select 1 from activity a
                  where a.type = 'reply_received' and a.deleted_at is null and a.person_id = person.id)
  `);

  const rows = await parseHubSpotCsv("hubspot/todos-contactos.csv", REQUIRED_CONTACT_HEADERS);
  const cargoByEmail = new Map<string, string>();
  const emailsInCsv = new Set<string>();
  let csvWithCargo = 0;
  for (const r of rows) {
    const email = norm(r["Correo"]);
    const cargo = (r["Cargo"] ?? "").trim();
    if (cargo !== "") csvWithCargo++;
    if (email !== "") emailsInCsv.add(email);
    if (email !== "" && cargo !== "" && !cargoByEmail.has(email)) cargoByEmail.set(email, cargo);
  }

  let inCsvWithCargo = 0, inCsvBlankCargo = 0, notInCsvAtAll = 0, noEmail = 0;
  const destino = new Map<RoleGroupKey, number>();
  const samples: { cargo: string; would_be: RoleGroupKey }[] = [];
  for (const p of people) {
    if (!p.email) { noEmail++; continue; }
    const present = emailsInCsv.has(norm(p.email));
    const cargo = cargoByEmail.get(norm(p.email));
    if (!cargo) { if (present) inCsvBlankCargo++; else notInCsvAtAll++; continue; }
    inCsvWithCargo++;
    const would = classifyPosition(cargo);
    destino.set(would, (destino.get(would) ?? 0) + 1);
    if (samples.length < 20) samples.push({ cargo, would_be: would });
  }

  console.log(JSON.stringify({
    csv_filas: rows.length,
    csv_con_cargo: csvWithCargo,
    personas_no_position_que_responden: people.length,
    recuperables_del_csv: inCsvWithCargo,
    estan_en_el_csv_pero_sin_cargo: inCsvBlankCargo,
    no_estan_en_el_csv: notInCsvAtAll,
    sin_email_en_el_crm: noEmail,
    a_que_grupo_irian: [...destino.entries()].sort((a, b) => b[1] - a[1]),
    muestra: samples,
  }, null, 2));
  process.exit(0);
}

void main();
