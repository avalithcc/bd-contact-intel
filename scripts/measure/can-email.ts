/**
 * Read-only pre-flight for "can we email these people from the CRM today?".
 *
 * It does NOT re-derive the rule (README rule 2): the verdict comes from `resolveParaRecipients`, the exact
 * function the composer's "Para" field calls, and the opt-out from `listSuppressionRules` + `isSuppressed`,
 * the ones the Sequences use. So a refusal here is the refusal the BD would see, with the same reason code.
 *
 * Usage (comma- or space-separated, quote the whole list):
 *   npx tsx --env-file=.env scripts/measure/can-email.ts --emails="a@x.com, b@y.com"
 *
 * Prints names and addresses: local only, never into a PR body or any shared artifact (README rule 4).
 *
 * GUARD SCOPE (README rule 1): the guard covers the one connection it is set on, not the pool; the reads
 * here are sequential, and the application helpers it calls issue no write.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, person } from "@/db/schema";
import { resolveParaRecipients } from "@/lib/email/recipients/queries";
import { isSuppressed } from "@/lib/sequences/suppression";
import { listSuppressionRules } from "@/lib/sequences/suppressionQueries";

async function main() {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--emails="));
  if (!arg) throw new Error('Usage: --emails="a@x.com, b@y.com"');
  const wanted = arg
    .slice("--emails=".length)
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) throw new Error("no addresses given");

  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)} | direcciones pedidas: ${wanted.length}\n`);

  const rows = await db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      emailNormalized: person.emailNormalized,
      emailStatus: person.emailStatus,
      company: person.company,
      companyKey: person.companyKey,
      status: person.status,
      preferredLanguage: person.preferredLanguage,
      country: person.country,
      mergedIntoId: person.mergedIntoId,
      ownerName: bd.name,
    })
    .from(person)
    .leftJoin(bd, sql`${bd.id} = ${person.ownerBdId}`)
    .where(
      sql`lower(coalesce(${person.emailNormalized}, ${person.email})) in (${sql.join(
        wanted.map((e) => sql`${e}`),
        sql`, `,
      )})`,
    );

  const byEmail = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byEmail.set((r.emailNormalized ?? r.email ?? "").trim().toLowerCase(), r);

  const rules = await listSuppressionRules();
  const companies = new Set<string>();

  for (const email of wanted) {
    const row = byEmail.get(email);
    console.log(`── ${email}`);
    if (!row) {
      console.log("   NO ESTÁ en el CRM con esa dirección. Hay que crear el contacto antes de poder mandarle desde el compositor.\n");
      continue;
    }
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ") || "(sin nombre)";
    // The free-text `company` can be blank while `company_key` is set (a merge moves the key, not the text),
    // and the key is what decides whether two recipients may share one email.
    const companyLabel = row.company?.trim() || (row.companyKey ? `[clave ${row.companyKey}]` : "sin empresa");
    console.log(`   ${name} | ${companyLabel} | estado ${row.status ?? "-"} | email ${row.emailStatus ?? "-"} | dueño ${row.ownerName ?? "sin dueño"}`);
    console.log(`   idioma ${row.preferredLanguage ?? "automático"} | país ${row.country ?? "-"}`);
    if (row.mergedIntoId) console.log("   OJO: esta fila fue fusionada en otra; el compositor resuelve al sobreviviente.");
    if (isSuppressed(email, rules)) console.log("   SUPRIMIDO: pidió no recibir más correos (email_suppression).");

    // The composer's own verdict, as the primary recipient of a one-to-one email.
    const verdict = await resolveParaRecipients(row.id, []);
    console.log(verdict.ok ? `   el compositor lo acepta -> ${verdict.to}` : `   EL COMPOSITOR LO RECHAZA: ${verdict.reason}`);
    if (row.companyKey) companies.add(row.companyKey);
    console.log("");
  }

  console.log(`empresas distintas entre los que están: ${companies.size}`);
  if (companies.size > 1) {
    console.log(
      "Un solo correo NO puede llevar destinatarios de empresas distintas: el compositor devuelve `recipient_other_company`\n" +
        "para cualquier destinatario extra cuya empresa no sea la del contacto del registro. Son correos separados, uno por empresa.",
    );
  }
  process.exit(0);
}

void main();
