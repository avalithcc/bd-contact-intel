"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditTaskDialog, type EditableTask, type EditTaskLabels } from "./EditTaskDialog";

/**
 * The task title as the click target that opens the "Editar tarea" dialog
 * (task-edit change, mockup decision 1) — used from /tasks rows and from
 * the contact/company record's Tareas card. The checkbox next to it (a
 * sibling element, not rendered here) still completes the task in place
 * without opening anything.
 */
export function TaskTitleLink({
  task,
  className,
  assigneeOptions,
  meId,
  labels,
}: {
  task: EditableTask;
  className?: string;
  assigneeOptions: { id: string; name: string }[];
  meId: string;
  labels: EditTaskLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`btn-text-reset${className ? ` ${className}` : ""}`}
        onClick={() => setOpen(true)}
      >
        {task.title}
      </button>
      {open && (
        <EditTaskDialog
          task={task}
          assigneeOptions={assigneeOptions}
          meId={meId}
          labels={labels}
          onClose={() => setOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
