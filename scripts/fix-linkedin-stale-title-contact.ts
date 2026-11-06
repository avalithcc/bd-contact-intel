/**
 * One-off correction of the contact the LinkedIn extension created from a stale `document.title`
 * (person 03879d02-…): it was stored as "Senior Software Engineer" with no job title, company or
 * country, while the profile at linkedin.com/in/martingallegomaldonado is Martin Gallego Maldonado,
 * Human Resources Business Partner Lead at Chevron, Argentina.
 *
 * WRITES. It lives outside scripts/measure on purpose. Dry run by default; `--execute` performs the
 * writes. Every field goes through the CRM's OWN write path (updateContactProperty /
 * changeContactCompany), so each change lands with its `person_property_history` row in the same
 * transaction and is reversible from the record page — which is also why this does not take a
 * pg_dump: nothing here is destructive and the previous value of every field is recorded.
 *
 * The company is attached by key through changeContactCompany, which refuses a key that is not
 * already on file, so `company` and `company_key` can never be set to a company that does not exist.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { person } from "@/db/schema";
import { updateContactProperty } from "@/lib/contacts/propertyEditDb";
import { changeContactCompany } from "@/lib/contacts/companyChangeDb";
import type { EditablePersonProperty } from "@/lib/contacts/propertyEdit";

const PERSON_ID = "03879d02-dcbb-4ccf-97e8-c4a5680618fb";
/** Cristian Civita (admin): he ordered the correction, so the history records him, not the owner. */
const CHANGED_BY_BD_ID = "c4e4270c-91d2-4785-9375-e6436f676403";
const COMPANY_KEY = "chevron";

/** Read from the live top card of the profile on 2026-11-06. Nothing here is inferred. */
const PROPERTIES: Array<{ property: EditablePersonProperty; value: string }> = [
  { property: "firstName", value: "Martin" },
  { property: "lastName", value: "Gallego Maldonado" },
  { property: "jobTitle", value: "Human Resources Business Partner Lead" },
  { property: "country", value: "Argentina" },
];

const execute = process.argv.includes("--execute");

async function snapshot(label: string) {
  const [row] = await db.select().from(person).where(eq(person.id, PERSON_ID));
  console.log(`\n== ${label} ==`);
  console.log(
    JSON.stringify(
      row && {
        profileKey: row.profileKey,
        firstName: row.firstName,
        lastName: row.lastName,
        jobTitle: row.jobTitle,
        company: row.company,
        companyKey: row.companyKey,
        city: row.city,
        region: row.region,
        country: row.country,
      },
      null,
      2,
    ),
  );
  return row;
}

async function main() {
  const before = await snapshot("before");
  if (!before) throw new Error(`person ${PERSON_ID} not found`);
  if (before.mergedIntoId) throw new Error("contact was merged away; refusing to edit it");

  console.log(`\nplanned changes (${execute ? "EXECUTE" : "dry run"}):`);
  for (const { property, value } of PROPERTIES) {
    console.log(`  ${property}: ${JSON.stringify(before[property])} -> ${JSON.stringify(value)}`);
  }
  console.log(`  company: ${JSON.stringify(before.company)} -> company_key ${JSON.stringify(COMPANY_KEY)}`);

  if (!execute) {
    console.log("\nDry run: nothing was written. Re-run with --execute.");
    process.exit(0);
  }

  for (const { property, value } of PROPERTIES) {
    await updateContactProperty(PERSON_ID, property, value, CHANGED_BY_BD_ID);
    console.log(`  wrote ${property}`);
  }
  await changeContactCompany(PERSON_ID, COMPANY_KEY, CHANGED_BY_BD_ID);
  console.log("  wrote company");

  await snapshot("after");
  process.exit(0);
}

void main();
