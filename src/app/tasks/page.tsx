import { getCurrentBd } from "@/lib/queries";
import { getOpenTasks, getOverdueTasks } from "@/lib/tasks/queries";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const me = await getCurrentBd();
  const [openTasks, overdueTasks] = await Promise.all([
    getOpenTasks(me.id, 100),
    getOverdueTasks(me.id),
  ]);

  const hasOverdue = overdueTasks.length > 0;
  const urgentTasks = hasOverdue ? overdueTasks : [];

  return (
    <main>
      <div className={styles.header}>
        <h1>Tasks</h1>
        <p className={styles.subtitle}>Manage your work items</p>
      </div>

      {hasOverdue && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            🔴 Overdue ({urgentTasks.length})
          </h2>
          <div className={styles.tasksList}>
            {urgentTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          📋 Open Tasks ({openTasks.length})
        </h2>
        {openTasks.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No open tasks — great job! 🎉</p>
          </div>
        ) : (
          <div className={styles.tasksList}>
            {openTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function TaskCard({ task }: { task: any }) {
  const getDueStatus = () => {
    if (!task.dueAt) return null;
    const daysUntilDue = Math.ceil(
      (new Date(task.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (daysUntilDue < 0) return "overdue";
    if (daysUntilDue === 0) return "today";
    if (daysUntilDue === 1) return "tomorrow";
    if (daysUntilDue <= 7) return "this-week";
    return null;
  };

  const dueStatus = getDueStatus();

  return (
    <div className={`${styles.taskCard} ${styles[`status-${dueStatus}`]}`}>
      <div className={styles.taskContent}>
        <h3 className={styles.taskTitle}>{task.title}</h3>
        {task.description && (
          <p className={styles.taskDescription}>{task.description}</p>
        )}
        <div className={styles.taskMeta}>
          {task.assignedToName && (
            <span className={styles.assignee}>
              👤 {task.assignedToName}
            </span>
          )}
          {task.dueAt && (
            <span className={styles.dueDate}>
              📅 {formatDistanceToNow(new Date(task.dueAt), {
                addSuffix: true,
                locale: es,
              })}
            </span>
          )}
          {task.leadId && (
            <span className={styles.subject}>
              🔗 Lead
            </span>
          )}
          {task.companyKey && (
            <span className={styles.subject}>
              🏢 Company
            </span>
          )}
        </div>
      </div>
      <button className={styles.completeButton} aria-label="Mark complete">
        ✓
      </button>
    </div>
  );
}
