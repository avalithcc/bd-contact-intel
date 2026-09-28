/**
 * Creates the 16 curated, owner-approved partner-account contacts
 * (src/lib/contacts/partnerAccountContacts.ts) — human contacts at accounts
 * Avalith already works with, today only free text inside `company.notes`.
 *
 * Goes through the SAME app path "Nuevo contacto" uses
 * (runCreateContactFlow, @/lib/contacts/createContactFlow), including its
 * duplicate checks (matchIdentity precedence) and the own-company guard —
 * not a hand-rolled insert. One deliberate difference from the UI path
 * (createContactActions.ts): that path always inserts a `person_bd_connection`
 * row for "the BD who's creating this contact right now". These rows have no
 * such BD — per the task, ownership is left unassigned because the two BDs
 * who tracked these accounts no longer work here — so `insertConnection` is
 * a no-op port here. Nothing else about the flow changes: the same lock,
 * the same prefetch shape, the same matcher precedence, the same
 * `duplicate_candidate` write path for a confirmed "create anyway".
 *
 * Two pre-condition checks run BEFORE the identity resolver even sees a row
 * (src/lib/contacts/partnerAccountContacts.ts#planPartnerAccountContactRows):
 *   1. `company_key` (re-derived via normalizeCompanyKey, never trusted from
 *      the task's table) must already exist in `company` — this script only
 *      ever creates a `person`, never a `company`.
 *   2. The row's email must not already belong to a live (non-merged)
 *      person — checked fresh at plan/execute time, not assumed from the
 *      task write-up.
 * Rows that fail either check are reported, never force-created.
 *
 * Defaults to a DRY RUN that only prints counts and the planned rows (no
 * PII beyond what's already in the owner-approved list above). Pass
 * --execute --actor=<bd id> to write, in ONE transaction plus ONE
 * `audit_log` row carrying the revert keys (the exact person ids created —
 * `DELETE FROM person WHERE id IN (...)`; each newly created person has no
 * other rows referencing it yet, since `insertConnection` is a no-op here).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/create-partner-account-contacts.ts
 *   npx tsx --env-file=.env.local scripts/create-partner-account-contacts.ts --execute --actor=<bd id>
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, company, person } from "../src/db/schema";
import { withIdentityLock } from "../src/lib/identity/resolveDb";
import { matchIdentity, buildNameCompanyKey } from "../src/lib/identity/matcher";
import {
  classifyMatchResultForCreate,
  matchableRowFromFields,
  type NewContactFields,
} from "../src/lib/contacts/createContact";
import {
  runCreateContactFlow,
  type CreateContactFlowPorts,
  type CreateContactResult,
  type ExistingPersonRow,
} from "../src/lib/contacts/createContactFlow";
import {
  PARTNER_ACCOUNT_CONTACT_ROWS,
  planPartnerAccountContactRows,
  type PlannedPartnerAccountContactRow,
} from "../src/lib/contacts/partnerAccountContacts";
import { classifyPosition } from "../src/lib/roleGroups";

interface CliArgs {
  execute: boolean;
  actor: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let execute = false;
  let actor: string | null = null;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>`);
  }
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor };
}

function toFields(row: PlannedPartnerAccountContactRow): NewContactFields {
  return {
    firstName: row.firstName || null,
    lastName: row.lastName || null,
    profileKey: null,
    email: row.email,
    emailStatus: "probable",
    company: row.company,
    companyKey: row.companyKey,
  };
}

async function main() {
  const { execute, actor } = parseArgs(process.argv.slice(2));

  const emails = PARTNER_ACCOUNT_CONTACT_ROWS.map((r) => r.email.trim().toLowerCase());
  const companyKeysToCheck = [...new Set(PARTNER_ACCOUNT_CONTACT_ROWS.map((r) => r.companyDisplay))];

  const [existingByEmailRows, existingCompanyRows] = await Promise.all([
    db
      .select({ id: person.id, emailNormalized: person.emailNormalized })
      .from(person)
      .where(and(inArray(person.emailNormalized, emails), isNull(person.mergedIntoId))),
    db.select({ companyKey: company.companyKey }).from(company),
  ]);

  const existingPersonIdByEmail = new Map(
    existingByEmailRows
      .filter((r): r is { id: string; emailNormalized: string } => r.emailNormalized !== null)
      .map((r) => [r.emailNormalized, r.id]),
  );
  const existingCompanyKeys = new Set(existingCompanyRows.map((r) => r.companyKey));

  const plan = planPartnerAccountContactRows(
    PARTNER_ACCOUNT_CONTACT_ROWS,
    existingPersonIdByEmail,
    existingCompanyKeys,
  );

  console.log(`Curated rows: ${PARTNER_ACCOUNT_CONTACT_ROWS.length}`);
  console.log(`Already an existing person's email (skipped, not created): ${plan.existingEmailMatches.length}`);
  for (const m of plan.existingEmailMatches) {
    console.log(`  ${m.displayName} <${m.email}> -> existing person ${m.existingPersonId}`);
  }
  console.log(`Company key not found in \`company\` (skipped, not created): ${plan.missingCompanyKeys.length}`);
  for (const m of plan.missingCompanyKeys) {
    console.log(`  ${m.displayName} -> company_key "${m.companyKey}"`);
  }
  console.log(`Eligible to run through the identity resolver: ${plan.toCreate.length}`);

  // Ask the SAME identity resolver ("Nuevo contacto"'s matchIdentity, via
  // classifyMatchResultForCreate) what it would do with each eligible row —
  // reused, not reimplemented. Only a plain SELECT per lookup key, scoped to
  // this row's companyKey/email; 12 rows total, never a loop over the full
  // person table.
  const decisions: { row: PlannedPartnerAccountContactRow; decision: string; existingPersonId?: string }[] = [];
  for (const row of plan.toCreate) {
    const fields = toFields(row);
    const matchRow = matchableRowFromFields(fields);
    const [byCompany, byEmail] = await Promise.all([
      db.select().from(person).where(and(eq(person.companyKey, row.companyKey), isNull(person.mergedIntoId))),
      db
        .select()
        .from(person)
        .where(and(eq(person.emailNormalized, row.emailNormalized), isNull(person.mergedIntoId))),
    ]);
    const byNameCompanyIds = new Map<string, string[]>();
    for (const r of byCompany) {
      const key = buildNameCompanyKey({ firstName: r.firstName, lastName: r.lastName, company: r.company });
      if (key) byNameCompanyIds.set(key, [...(byNameCompanyIds.get(key) ?? []), r.id]);
    }
    const result = matchIdentity(matchRow, {
      byProfileKey: () => null,
      byVerifiedEmail: () => null,
      byEmail: (email) => byEmail.filter((r) => r.emailNormalized === email).map((r) => r.id),
      byNameCompany: (key) => byNameCompanyIds.get(key) ?? [],
    });
    const classified = classifyMatchResultForCreate(result);
    decisions.push({
      row,
      decision: classified.action,
      existingPersonId: "existingPersonId" in classified ? classified.existingPersonId : undefined,
    });
  }

  console.log("\nPer-row identity-resolver decision:");
  for (const d of decisions) {
    const suffix = d.existingPersonId ? ` (existing person ${d.existingPersonId})` : "";
    console.log(`  ${d.row.displayName} <${d.row.email}> @ ${d.row.company} -> ${d.decision}${suffix}`);
  }

  if (!execute) {
    console.log("\nDry run only — nothing written. Re-run with --execute --actor=<bd id>.");
    return;
  }

  const toActuallyCreate = decisions.filter((d) => d.decision === "create");
  if (!toActuallyCreate.length) {
    console.log("\nNothing eligible to create (every row already matched, was blocked, or needs manual review).");
    return;
  }

  const createdPersonIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const { row } of toActuallyCreate) {
      const fields = toFields(row);
      const ports: CreateContactFlowPorts = {
        withLock: (fn) => withIdentityLock(tx, fn),
        prefetch: async (f) => {
          const [byCompany, byEmail] = await Promise.all([
            f.companyKey
              ? tx
                  .select()
                  .from(person)
                  .where(and(eq(person.companyKey, f.companyKey), isNull(person.mergedIntoId)))
              : Promise.resolve([]),
            f.email
              ? tx
                  .select()
                  .from(person)
                  .where(and(eq(person.emailNormalized, f.email.trim().toLowerCase()), isNull(person.mergedIntoId)))
              : Promise.resolve([]),
          ]);
          return { byProfile: [] as ExistingPersonRow[], byCompany, byEmail };
        },
        insertPerson: async (newId, f) => {
          await tx.insert(person).values({
            id: newId,
            profileKey: f.profileKey,
            firstName: f.firstName,
            lastName: f.lastName,
            email: f.email,
            emailNormalized: f.email ? f.email.trim().toLowerCase() : null,
            emailStatus: f.emailStatus,
            company: f.company,
            companyKey: f.companyKey,
            jobTitle: row.jobTitle,
            roleGroup: classifyPosition(row.jobTitle),
            ownerBdId: null,
            sourceKey: row.sourceKey,
          });
        },
        // No natural BD to attribute a "connection" to — see file header.
        insertConnection: async () => {},
        insertDuplicateCandidate: async () => {
          // Every row reaching this transaction already resolved to
          // "create" via the dry-run decision above; a "needs_confirmation"
          // row never reaches here (confirmDuplicate stays false below).
        },
      };

      const result: CreateContactResult = await runCreateContactFlow(fields, false, ports);
      if (result.action === "created" && result.personId) {
        createdPersonIds.push(result.personId);
      } else {
        // A concurrent write since the dry-run read could have changed the
        // outcome; fail loudly rather than silently skipping.
        throw new Error(
          `Expected to create ${row.displayName} <${row.email}>, but the resolver now says "${result.action}" — re-run the dry run before retrying.`,
        );
      }
    }

    await tx.insert(auditLog).values({
      actorBdId: actor!,
      action: "migration_create_partner_account_contacts",
      metadata: {
        rowsConsidered: PARTNER_ACCOUNT_CONTACT_ROWS.length,
        created: createdPersonIds.length,
        existingEmailMatches: plan.existingEmailMatches.length,
        missingCompanyKeys: plan.missingCompanyKeys.length,
        // Revert keys: DELETE FROM person WHERE id IN (...).
        personIds: createdPersonIds,
      },
    });
  });

  console.log(`\nCreated ${createdPersonIds.length} person row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
