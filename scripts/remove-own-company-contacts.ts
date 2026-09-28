/**
 * Removes Avalith's own coworkers from the system, plus everything that
 * references them.
 *
 * Product decision: a BD's LinkedIn export naturally includes their Avalith
 * coworkers alongside their real network. Coworkers are not relevant to
 * this BD-contact-intelligence system and must be excluded entirely — see
 * src/lib/ownCompany.ts (the single source of truth for "is this Avalith
 * itself", and for the exact list of own-company keys this script iterates)
 * and src/lib/queries.ts#upsertContacts, which now skips these rows at
 * import time. This script is the cleanup for rows that were imported
 * before that guard existed, or before it recognized a given spelling
 * variant (see ownCompany.ts's OWN_COMPANY_NAMES comment).
 *
 * Three independent things get removed, one per legacy/current model:
 *
 * 1. LEGACY `contact` rows (pre-unified-contact model) whose `company`
 *    matches Avalith (any BD, any spelling), plus every row that references
 *    that contact by id but has no DB-level foreign key to cascade
 *    automatically:
 *      - linkedin_scrape_job (contact_id)
 *      - signal (contact_id)
 *      - task (contact_id)
 *      - activity (contact_id)
 *      - conversation (bd_id + peer_profile_key), which cascades its own
 *        `message` rows via the real `message.conversation_id` FK.
 *
 * 2. `person` rows (current unified-contact model, design.md D1-D8) matched
 *    by `company`/`company_key` or, when both are blank/unrecognizable, by
 *    the domain of `email` — see src/lib/ownCompany.ts#ownCompanyMatchReason.
 *    Every dependent table has a real `person_id` FK with `onDelete: cascade`
 *    (activity, task, signal, linkedin_scrape_job, person_bd_connection,
 *    person_property_history, person_id_map, duplicate_candidate,
 *    merge_event) so deleting the `person` row alone is enough for Postgres
 *    to cascade all of those; `audit_log.person_id` is `onDelete: set null`,
 *    so an existing audit row survives with a null subject rather than being
 *    silently erased. Counted explicitly below purely for the dry-run
 *    report — the actual delete is just `DELETE FROM person WHERE id IN (…)`.
 *
 * 3. The shared `company`/`target_company` entity for EVERY own-company key
 *    (any BD, any spelling — no longer a single hardcoded key), plus rows
 *    that reference it WITHOUT a DB-level FK:
 *      - board_candidate (company_key)
 *      - company_probe (company_key)
 *    (activity/task/signal/company_property_history for these company_keys,
 *    plus job_posting/sync_run/company_alias for matching target_company
 *    rows, all cascade automatically via real FKs when the `company` /
 *    `target_company` rows are deleted.)
 *
 * Defaults to a DRY RUN that only prints counts per table. Pass --apply to
 * actually delete, inside a single transaction, deepest-dependency-first,
 * plus one `audit_log` row in the SAME transaction recording exactly what
 * was removed (revert keys: the person ids and company keys touched).
 * `--apply` requires `--actor=<bd id>` since audit_log.actor_bd_id is a
 * required FK.
 *
 * Usage:
 *   npx tsx scripts/remove-own-company-contacts.ts
 *   npx tsx scripts/remove-own-company-contacts.ts --apply --actor=<bd id>
 *
 * Requires DATABASE_URL to be set (see .env). Never run --apply against
 * production without a fresh backup — this is a destructive, irreversible
 * cleanup. See src/lib/migration/backup.ts#snapshotBackup for the existing
 * pg_dump-before-execute mechanism used by the collapse/fold-leads
 * migration; this script's `--apply` should be preceded by the same kind of
 * snapshot (of at least: person, company, target_company, contact,
 * board_candidate, company_probe, and every cascading dependent table
 * listed above) before it is ever run against production.
 */
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  activity,
  auditLog,
  boardCandidate,
  company,
  companyProbe,
  contact,
  conversation,
  duplicateCandidate,
  linkedinScrapeJob,
  mergeEvent,
  person,
  personBdConnection,
  personIdMap,
  personPropertyHistory,
  signal,
  targetCompany,
  task,
} from "../src/db/schema";
import { ownCompanyKeys, ownCompanyMatchReason } from "../src/lib/ownCompany";
import { splitEmail } from "../src/lib/emailPatterns";

const APPLY = process.argv.includes("--apply");
const actorArg = process.argv.find((a) => a.startsWith("--actor="));
const ACTOR_BD_ID = actorArg ? actorArg.slice("--actor=".length) : null;

if (APPLY && !ACTOR_BD_ID) {
  throw new Error("--apply requires --actor=<bd id> for the audit log");
}

const OWN_KEYS = ownCompanyKeys();

async function main() {
  // --- 1. Legacy `contact` rows, across every BD. ---
  const contacts = await db
    .select({
      id: contact.id,
      bdId: contact.bdId,
      profileKey: contact.profileKey,
      company: contact.company,
      email: contact.email,
    })
    .from(contact);

  const ownContacts = contacts
    .map((c) => ({
      ...c,
      matchReason: ownCompanyMatchReason(
        c.company,
        c.email ? splitEmail(c.email)?.domain ?? null : null,
      ),
    }))
    .filter((c) => c.matchReason !== null);
  const ownContactIds = ownContacts.map((c) => c.id);
  const peerPairs = ownContacts.map((c) => ({
    bdId: c.bdId,
    peerProfileKey: c.profileKey,
  }));

  const matchedByName = ownContacts.filter((c) => c.matchReason === "name").length;
  const matchedOnlyByDomain = ownContacts.filter((c) => c.matchReason === "domain").length;

  console.log(`Found ${ownContacts.length} own-company legacy contact(s) out of ${contacts.length} total.`);
  console.log(`  matched by company name:            ${matchedByName}`);
  console.log(`  matched ONLY by email domain:        ${matchedOnlyByDomain}`);
  if (matchedOnlyByDomain) {
    console.log(
      "  (blank/unrecognizable company, @avalith.net or @avalith.com email — double-check these before --apply)",
    );
  }

  // Dependent counts, keyed by contact_id (no DB-level FK to cascade).
  const [scrapeJobCount] = ownContactIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(linkedinScrapeJob)
        .where(inArray(linkedinScrapeJob.contactId, ownContactIds))
    : [{ count: 0 }];
  const [signalCount] = ownContactIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(signal)
        .where(inArray(signal.contactId, ownContactIds))
    : [{ count: 0 }];
  const [taskCount] = ownContactIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(task)
        .where(inArray(task.contactId, ownContactIds))
    : [{ count: 0 }];
  const [activityCount] = ownContactIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(activity)
        .where(inArray(activity.contactId, ownContactIds))
    : [{ count: 0 }];

  // Conversations belonging to those contacts, matched per-BD by
  // peer_profile_key (contact has no conversation_id FK either way — the
  // link is via profile key, same as the rest of the messaging feature).
  const conversationIds: string[] = [];
  for (const pair of peerPairs) {
    const rows = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        sql`${conversation.bdId} = ${pair.bdId} AND ${conversation.peerProfileKey} = ${pair.peerProfileKey}`,
      );
    conversationIds.push(...rows.map((r) => r.id));
  }
  const conversationCount = conversationIds.length;
  let messageCount = 0;
  if (conversationCount) {
    const [msgCount] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM message WHERE conversation_id IN (${sql.join(
        conversationIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    messageCount = msgCount?.count ?? 0;
  }

  // --- 2. `person` rows (unified-contact model), across every BD/owner. ---
  const persons = await db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      companyKey: person.companyKey,
      email: person.email,
      sourceKey: person.sourceKey,
    })
    .from(person);

  const ownPersons = persons
    .map((p) => {
      const emailDomain = p.email ? splitEmail(p.email)?.domain ?? null : null;
      const matchReason =
        ownCompanyMatchReason(p.company, emailDomain) ??
        ownCompanyMatchReason(p.companyKey, emailDomain);
      return { ...p, matchReason };
    })
    .filter((p) => p.matchReason !== null);
  const ownPersonIds = ownPersons.map((p) => p.id);

  const personMatchedByName = ownPersons.filter((p) => p.matchReason === "name").length;
  const personMatchedOnlyByDomain = ownPersons.filter((p) => p.matchReason === "domain").length;

  console.log(`\nFound ${ownPersons.length} own-company person(s) out of ${persons.length} total.`);
  console.log(`  matched by company name/key:        ${personMatchedByName}`);
  console.log(`  matched ONLY by email domain:        ${personMatchedOnlyByDomain}`);
  for (const p of ownPersons) {
    console.log(
      `    person ${p.id} — "${[p.firstName, p.lastName].filter(Boolean).join(" ")}" ` +
        `company=${p.company ?? "null"} companyKey=${p.companyKey ?? "null"} ` +
        `source=${p.sourceKey ?? "null"} matched=${p.matchReason}`,
    );
  }

  // Dependent counts for the `person` rows above. Every one of these cascades
  // automatically via a real FK when the person row is deleted (see file
  // header) — counted here purely for the dry-run report.
  const [personActivityCount] = ownPersonIds.length
    ? await db.select({ count: sql<number>`count(*)` }).from(activity).where(inArray(activity.personId, ownPersonIds))
    : [{ count: 0 }];
  const [personTaskCount] = ownPersonIds.length
    ? await db.select({ count: sql<number>`count(*)` }).from(task).where(inArray(task.personId, ownPersonIds))
    : [{ count: 0 }];
  const [personSignalCount] = ownPersonIds.length
    ? await db.select({ count: sql<number>`count(*)` }).from(signal).where(inArray(signal.personId, ownPersonIds))
    : [{ count: 0 }];
  const [personScrapeJobCount] = ownPersonIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(linkedinScrapeJob)
        .where(inArray(linkedinScrapeJob.personId, ownPersonIds))
    : [{ count: 0 }];
  const [personBdConnectionCount] = ownPersonIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(personBdConnection)
        .where(inArray(personBdConnection.personId, ownPersonIds))
    : [{ count: 0 }];
  const [personPropertyHistoryCount] = ownPersonIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(personPropertyHistory)
        .where(inArray(personPropertyHistory.personId, ownPersonIds))
    : [{ count: 0 }];
  const [personIdMapCount] = ownPersonIds.length
    ? await db.select({ count: sql<number>`count(*)` }).from(personIdMap).where(inArray(personIdMap.personId, ownPersonIds))
    : [{ count: 0 }];
  const [duplicateCandidateCount] = ownPersonIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(duplicateCandidate)
        .where(
          or(
            inArray(duplicateCandidate.personAId, ownPersonIds),
            inArray(duplicateCandidate.personBId, ownPersonIds),
          ),
        )
    : [{ count: 0 }];
  const [mergeEventCount] = ownPersonIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(mergeEvent)
        .where(
          or(inArray(mergeEvent.survivorId, ownPersonIds), inArray(mergeEvent.mergedId, ownPersonIds)),
        )
    : [{ count: 0 }];
  const [auditLogPersonCount] = ownPersonIds.length
    ? await db.select({ count: sql<number>`count(*)` }).from(auditLog).where(inArray(auditLog.personId, ownPersonIds))
    : [{ count: 0 }];

  console.log(`  activity (by person, cascades):     ${personActivityCount?.count ?? 0}`);
  console.log(`  task (by person, cascades):          ${personTaskCount?.count ?? 0}`);
  console.log(`  signal (by person, cascades):        ${personSignalCount?.count ?? 0}`);
  console.log(`  linkedin_scrape_job (cascades):      ${personScrapeJobCount?.count ?? 0}`);
  console.log(`  person_bd_connection (cascades):     ${personBdConnectionCount?.count ?? 0}`);
  console.log(`  person_property_history (cascades):  ${personPropertyHistoryCount?.count ?? 0}`);
  console.log(`  person_id_map (cascades):             ${personIdMapCount?.count ?? 0}`);
  console.log(`  duplicate_candidate (cascades):       ${duplicateCandidateCount?.count ?? 0}`);
  console.log(`  merge_event (cascades):               ${mergeEventCount?.count ?? 0}`);
  console.log(
    `  audit_log.person_id (set null, NOT deleted): ${auditLogPersonCount?.count ?? 0}`,
  );

  // --- 3. The shared `company`/`target_company` entities for EVERY
  // own-company key (not just "Avalith"). ---
  const ownCompanies = OWN_KEYS.length
    ? await db.select({ companyKey: company.companyKey }).from(company).where(inArray(company.companyKey, OWN_KEYS))
    : [];
  const ownTargetCompanies = OWN_KEYS.length
    ? await db
        .select({ companyKey: targetCompany.companyKey })
        .from(targetCompany)
        .where(inArray(targetCompany.companyKey, OWN_KEYS))
    : [];
  const ownCompanyKeysFound = ownCompanies.map((c) => c.companyKey);
  const ownTargetCompanyKeysFound = ownTargetCompanies.map((c) => c.companyKey);

  const [companyScopedActivity] = ownCompanyKeysFound.length
    ? await db.select({ count: sql<number>`count(*)` }).from(activity).where(inArray(activity.companyKey, ownCompanyKeysFound))
    : [{ count: 0 }];
  const [companyScopedTask] = ownCompanyKeysFound.length
    ? await db.select({ count: sql<number>`count(*)` }).from(task).where(inArray(task.companyKey, ownCompanyKeysFound))
    : [{ count: 0 }];
  const [companyScopedSignal] = ownCompanyKeysFound.length
    ? await db.select({ count: sql<number>`count(*)` }).from(signal).where(inArray(signal.companyKey, ownCompanyKeysFound))
    : [{ count: 0 }];
  const [boardCandidateCount] = OWN_KEYS.length
    ? await db.select({ count: sql<number>`count(*)` }).from(boardCandidate).where(inArray(boardCandidate.companyKey, OWN_KEYS))
    : [{ count: 0 }];
  const [companyProbeCount] = OWN_KEYS.length
    ? await db.select({ count: sql<number>`count(*)` }).from(companyProbe).where(inArray(companyProbe.companyKey, OWN_KEYS))
    : [{ count: 0 }];

  console.log(`\nOwn-company keys checked: ${OWN_KEYS.join(", ")}`);
  console.log(`  company rows found:      ${ownCompanyKeysFound.length} (${ownCompanyKeysFound.join(", ") || "none"})`);
  console.log(`  target_company rows found: ${ownTargetCompanyKeysFound.length} (${ownTargetCompanyKeysFound.join(", ") || "none"})`);
  console.log(`  activity (by company):   ${companyScopedActivity?.count ?? 0}`);
  console.log(`  task (by company):       ${companyScopedTask?.count ?? 0}`);
  console.log(`  signal (by company):     ${companyScopedSignal?.count ?? 0}`);
  console.log(`  board_candidate:         ${boardCandidateCount?.count ?? 0}`);
  console.log(`  company_probe:           ${companyProbeCount?.count ?? 0}`);
  console.log(
    "  (job_posting / sync_run / company_alias / company_property_history for these keys cascade automatically via FK, not counted separately)",
  );

  console.log("\nDry-run summary:");
  console.log(`  contact:  ${ownContacts.length}`);
  console.log(`  person:   ${ownPersons.length}`);
  console.log(`  company:  ${ownCompanyKeysFound.length}`);

  if (!APPLY) {
    console.log("\nDry run only — pass --apply --actor=<bd id> to delete.");
    return;
  }

  if (!ownContacts.length && !ownPersons.length && !ownCompanyKeysFound.length && !ownTargetCompanyKeysFound.length) {
    console.log("\nNothing to delete.");
    return;
  }

  await db.transaction(async (tx) => {
    // Legacy contact + its non-cascading dependents.
    if (ownContactIds.length) {
      await tx.delete(linkedinScrapeJob).where(inArray(linkedinScrapeJob.contactId, ownContactIds));
      await tx.delete(signal).where(inArray(signal.contactId, ownContactIds));
      await tx.delete(task).where(inArray(task.contactId, ownContactIds));
      await tx.delete(activity).where(inArray(activity.contactId, ownContactIds));
    }
    if (conversationIds.length) {
      // message rows cascade via message.conversation_id's real FK.
      await tx.delete(conversation).where(inArray(conversation.id, conversationIds));
    }
    if (ownContactIds.length) {
      await tx.delete(contact).where(inArray(contact.id, ownContactIds));
    }

    // person: every dependent (activity/task/signal/linkedin_scrape_job/
    // person_bd_connection/person_property_history/person_id_map/
    // duplicate_candidate/merge_event) has a real FK with onDelete: cascade,
    // so a single delete on `person` is enough.
    if (ownPersonIds.length) {
      await tx.delete(person).where(inArray(person.id, ownPersonIds));
    }

    // board_candidate / company_probe have no FK to company/target_company,
    // so delete explicitly before the rows they reference.
    if (OWN_KEYS.length) {
      await tx.delete(boardCandidate).where(inArray(boardCandidate.companyKey, OWN_KEYS));
      await tx.delete(companyProbe).where(inArray(companyProbe.companyKey, OWN_KEYS));
    }

    // target_company cascades job_posting, sync_run, company_alias.
    if (ownTargetCompanyKeysFound.length) {
      await tx.delete(targetCompany).where(inArray(targetCompany.companyKey, ownTargetCompanyKeysFound));
    }
    // company cascades activity/task/signal/company_property_history scoped
    // to these company_keys.
    if (ownCompanyKeysFound.length) {
      await tx.delete(company).where(inArray(company.companyKey, ownCompanyKeysFound));
    }

    await tx.insert(auditLog).values({
      actorBdId: ACTOR_BD_ID!,
      action: "own_company_cleanup",
      metadata: {
        ownCompanyKeys: OWN_KEYS,
        deletedContactIds: ownContactIds,
        deletedPersonIds: ownPersonIds,
        deletedCompanyKeys: ownCompanyKeysFound,
        deletedTargetCompanyKeys: ownTargetCompanyKeysFound,
      },
    });
  });

  console.log("\nDone. Deleted the rows counted above.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
