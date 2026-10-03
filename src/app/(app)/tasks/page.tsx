import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import {
  getAllOpenTasks,
  getAllOverdueTasks,
  getCompletedTasks,
  getOpenTasks,
  getOverdueTasks,
  getTaskViewCounts,
} from "@/lib/tasks/queries";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { resolveTaskSubject } from "@/lib/tasks/subject";
import { buildTaskBuckets, dueBucketOf } from "@/lib/tasks/taskBuckets";
import { formatTaskDueDate } from "@/lib/tasks/argentinaDate";
import { isTaskView, taskViewTabs, type TaskView } from "@/lib/tasks/viewTabs";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { CompleteTaskButton } from "./CompleteTaskButton";
import { NewTaskButton } from "./NewTaskButton";
import { TaskTitleLink } from "./TaskTitleLink";
import type { EditTaskLabels } from "./EditTaskDialog";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Task = Awaited<ReturnType<typeof getOpenTasks>>[number];
type Dict = Awaited<ReturnType<typeof getDictionary>>["tasksPage"];

/** Maps this page's own dictionary section into the shared EditTaskDialog
 * shape — see that component's doc comment for why every page that mounts
 * it builds its own copy of this object instead of sharing one bundle. */
function pickEditTaskLabels(l: Dict): EditTaskLabels {
  return {
    dialogTitle: l.taskEditDialogTitle,
    fieldTitle: l.taskTitleLabel,
    fieldDue: l.taskDueLabel,
    fieldAssignee: l.taskAssigneeLabel,
    fieldDescription: l.taskDescriptionLabel,
    fieldAssociation: l.taskAssociationLabel,
    associationHelp: l.taskAssociationHelp,
    titleRequiredError: l.taskTitleRequiredError,
    markComplete: l.taskMarkComplete,
    reopenTask: l.taskReopenDialogAction,
    cancel: l.cancel,
    saveChanges: l.taskSaveChanges,
    saving: l.taskSaving,
    saveError: l.taskSaveError,
    genericError: l.genericError,
    completedBadge: l.taskCompletedBadge,
    completedCaptionPrefix: l.taskCompletedCaptionPrefix,
    toastUpdated: l.toastTaskUpdated,
    toastCompleted: l.toastTaskCompleted,
    toastReopened: l.toastTaskReopened,
  };
}

interface TasksPageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const sp = await searchParams;
  const view: TaskView = isTaskView(sp.view) ? sp.view : "mine";

  const me = await getCurrentBd();
  const dict = await getDictionary();
  const l = dict.tasksPage;
  const [counts, ownerOptions] = await Promise.all([getTaskViewCounts(me.id), listOwnerOptions()]);
  const tabs = taskViewTabs(counts, view, {
    mine: l.viewTabMine,
    all: l.viewTabAll,
    done: l.viewTabDone,
  });

  return (
    <main className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>{l.eyebrow}</div>
          <h1 className={styles.title}>{l.title}</h1>
          <p className={styles.subtitle}>{l.subtitle}</p>
        </div>
        <div className="actions">
          <NewTaskButton
            labels={{
              newTask: l.newTask,
              taskCreate: l.taskCreate,
              taskTitleLabel: l.taskTitleLabel,
              taskDescriptionLabel: l.taskDescriptionLabel,
              taskSubjectLabel: l.taskSubjectLabel,
              taskSubjectPlaceholder: l.taskSubjectPlaceholder,
              taskSubjectContactOption: l.taskSubjectContactOption,
              taskSubjectCompanyOption: l.taskSubjectCompanyOption,
              taskSubjectSearching: l.taskSubjectSearching,
              taskSubjectNoResults: l.taskSubjectNoResults,
              taskSubjectRequired: l.taskSubjectRequired,
              taskDueLabel: l.taskDueLabel,
              taskAssigneeLabel: l.taskAssigneeLabel,
              taskCreateError: l.taskCreateError,
              cancel: l.cancel,
            }}
            assigneeOptions={ownerOptions}
            meId={me.id}
          />
        </div>
      </div>

      <nav className="view-tabs" aria-label={l.eyebrow}>
        {tabs.map((tab) => (
          <Link key={tab.key} className={`view-tab${tab.active ? " active" : ""}`} href={tab.href}>
            {tab.label}
            <span className="count">{tab.count}</span>
          </Link>
        ))}
      </nav>

      {view === "done" ? (
        <CompletedTasksView dict={dict} me={me} ownerOptions={ownerOptions} />
      ) : (
        <OpenTasksView view={view} dict={dict} me={me} ownerOptions={ownerOptions} />
      )}
    </main>
  );
}

async function OpenTasksView({
  view,
  dict,
  me,
  ownerOptions,
}: {
  view: Extract<TaskView, "mine" | "all">;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
  ownerOptions: { id: string; name: string }[];
}) {
  const l = dict.tasksPage;
  // Bug fix (task-essentials backlog item 3): "Todas abiertas" used to pass
  // a hardcoded `[]` here, so a teammate's overdue task never showed as
  // overdue on that tab — it simply disappeared (dueBucketOf classifies it
  // as "overdue", which neither the today nor upcoming bucket accepts).
  // Both views now fetch a real, unbounded overdue set the same way.
  const [openTasks, overdueTasks] = await Promise.all([
    view === "mine" ? getOpenTasks(me.id, 100) : getAllOpenTasks(100),
    view === "mine" ? getOverdueTasks(me.id) : getAllOverdueTasks(),
  ]);

  const { todayTasks, upcomingTasks } = buildTaskBuckets(openTasks, overdueTasks);

  const hasAnyTasks =
    overdueTasks.length > 0 || todayTasks.length > 0 || upcomingTasks.length > 0;

  if (!hasAnyTasks) {
    return (
      <div className={styles.emptyState}>
        <p>{view === "mine" ? l.emptyState : l.emptyStateAll}</p>
      </div>
    );
  }

  return (
    <>
      {overdueTasks.length > 0 && (
        <TaskGroup
          title={l.overdueLabel}
          count={overdueTasks.length}
          badgeClass={styles.badgeDanger}
          tasks={overdueTasks}
          dict={dict}
          me={me}
          ownerOptions={ownerOptions}
        />
      )}
      {todayTasks.length > 0 && (
        <TaskGroup
          title={l.todayLabel}
          count={todayTasks.length}
          badgeClass={styles.badgeWarn}
          tasks={todayTasks}
          dict={dict}
          me={me}
          ownerOptions={ownerOptions}
        />
      )}
      {upcomingTasks.length > 0 && (
        <TaskGroup
          title={l.upcomingLabel}
          count={null}
          badgeClass={styles.badgeNeutral}
          tasks={upcomingTasks}
          dict={dict}
          me={me}
          ownerOptions={ownerOptions}
        />
      )}
    </>
  );
}

async function CompletedTasksView({
  dict,
  me,
  ownerOptions,
}: {
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
  ownerOptions: { id: string; name: string }[];
}) {
  const l = dict.tasksPage;
  const completedTasks = await getCompletedTasks(100);

  if (completedTasks.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{l.emptyStateDone}</p>
      </div>
    );
  }

  return (
    <TaskGroup
      title={l.completedLabel}
      count={null}
      badgeClass={styles.badgeNeutral}
      tasks={completedTasks}
      dict={dict}
      me={me}
      ownerOptions={ownerOptions}
    />
  );
}

function TaskGroup({
  title,
  count,
  badgeClass,
  tasks,
  dict,
  me,
  ownerOptions,
}: {
  title: string;
  count: number | null;
  badgeClass: string;
  tasks: Task[];
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
  ownerOptions: { id: string; name: string }[];
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {title}
        {count !== null && <span className={styles.groupBadge}>{count}</span>}
      </h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colCheck}></th>
              <th>{dict.tasksPage.colTask}</th>
              <th>{dict.tasksPage.colSubject}</th>
              <th>{dict.tasksPage.colOwner}</th>
              <th>{dict.tasksPage.colDue}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} dict={dict} me={me} badgeClass={badgeClass} ownerOptions={ownerOptions} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  dict,
  me,
  badgeClass,
  ownerOptions,
}: {
  task: Task;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
  badgeClass: string;
  ownerOptions: { id: string; name: string }[];
}) {
  const l = dict.tasksPage;
  const status = dueBucketOf(task.dueAt);
  const ownerName = task.assignedToName ?? me.name;
  const subject = resolveTaskSubject(task);

  return (
    <tr>
      <td className={styles.colCheck}>
        <CompleteTaskButton taskId={task.id} done={task.status === "done"} ariaLabel={l.completeAria} errorLabel={l.completeError} />
      </td>
      <td>
        <TaskTitleLink
          task={{
            id: task.id,
            title: task.title,
            description: task.description,
            dueAt: task.dueAt,
            assignedToBdId: task.assignedToBdId,
            status: task.status as "open" | "done" | "cancelled",
            personId: task.personId,
            companyKey: task.companyKey,
            associationLabel: subject?.label ?? "—",
          }}
          className={styles.taskTitle}
          assigneeOptions={ownerOptions}
          meId={me.id}
          labels={pickEditTaskLabels(l)}
        />
        {task.description && <p className={styles.taskDescription}>{task.description}</p>}
      </td>
      <td>
        {subject ? <Link href={subject.href}>{subject.label}</Link> : "—"}
      </td>
      <td>
        <span className={styles.ownerChip}>
          <Avatar id={ownerName} initials={initialsFromName(ownerName)} variant="bd" size="sm" />
          {ownerName}
        </span>
      </td>
      <td>
        {task.dueAt ? (
          <span className={badgeClass}>
            {status === "today"
              ? l.dueToday
              : status === "tomorrow"
                ? l.dueTomorrow
                : formatTaskDueDate(new Date(task.dueAt))}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
