import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import {
  getAllOpenTasks,
  getCompletedTasks,
  getOpenTasks,
  getOverdueTasks,
  getTaskViewCounts,
} from "@/lib/tasks/queries";
import { resolveTaskSubject } from "@/lib/tasks/subject";
import { isTaskView, taskViewTabs, type TaskView } from "@/lib/tasks/viewTabs";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { CompleteTaskButton } from "./CompleteTaskButton";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Task = Awaited<ReturnType<typeof getOpenTasks>>[number];
type Dict = Awaited<ReturnType<typeof getDictionary>>["tasksPage"];

interface TasksPageProps {
  searchParams: Promise<{ view?: string }>;
}

// Presentation-only grouping (mockup-parity 6.2): the mockup groups tasks
// into vencidas/hoy/próximas within a single table pattern. The queries
// still only fetch "overdue" and "open" (design D-unchanged) — we just
// split the "open" set into today/upcoming client-side using the same
// due-date math the old card view already used, so query/filter behavior
// is unchanged.
function dueStatus(task: Task): "overdue" | "today" | "tomorrow" | "week" | null {
  if (!task.dueAt) return null;
  const daysUntilDue = Math.ceil(
    (new Date(task.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue === 0) return "today";
  if (daysUntilDue === 1) return "tomorrow";
  return "week";
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const sp = await searchParams;
  const view: TaskView = isTaskView(sp.view) ? sp.view : "mine";

  const me = await getCurrentBd();
  const dict = await getDictionary();
  const l = dict.tasksPage;
  const counts = await getTaskViewCounts(me.id);
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
          <a className="btn btn-primary" href="#">
            {l.newTask}
          </a>
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
        <CompletedTasksView dict={dict} me={me} />
      ) : (
        <OpenTasksView view={view} dict={dict} me={me} />
      )}
    </main>
  );
}

async function OpenTasksView({
  view,
  dict,
  me,
}: {
  view: Extract<TaskView, "mine" | "all">;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
}) {
  const l = dict.tasksPage;
  const [openTasks, overdueTasks] = await Promise.all([
    view === "mine" ? getOpenTasks(me.id, 100) : getAllOpenTasks(100),
    view === "mine" ? getOverdueTasks(me.id) : [],
  ]);

  const todayTasks = openTasks.filter((t) => dueStatus(t) === "today");
  const upcomingTasks = openTasks.filter((t) => {
    const status = dueStatus(t);
    return status === "tomorrow" || status === "week" || status === null;
  });

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
        />
      )}
    </>
  );
}

async function CompletedTasksView({
  dict,
  me,
}: {
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
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
}: {
  title: string;
  count: number | null;
  badgeClass: string;
  tasks: Task[];
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
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
              <TaskRow key={task.id} task={task} dict={dict} me={me} badgeClass={badgeClass} />
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
}: {
  task: Task;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  me: Awaited<ReturnType<typeof getCurrentBd>>;
  badgeClass: string;
}) {
  const l = dict.tasksPage;
  const status = dueStatus(task);
  const ownerName = task.assignedToName ?? me.name;
  const subject = resolveTaskSubject(task);

  return (
    <tr>
      <td className={styles.colCheck}>
        <CompleteTaskButton taskId={task.id} ariaLabel={l.completeAria} errorLabel={l.completeError} />
      </td>
      <td>
        <span className={styles.taskTitle}>{task.title}</span>
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
                : new Date(task.dueAt).toLocaleDateString("es-AR", {
                    day: "numeric",
                    month: "short",
                  })}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
