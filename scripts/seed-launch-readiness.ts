/**
 * Seeds the SCRATCH database used by the launch-readiness pass
 * (tests/launch-readiness/*, openspec/changes/launch-readiness-pass).
 *
 *   set -a; source .env.e2e.local; set +a
 *   npx tsx scripts/seed-launch-readiness.ts            # dry run: prints what it would do
 *   npx tsx scripts/seed-launch-readiness.ts --execute  # wipes + reseeds the scratch DB
 *
 * Synthetic data only (invented names, example.com emails, 555 phones).
 * Refuses to run unless DATABASE_URL is local and ends in `_e2e`
 * (tests/launch-readiness/scratchDbGuard.ts). `--execute` TRUNCATES the
 * person/company/task/activity tables first, which is only acceptable on that
 * scratch database; the guard is what makes it safe.
 */
import postgres from "postgres";
import path from "path";
import fs from "fs";
import { assertScratchDatabaseUrl } from "../tests/launch-readiness/scratchDbGuard";

const envFile = path.join(__dirname, "..", ".env.e2e.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL;
assertScratchDatabaseUrl(url);
const email = process.env.E2E_EMAIL;
if (!email) throw new Error("E2E_EMAIL is required (the account the specs log in as)");
const execute = process.argv.includes("--execute");

const COMPANIES = [
  { key: "acme-pruebas", name: "Acme Pruebas" },
  { key: "globex-demo", name: "Globex Demo" },
  { key: "initech-sintetica", name: "Initech Sintetica" },
];

// [first, last, companyKey, title, ownedByE2e, hasEmail]
const PEOPLE: Array<[string, string, string, string, boolean, boolean]> = [
  ["Ada", "Calls", "acme-pruebas", "CTO", true, true],
  ["Bruno", "Meets", "acme-pruebas", "VP Engineering", true, true],
  ["Carla", "Tasks", "globex-demo", "Head of Product", true, true],
  ["Dario", "Discards", "globex-demo", "Engineering Manager", true, true],
  ["Elena", "Double", "initech-sintetica", "CEO", true, true],
  ["Fabio", "Whitespace", "initech-sintetica", "CTO", true, false],
  ["Gala", "Longnote", "acme-pruebas", "Director", true, true],
  ["Hugo", "Bulk", "globex-demo", "Tech Lead", true, true],
  ["Ines", "Bulk", "globex-demo", "Tech Lead", true, true],
  ["Julian", "Otro", "acme-pruebas", "CTO", false, true],
  ["Karina", "Otro", "initech-sintetica", "CTO", false, true],
];

// Mariel's cohort: a call-first list. 6 hotels x 4 contacts, all `status = new`
// (to call), source_key marks the cohort. Phones vary: landline only, mobile
// only, both, none.
const HOTELS = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((n) => ({
  key: `hotel-${n.toLowerCase()}-e2e`,
  name: `Hotel ${n} E2E`,
}));
const HOTEL_ROLES = ["Gerente General", "Jefe de Compras", "Director Comercial", "Gerente de Operaciones"];
const COHORT_SOURCE_KEY = "hoteles-e2e";

// Follow-up queue cohort: already worked, last touch old enough to be due
// (contacted at 7+ days, replied at 3+ days).
const DUE = [
  { first: "Queue", last: "Contacted1", status: "contacted", daysAgo: 10, outcome: "no_answer" },
  { first: "Queue", last: "Contacted2", status: "contacted", daysAgo: 12, outcome: "voicemail" },
  { first: "Queue", last: "Replied1", status: "replied", daysAgo: 5, outcome: "connected" },
];

async function main() {
  console.log(
    `[seed] ${execute ? "EXECUTE" : "DRY RUN"}: ${COMPANIES.length + HOTELS.length} companies, ${PEOPLE.length + HOTELS.length * 4 + DUE.length} people, 2 BDs`,
  );
  if (!execute) return console.log("[seed] nothing written. Re-run with --execute.");

  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx`truncate table activity, task, person_property_history, person_bd_connection, person_id_map, audit_log, person, company restart identity cascade`;
      const [me] = await tx`
        insert into bd (name, email) values ('ZZ E2E (no asignar)', ${email!})
        on conflict (email) do update set name = excluded.name returning id`;
      const [other] = await tx`
        insert into bd (name, email) values ('ZZ Otro BD', 'otro-bd-e2e@avalith.net')
        on conflict (email) do update set name = excluded.name returning id`;
      for (const c of COMPANIES) {
        await tx`insert into company (company_key, display_name, created_by_bd_id) values (${c.key}, ${c.name}, ${me!.id})`;
      }
      for (const [first, last, companyKey, title, mine, hasEmail] of PEOPLE) {
        const mail = hasEmail ? `${first}.${last}@example.com`.toLowerCase() : null;
        const company = COMPANIES.find((c) => c.key === companyKey)!;
        await tx`
          insert into person (first_name, last_name, email, email_normalized, phone, company, company_key, job_title, owner_bd_id, status)
          values (${first}, ${last}, ${mail}, ${mail}, '+1 555 010 0100', ${company.name}, ${companyKey}, ${title}, ${mine ? me!.id : other!.id}, 'new')`;
      }
      for (const h of HOTELS) {
        await tx`insert into company (company_key, display_name, created_by_bd_id) values (${h.key}, ${h.name}, ${me!.id})`;
      }
      let n = 0;
      for (const h of HOTELS) {
        for (const role of HOTEL_ROLES) {
          n += 1;
          const phone = n % 4 === 0 ? null : n % 4 === 1 ? `+54 11 5550 ${String(1000 + n)}` : null;
          const mobile = n % 4 === 2 || n % 4 === 1 ? `+54 9 11 5551 ${String(2000 + n)}` : null;
          const mail = n % 5 === 0 ? null : `contacto${n}@hotel-e2e.example.com`;
          await tx`
            insert into person (first_name, last_name, email, email_normalized, phone, mobile_phone, company, company_key, job_title, owner_bd_id, status, source_key)
            values (${`Contacto${String(n).padStart(2, "0")}`}, ${h.name}, ${mail}, ${mail}, ${phone}, ${mobile}, ${h.name}, ${h.key}, ${role}, ${me!.id}, 'new', ${COHORT_SOURCE_KEY})`;
        }
      }
      for (const d of DUE) {
        const at = new Date(Date.now() - d.daysAgo * 86_400_000).toISOString();
        const [p] = await tx`
          insert into person (first_name, last_name, company, company_key, job_title, owner_bd_id, status)
          values (${d.first}, ${d.last}, 'Hotel Alfa E2E', 'hotel-alfa-e2e', 'Gerente', ${me!.id}, ${d.status}) returning id`;
        await tx`
          insert into activity (person_id, actor_bd_id, type, metadata, created_at, updated_at)
          values (${p!.id}, ${me!.id}, 'call',
                  ${JSON.stringify({ outcome: d.outcome, direction: "outbound", occurredAt: at, notes: null })}::jsonb, ${at}::timestamptz, ${at}::timestamptz)`;
      }
    });
    console.log("[seed] done");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
