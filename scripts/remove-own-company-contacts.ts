/**
 * Removes Avalith's own coworkers from the system, plus everything that
 * references them.
 *
 * Product decision: a BD's LinkedIn export naturally includes their Avalith
 * coworkers alongside their real network. Coworkers are not relevant to
 * this BD-contact-intelligence system and must be excluded entirely — see
 * src/lib/ownCompany.ts (the single source of truth for "is this Avalith
 * itself") and src/lib/queries.ts#upsertContacts, which now skips these rows
 * at import time. This script is the one-time cleanup for rows that were
 * imported before that guard existed.
 *
 * Two independent things get removed:
 *
 * 1. Every `contact` row whose `company` matches Avalith (any BD, any
 *    spelling), plus every row that references that contact by id but has
 *    no DB-level foreign key to cascade automatically:
 *      - linkedin_scrape_job (contact_id)
 *      - signal (contact_id)
 *      - task (contact_id)
 *      - activity (contact_id)
 *      - conversation (bd_id + peer_profile_key), which cascades its own
 *        `message` rows via the real `message.conversation_id` FK.
 *
 * 2. The shared `company`/`target_company` "Avalith" entity, if a BD ever
 *    created one — plus rows that reference it WITHOUT a DB-level FK:
 *      - board_candidate (company_key)
 *      - company_probe (company_key)
 *    (activity/task/signal for company_key='avalith', job_posting, sync_run
 *    and company_alias all cascade automatically via real FKs when the
 *    `company` / `target_company` rows are deleted.)
 *
 * Defaults to a DRY RUN that only prints counts per table. Pass --apply to
 * actually delete, inside a single transaction, deepest-dependency-first.
 *
 * Usage:
 *   npx tsx scripts/remove-own-company-contacts.ts            # dry run
 *   npx tsx scripts/remove-own-company-contacts.ts --apply    # deletes
 *
 * Requires DATABASE_URL to be set (see .env). Never run --apply against
 * production without a fresh backup — this is a destructive, irreversible
 * cleanup.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  activity,
  boardCandidate,
  company,
  companyProbe,
  contact,
  conversation,
  linkedinScrapeJob,
  signal,
  targetCompany,
  task,
} from "../src/db/schema";
import { ownCompanyMatchReason } from "../src/lib/ownCompany";
import { splitEmail } from "../src/lib/emailPatterns";
import { normalizeCompanyKey } from "../src/lib/companyCategories";

const APPLY = process.argv.includes("--apply");
const AVALITH_KEY = normalizeCompanyKey("Avalith");

async function main() {
  // --- 1. Find every own-company contact, across every BD. Matched either
  // by `company` name or, when that's blank/unrecognizable, by the domain
  // of `email` — see src/lib/ownCompany.ts#ownCompanyMatchReason. ---
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

  console.log(`Found ${ownContacts.length} own-company contact(s) out of ${contacts.length} total.`);
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
  let conversationIds: string[] = [];
  let conversationCount = 0;
  let messageCount = 0;
  for (const pair of peerPairs) {
    const rows = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        sql`${conversation.bdId} = ${pair.bdId} AND ${conversation.peerProfileKey} = ${pair.peerProfileKey}`,
      );
    conversationIds.push(...rows.map((r) => r.id));
  }
  conversationCount = conversationIds.length;
  if (conversationCount) {
    const [msgCount] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM message WHERE conversation_id IN (${sql.join(
        conversationIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    messageCount = msgCount?.count ?? 0;
  }

  // --- 2. Find the shared "Avalith" company / target_company entities. ---
  const [avalithCompany] = await db
    .select({ companyKey: company.companyKey })
    .from(company)
    .where(eq(company.companyKey, AVALITH_KEY));
  const [avalithTargetCompany] = await db
    .select({ companyKey: targetCompany.companyKey })
    .from(targetCompany)
    .where(eq(targetCompany.companyKey, AVALITH_KEY));

  const [companyScopedActivity] = avalithCompany
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(activity)
        .where(eq(activity.companyKey, AVALITH_KEY))
    : [{ count: 0 }];
  const [companyScopedTask] = avalithCompany
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(task)
        .where(eq(task.companyKey, AVALITH_KEY))
    : [{ count: 0 }];
  const [companyScopedSignal] = avalithCompany
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(signal)
        .where(eq(signal.companyKey, AVALITH_KEY))
    : [{ count: 0 }];
  const [boardCandidateCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(boardCandidate)
    .where(eq(boardCandidate.companyKey, AVALITH_KEY));
  const [companyProbeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(companyProbe)
    .where(eq(companyProbe.companyKey, AVALITH_KEY));

  console.log("\nDry-run counts:");
  console.log(`  contact:                 ${ownContacts.length}`);
  console.log(`  linkedin_scrape_job:     ${scrapeJobCount?.count ?? 0}`);
  console.log(`  signal (by contact):     ${signalCount?.count ?? 0}`);
  console.log(`  task (by contact):       ${taskCount?.count ?? 0}`);
  console.log(`  activity (by contact):   ${activityCount?.count ?? 0}`);
  console.log(`  conversation:            ${conversationCount}`);
  console.log(`  message (via cascade):   ${messageCount}`);
  console.log(`  company row "avalith":   ${avalithCompany ? 1 : 0}`);
  console.log(`  target_company "avalith":${avalithTargetCompany ? 1 : 0}`);
  console.log(`  activity (by company):   ${companyScopedActivity?.count ?? 0}`);
  console.log(`  task (by company):       ${companyScopedTask?.count ?? 0}`);
  console.log(`  signal (by company):     ${companyScopedSignal?.count ?? 0}`);
  console.log(`  board_candidate:         ${boardCandidateCount?.count ?? 0}`);
  console.log(`  company_probe:           ${companyProbeCount?.count ?? 0}`);
  console.log(
    "  (job_posting / sync_run / company_alias for target_company \"avalith\" cascade automatically via FK, not counted separately)",
  );

  if (!APPLY) {
    console.log("\nDry run only — pass --apply to delete.");
    return;
  }

  if (!ownContacts.length && !avalithCompany && !avalithTargetCompany) {
    console.log("\nNothing to delete.");
    return;
  }

  await db.transaction(async (tx) => {
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

    // board_candidate / company_probe have no FK to company/target_company,
    // so delete explicitly before the rows they reference.
    await tx.delete(boardCandidate).where(eq(boardCandidate.companyKey, AVALITH_KEY));
    await tx.delete(companyProbe).where(eq(companyProbe.companyKey, AVALITH_KEY));

    // target_company cascades job_posting, sync_run, company_alias.
    if (avalithTargetCompany) {
      await tx.delete(targetCompany).where(eq(targetCompany.companyKey, AVALITH_KEY));
    }
    // company cascades activity/task/signal scoped to this company_key.
    if (avalithCompany) {
      await tx.delete(company).where(eq(company.companyKey, AVALITH_KEY));
    }
  });

  console.log("\nDone. Deleted the rows counted above.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
