/**
 * Pure tab list behind /tasks's view tabs (mockup-port t03; tasks.html
 * `.view-tabs`): "Mis tareas abiertas" (default), "Todas abiertas" and
 * "Completadas". An earlier reskin dropped these three tabs entirely —
 * this keeps the tab shape/order/hrefs in one tested place instead of
 * inlining it in the page component. Labels are passed in by the caller
 * (from the i18n dictionary, same convention as src/lib/contacts/viewTabs.ts)
 * rather than hardcoded here.
 */
import type { TaskViewCounts } from "@/lib/tasks/queries";

export const TASK_VIEWS = ["mine", "all", "done"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export function isTaskView(value: string | undefined): value is TaskView {
  return TASK_VIEWS.includes(value as TaskView);
}

export interface TaskViewTabLabels {
  mine: string;
  all: string;
  done: string;
}

export interface TaskViewTab {
  key: TaskView;
  label: string;
  href: string;
  count: number;
  active: boolean;
}

export function taskViewTabs(counts: TaskViewCounts, active: TaskView, labels: TaskViewTabLabels): TaskViewTab[] {
  return [
    { key: "mine", label: labels.mine, href: "/tasks?view=mine", count: counts.mine, active: active === "mine" },
    { key: "all", label: labels.all, href: "/tasks?view=all", count: counts.all, active: active === "all" },
    { key: "done", label: labels.done, href: "/tasks?view=done", count: counts.completed, active: active === "done" },
  ];
}
