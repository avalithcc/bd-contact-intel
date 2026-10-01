/**
 * Owner-run, READ-ONLY data-quality report for the hotel import
 * (source_key 'hoteles-2026-10'). There is NO --execute mode: the script
 * cannot write. It runs one `accessMode: "read only"` transaction, so Postgres
 * itself rejects any write for its whole life.
 *
 * It re-derives both findings from the live `person` table (not from the CSV),
 * so it can be re-run after any clean-up:
 *   1. phone / mobile numbers whose dial code disagrees with the contact's
 *      country (same rule the importer used: normalizeHotelPhone), with the
 *      country the dial code belongs to and whether its length is possible;
 *   2. the role_group distribution, how many contacts the default list view
 *      hides (groups read from NOT_WORTH_PRIORITIZING), and the job titles
 *      sitting in `other`.
 *
 * Output is Spanish. By default it prints counts only; --detalle adds names,
 * companies and numbers (personal data: keep it in your terminal).
 *
 * Usage (owner-run only, requires DATABASE_URL):
 *   npx tsx scripts/report-hoteles-data-quality.ts
 *   npx tsx scripts/report-hoteles-data-quality.ts --detalle
 *
 * Reads: one SELECT on person (source_key = HOTELES_SOURCE_KEY, not merged),
 * capped at ROW_CAP rows, ordered by id. No loops of queries.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  assessPhones,
  findSharedNumbers,
  summariseRoleGroups,
  type PhoneFinding,
  type QualityPerson,
} from "../src/lib/hoteles2026/dataQuality";
import { HOTELES_SOURCE_KEY } from "../src/lib/hoteles2026/rows";
import { classifyPosition } from "../src/lib/roleGroups";

// A mapped type (not the interface) so it satisfies execute()'s Record constraint.
type PersonRow = { [K in keyof QualityPerson]: QualityPerson[K] };

const ROW_CAP = 1000;
const DETAIL = process.argv.includes("--detalle");

const SHAPE_ES = {
  ok: "formato posible para ese país",
  too_short: "demasiado corto para ese país (inutilizable)",
  too_long: "demasiado largo para ese país (inutilizable)",
  unknown: "no se puede comprobar el largo",
} as const;

const name = (p: QualityPerson) => [p.firstName, p.lastName].filter(Boolean).join(" ") || "(sin nombre)";

function printPhones(people: QualityPerson[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const findings: PhoneFinding[] = people.flatMap((p) => assessPhones(p));
  const shared = findSharedNumbers(people);
  const withShared = (f: PhoneFinding) => (shared.get(f.value.replace(/\D/g, ""))?.length ?? 0) > 1;
  const peopleAffected = new Set(findings.map((f) => f.personId)).size;

  console.log("1. TELÉFONOS CUYO PREFIJO NO COINCIDE CON EL PAÍS");
  console.log(`   Contactos afectados: ${peopleAffected}  (números marcados: ${findings.length})`);
  console.log(`   Imposibles para su prefijo (largo incorrecto): ${findings.filter((f) => f.shape === "too_short" || f.shape === "too_long").length}`);
  console.log(`   Compartidos por varios contactos (probable centralita): ${findings.filter(withShared).length}`);
  console.log(`   Con formato posible de otro país (revisar a mano): ${findings.filter((f) => f.shape === "ok" && !withShared(f)).length}`);
  if (!DETAIL) return;
  console.log("");
  for (const f of findings) {
    const p = byId.get(f.personId)!;
    const code = f.dial ? `+${f.dial} (${f.dialLabel})` : "prefijo desconocido";
    const extra = withShared(f) ? " | número compartido con otros contactos" : "";
    console.log(`   - ${name(p)} | ${p.company ?? "sin empresa"} | país del contacto: ${f.country}`);
    console.log(`       ${f.field === "mobile" ? "Móvil" : "Teléfono"}: ${f.value} -> prefijo ${code} | ${SHAPE_ES[f.shape]}${extra}`);
  }
}

function printRoles(people: QualityPerson[]) {
  const s = summariseRoleGroups(people);
  const stale = people.filter((p) => p.roleGroup !== classifyPosition(p.jobTitle)).length;
  console.log("2. GRUPOS DE ROL");
  console.log(`   Contactos: ${s.total}`);
  for (const [group, n] of Object.entries(s.byGroup).sort((a, b) => b[1] - a[1])) console.log(`   ${group.padEnd(20)} ${n}`);
  console.log(`   Grupos que la lista oculta por defecto: ${s.hiddenGroups.join(", ")}`);
  console.log(`   Contactos ocultos en la vista por defecto: ${s.hiddenByDefault} de ${s.total}`);
  console.log(`   Contactos en 'other' (visibles, pero sin clasificar): ${s.byGroup.other ?? 0}`);
  console.log(`   Con grupo guardado distinto al que daría hoy el clasificador: ${stale}`);
  if (!DETAIL) return;
  console.log("");
  console.log("   Cargos en 'other':");
  for (const t of [...s.otherTitles].sort()) console.log(`     - ${t}`);
}

async function main() {
  const people = await db.transaction(
    async (tx) => {
      const rows = await tx.execute<PersonRow>(sql`
        select id::text as "id", first_name as "firstName", last_name as "lastName", company,
          job_title as "jobTitle", role_group as "roleGroup", country, phone, mobile_phone as "mobilePhone"
        from person
        where source_key = ${HOTELES_SOURCE_KEY} and merged_into_id is null
        order by id
        limit ${ROW_CAP}
      `);
      return [...rows];
    },
    { accessMode: "read only" },
  );

  console.log(`INFORME DE CALIDAD DE DATOS - HOTELES (${HOTELES_SOURCE_KEY})`);
  console.log("Solo lectura: este informe no modifica ningún dato.");
  if (people.length === ROW_CAP) console.log(`AVISO: se alcanzó el tope de ${ROW_CAP} filas; el informe puede estar incompleto.`);
  console.log("");
  printPhones(people);
  console.log("");
  printRoles(people);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
