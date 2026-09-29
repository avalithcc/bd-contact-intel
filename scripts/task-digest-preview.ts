/**
 * Read-only preview of the 08:30 ART daily task-reminder digest
 * (task-reminders backlog — "Preview without sending"). Renders every BD's
 * digest (subject, group counts) to stdout as JSON without inserting a
 * `task_digest_send` row and without sending anything — same guarantee as
 * the cron route's `?dryRun=1`, as a standalone script so it can be run
 * directly against production with a read-only connection.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/task-digest-preview.ts
 *
 * Never imports src/lib/mailer/smtpMailer.ts or the claim/mark functions in
 * src/lib/tasks/digestQueries.ts — only the batched read and the pure
 * grouping/rendering.
 */
import { argentinaDayBoundaries } from "../src/lib/tasks/argentinaDate";
import { buildDigestEmail, groupDigestTasks } from "../src/lib/tasks/digest";
import { getDigestTasksForAllBds, groupDigestTaskRowsByBd } from "../src/lib/tasks/digestQueries";
import { getSiteUrl } from "../src/lib/config/siteUrl";

async function main() {
  const now = new Date();
  const boundaries = argentinaDayBoundaries(now);
  const siteBaseUrl = getSiteUrl();

  const rows = await getDigestTasksForAllBds(boundaries.tomorrowStartUtc);
  const byBd = groupDigestTaskRowsByBd(rows);

  const preview = [...byBd.entries()].map(([bdId, bdTasks]) => {
    const first = bdTasks[0]!;
    const groups = groupDigestTasks(bdTasks, boundaries);
    const email = buildDigestEmail({ name: first.bdName, email: first.bdEmail }, groups, siteBaseUrl);
    return {
      bdId,
      bdEmail: first.bdEmail,
      bdName: first.bdName,
      wouldSend: email !== null,
      subject: email?.subject ?? null,
      counts: {
        today: groups.today.length,
        overdue: groups.overdue.length,
        yesterday: groups.yesterday.length,
      },
    };
  });

  console.log(JSON.stringify({ date: boundaries.today, dryRun: true, preview }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
