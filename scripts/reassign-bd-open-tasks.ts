/**
 * Owner-operated TASK HANDOVER for a BD who left the company: their OPEN
 * tasks move to a BD who can actually do them.
 *
 * Fourth and last step of offboarding, after revoke-bd-access.ts (blocks the
 * login), disconnect-bd-mailbox.ts (stops the Gmail sync) and
 * release-bd-ownership.ts (frees the book of business to no owner).
 *
 * WHY TASKS ARE HANDED OVER AND NOT RELEASED, unlike contacts and companies:
 * `task.assigned_to_bd_id` is nullable in the schema, but the product never
 * produces NULL — a blank assignee means "assign it to me"
 * (src/lib/tasks/assignee.ts#resolveTaskAssignee). Nulling them would be
 * strictly worse than leaving them: /tasks offers no "unassigned" filter, so
 * they become unfindable, AND the list renders a null assignee as the
 * VIEWER'S OWN NAME (`task.assignedToName ?? me.name`,
 * src/app/(app)/tasks/page.tsx) — every viewer would see them as their own.
 * A task needs a person, so it gets one.
 *
 * ONLY `status = 'open'` MOVES. On a finished task, `assigned_to_bd_id` is
 * not a to-do pointer, it is the RECORD OF WHO DID THE WORK. Moving it would
 * credit the new assignee with work they never did and shift every per-BD
 * completion count. Done and cancelled tasks keep pointing at the departing
 * BD on purpose (src/lib/tasks/reassignOnOffboard.ts).
 *
 * EVERY MOVE IS LOGGED. Project rule: any BD may edit any task, but every
 * change must write an `activity` row naming the actor
 * (src/lib/tasks/updateWithActivity.ts). This writes the SAME `task_updated`
 * row the "Editar tarea" dialog writes, built by the same
 * diffTaskEdit/buildTaskActivityRow pair, so the handover reads in each
 * contact's timeline exactly like a human reassignment — because that is
 * what it is.
 *
 * PROOF, NOT TRUST: after the transaction commits the script reads back from
 * the database how many open tasks still point at the departing BD, how many
 * activity rows this run actually wrote, and how many of their FINISHED tasks
 * are still theirs, and refuses to claim success unless all three are right.
 *
 * REVERSIBLE: each activity row's `metadata.changes` carries the previous
 * assignee's name, and the previous assignee id is the departing BD.
 *
 * IDEMPOTENT: a second run finds nothing open to move and exits 0.
 *
 * Exit codes:
 *   0 = tasks moved (or nothing to move) AND the audit_log row was written
 *   1 = nothing changed — bad arguments or an unresolved BD
 *   2 = tasks WERE moved but the read-back or the audit insert failed
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/reassign-bd-open-tasks.ts --from=<email> --to=<email>
 *   npx tsx --env-file=.env scripts/reassign-bd-open-tasks.ts --from=<email> --to=<email> --execute --actor=<bd id>
 *
 * Needs only DATABASE_URL (.env). Never prints the connection string.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { activity, auditLog, bd, task } from "../src/db/schema";
import { AUDIT_LOG_ID_CAP } from "../src/lib/contacts/bulkOwnerAudit";
import { listOwnerOptionsFresh } from "../src/lib/contacts/bulkOwnerDb";
import { recomputePersonStatus } from "../src/lib/status/recompute";
import { formatTaskDueDate } from "../src/lib/tasks/argentinaDate";
import { buildTaskActivityRow } from "../src/lib/tasks/taskActivityBody";
import { diffTaskEdit, type TaskEditSnapshot } from "../src/lib/tasks/taskEditDiff";
import {
  REASSIGNABLE_TASK_STATUS,
  selectReassignableTasks,
  verifyTaskReassignment,
} from "../src/lib/tasks/reassignOnOffboard";

export const TASK_HANDOVER_AUDIT_ACTION = "bd_open_tasks_reassigned";

type Args = { from?: string; to?: string; execute: boolean; actor?: string };

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { execute: false };
  for (const arg of argv) {
    if (arg === "--execute") out.execute = true;
    else if (arg.startsWith("--from=")) out.from = arg.slice("--from=".length).trim();
    else if (arg.startsWith("--to=")) out.to = arg.slice("--to=".length).trim();
    else if (arg.startsWith("--actor=")) out.actor = arg.slice("--actor=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function formatDueAtOrNull(dueAt: Date | null): string | null {
  return dueAt ? formatTaskDueDate(dueAt) : null;
}

async function resolveBd(email: string) {
  const [row] = await db
    .select({ id: bd.id, name: bd.name, email: bd.email })
    .from(bd)
    .where(sql`lower(${bd.email}) = lower(${email})`)
    .limit(1);
  return row ?? null;
}

async function countTasks(bdId: string, status: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(task)
    .where(and(eq(task.assignedToBdId, bdId), eq(task.status, status)));
  return rows[0]?.n ?? 0;
}

/** Activity rows this run wrote, counted by actor + time so it never credits an older edit. */
async function countActivitiesSince(actorBdId: string, since: Date, taskIds: readonly string[]): Promise<number> {
  if (!taskIds.length) return 0;
  const rows = await db
    .select({ n: sql<number>`count(distinct ${activity.metadata}->>'taskId')::int` })
    .from(activity)
    .where(
      and(
        eq(activity.type, "task_updated"),
        eq(activity.actorBdId, actorBdId),
        sql`${activity.createdAt} >= ${since.toISOString()}::timestamptz`,
        sql`${activity.metadata}->>'taskId' in (${sql.join(taskIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );
  return rows[0]?.n ?? 0;
}

async function executeHandover(params: {
  actorBdId: string;
  from: { id: string; name: string; email: string };
  to: { id: string; name: string; email: string };
}) {
  const { actorBdId, from, to } = params;
  const startedAt = new Date();

  const options = await listOwnerOptionsFresh();
  const nameById = new Map(options.map((o) => [o.id, o.name]));
  const nameOf = (bdId: string | null) => (bdId ? (nameById.get(bdId) ?? null) : null);

  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(task).where(eq(task.assignedToBdId, from.id)).for("update");
    const { move, keep } = selectReassignableTasks(rows);
    if (!move.length) return { movedIds: [] as string[], kept: keep.length };

    await tx
      .update(task)
      .set({ assignedToBdId: to.id, updatedAt: new Date() })
      .where(inArray(task.id, move.map((t) => t.id)));

    for (const current of move) {
      const before: TaskEditSnapshot = {
        title: current.title,
        dueAt: current.dueAt,
        assignedToBdId: current.assignedToBdId,
        description: current.description,
      };
      const after: TaskEditSnapshot = { ...before, assignedToBdId: to.id };
      const changes = diffTaskEdit(before, after, formatDueAtOrNull, nameOf);
      await tx.insert(activity).values(
        buildTaskActivityRow("task_updated", current, actorBdId, {
          taskId: current.id,
          taskTitle: current.title,
          changes,
        }),
      );
      // Same contract every other task write follows: an activity insert
      // recomputes the subject's status in its own transaction. `task_updated`
      // is not a contact touch (deriveStatus.ts has no case for it), so this
      // is a no-op today — kept so a future status rule cannot diverge here
      // silently.
      if (current.personId) await recomputePersonStatus(tx, current.personId);
    }

    await tx.insert(auditLog).values({
      actorBdId,
      action: TASK_HANDOVER_AUDIT_ACTION,
      targetBdId: from.id,
      metadata: {
        fromEmail: from.email,
        fromName: from.name,
        toBdId: to.id,
        toEmail: to.email,
        toName: to.name,
        movedCount: move.length,
        keptCount: keep.length,
        taskIds: move.map((t) => t.id).slice(0, AUDIT_LOG_ID_CAP),
        truncated: move.length > AUDIT_LOG_ID_CAP,
        note:
          `Open tasks of a BD who left the company were reassigned. Only status '${REASSIGNABLE_TASK_STATUS}' moved: on a ` +
          "finished task the assignee is the record of WHO DID THE WORK, so done and cancelled tasks still point at " +
          "the departing BD on purpose. Each moved task got the same 'task_updated' activity row the Editar tarea " +
          "dialog writes, naming this actor, so the handover is visible in each contact's timeline.",
      },
    });

    return { movedIds: move.map((t) => t.id), kept: keep.length };
  });

  const [remainingOpen, doneLeftAlone, activitiesWritten] = await Promise.all([
    countTasks(from.id, REASSIGNABLE_TASK_STATUS),
    countTasks(from.id, "done"),
    countActivitiesSince(actorBdId, startedAt, result.movedIds),
  ]);

  return { moved: result.movedIds.length, kept: result.kept, remainingOpen, doneLeftAlone, activitiesWritten };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from || !args.to) {
    throw new Error(
      "Usage: npx tsx --env-file=.env scripts/reassign-bd-open-tasks.ts --from=<email> --to=<email> [--execute --actor=<bd id>]",
    );
  }
  if (args.execute && !args.actor) throw new Error("--execute requires --actor=<bd id> for the audit log");

  const [from, to] = await Promise.all([resolveBd(args.from), resolveBd(args.to)]);
  if (!from) {
    console.error(`No bd row with email ${args.from}.`);
    process.exitCode = 1;
    return;
  }
  if (!to) {
    console.error(`No bd row with email ${args.to}.`);
    process.exitCode = 1;
    return;
  }
  if (from.id === to.id) {
    console.error("--from and --to are the same BD. Nothing to do.");
    process.exitCode = 1;
    return;
  }

  const rows = await db
    .select({ status: task.status, dueAt: task.dueAt })
    .from(task)
    .where(eq(task.assignedToBdId, from.id));
  const { move, keep } = selectReassignableTasks(rows);
  const overdue = move.filter((t) => t.dueAt && t.dueAt.getTime() < Date.now()).length;
  const doneBefore = keep.filter((t) => t.status === "done").length;

  console.log(`From: ${from.name} <${from.email}>`);
  console.log(`To:   ${to.name} <${to.email}> (bd id ${to.id})\n`);
  console.log(`Would move  ${move.length} open task(s) (${overdue} already overdue), each with its own task_updated activity.`);
  console.log(`Would keep  ${keep.length} finished/cancelled task(s) pointing at ${from.name}:`);
  console.log("            on a finished task the assignee is the record of WHO DID THE WORK.");

  if (!args.execute) {
    console.log("\nDry run only. Nothing was changed.");
    console.log("Re-run with --execute --actor=<bd id> to hand the open tasks over.");
    return;
  }
  if (!move.length) {
    console.log("\nNothing open to move. Exiting without writing.");
    return;
  }

  console.log(`\nHanding ${move.length} open task(s) over to ${to.name} (actor bd id ${args.actor})...`);
  // Anything that throws from here on happens AFTER the write transaction has
  // committed, so it must report exit 2 ("moved but not proven"), never the
  // exit 1 that means nothing changed.
  let result: Awaited<ReturnType<typeof executeHandover>>;
  try {
    result = await executeHandover({ actorBdId: args.actor!, from, to });
  } catch (err) {
    console.error(
      `\nHANDOVER NOT PROVEN: ${err instanceof Error ? err.message : String(err)}\n` +
        "The write transaction may already have committed. Re-run the dry run to see the real state before retrying.",
    );
    process.exitCode = 2;
    return;
  }

  const verdict = verifyTaskReassignment({
    moved: result.moved,
    remainingOpen: result.remainingOpen,
    activitiesWritten: result.activitiesWritten,
    doneLeftAlone: result.doneLeftAlone,
    doneBefore,
  });
  console.log(`\nMoved ${result.moved} open task(s); ${result.kept} finished/cancelled left with ${from.name}.`);
  console.log(
    `Read-back: ${result.remainingOpen} open task(s) still theirs, ${result.activitiesWritten} activity row(s) ` +
      `written by this run, ${result.doneLeftAlone} of ${doneBefore} finished task(s) still theirs.`,
  );
  if (!verdict.ok) {
    console.error(`\nHANDOVER NOT PROVEN: ${verdict.problem}`);
    process.exitCode = 2;
    return;
  }
  console.log(`Verified. One audit_log row written (action: ${TASK_HANDOVER_AUDIT_ACTION}).`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
