/**
 * Owner-run removal of Google Calendar's event sender, calendar-notification@google.com,
 * which is not a contact: the Gmail sync kept filing every calendar notification
 * against a fake person ("Calendar Notification", status 'replied'), so it read as
 * an engaged lead. The owner decided it goes.
 *
 * STEP 1, STOP FUTURE NOISE: one email_never_log rule (kind 'address') for every BD
 * that can sync, taken from getSyncableAccounts (the exact eligibility rule the cron
 * uses), written through addNeverLogEntry (on conflict do nothing, so re-running is
 * safe). The rule is per BD, hence one row each. TRADE-OFF, intended here: a
 * never-log rule suppresses the WHOLE message when ANY From/To/Cc participant
 * matches (src/lib/gmail/classify.ts). So a calendar invite that also CC'd a real
 * contact is dropped entirely, not just unlinked from the robot. A BD who connects
 * Gmail after this run is not covered by the rule; with the person gone nothing
 * matches the address anyway, the rule is the second line of defense.
 *
 * STEP 2, REMOVE THE FAKE CONTACT: the person is found BY EMAIL (case-insensitive),
 * never by id. Zero or more than one match refuses. Deleting it CASCADES (verified
 * in pg_constraint): activity, email_message_person, task, meeting, scheduled_email,
 * signal, linkedin_scrape_job, follow_up_queue_item, person_bd_connection,
 * person_id_map, person_property_history, lusha_reveal, duplicate_candidate,
 * merge_event. email_message.person_id is SET NULL: the received mail STAYS, only
 * unlinked. sequence_member is NO ACTION: membership refuses the run. The dry run
 * prints every one of those counts.
 *
 * ONE transaction under the identity lock, ONE audit_log row (action
 * 'suppress_calendar_notification'). REVERT: metadata.deletedPerson is the full
 * person row (re-INSERT it, same id); delete the email_never_log rows for
 * metadata.addedRuleBdIds. Cascaded activities and join rows are not restorable
 * (they were notification noise; the email_message rows remain).
 *
 * DRY RUN IS THE DEFAULT (read-only transaction). Counts only. Usage (do NOT run
 * --execute without the owner's approval):
 *   npx tsx --env-file=.env.local scripts/suppress-calendar-notification.ts
 *   npx tsx --env-file=.env.local scripts/suppress-calendar-notification.ts --execute --actor=<bd id>
 *
 * EXIT CODES: 0 success (dry run or write); 1 bad arguments or a refusal (nothing written).
 */
import { dryRunSuppress, executeSuppress } from "../src/lib/calendarNotification/db";
import { parseSuppressArgs, type CalendarPlan } from "../src/lib/calendarNotification/plan";

function report(plan: CalendarPlan): string {
  if (plan.kind === "refuse") return `REFUSED: ${plan.reason}`;
  const b = plan.blast;
  return [
    "Person found by email: 1",
    `never-log rules to ADD: ${plan.addRuleBdIds.length} (already present: ${plan.alreadyRuledBdIds.length}) on the syncing BDs`,
    "Deleting the person CASCADES:",
    `    activity: ${b.activities}  ${JSON.stringify(b.activityTypes)}`,
    `    email_message_person: ${b.emailMessagePersonRows}`,
    `    task: ${b.tasks}, meeting: ${b.meetings}, scheduled_email: ${b.scheduledEmails}, signal: ${b.signals}`,
    `    linkedin_scrape_job: ${b.linkedinScrapeJobs}, follow_up_queue_item: ${b.followUpQueueItems}, person_bd_connection: ${b.personBdConnections}`,
    `    person_id_map: ${b.personIdMaps}, person_property_history: ${b.propertyHistoryRows}, lusha_reveal: ${b.lushaReveals}`,
    `    duplicate_candidate: ${b.duplicateCandidates}, merge_event: ${b.mergeEvents}`,
    `email_message rows that SURVIVE (person_id set null): ${b.survivingEmailMessages}`,
  ].join("\n");
}

async function main() {
  const { execute, actor } = parseSuppressArgs(process.argv.slice(2));
  if (!execute) {
    console.log("DRY RUN (read-only transaction)\n");
    const plan = await dryRunSuppress();
    console.log(report(plan));
    if (plan.kind === "refuse") process.exitCode = 1;
    else console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }
  const { plan, auditLogId } = await executeSuppress(actor!);
  console.log(report(plan));
  if (plan.kind === "refuse") process.exitCode = 1;
  else console.log(`\nDone. audit_log id: ${auditLogId}`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
