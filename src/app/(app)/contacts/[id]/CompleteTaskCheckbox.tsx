"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { completedToastMessage } from "@/lib/tasks/completedToastMessage";
import { setTaskStatusAction } from "../../tasks/actions";
import { completeContactTaskAction } from "../actions";

/**
 * "Completar tarea" checkbox (mockup-port r05; contact-record.html:181's
 * right-panel Tareas card — a checkbox, unlike the timeline's "Próximas"
 * card which uses a button, CompleteTaskButton.tsx). Same underlying action.
 *
 * Completing shows a toast naming the task with "Deshacer", because the
 * row leaves the list on refresh and the next click would land on a
 * different task. Undo reopens through `setTaskStatusAction`, which
 * authorizes and revalidates by the task's own subject (the same write path
 * the complete action uses); `router.refresh()` then brings the row back
 * even for a task whose subject is not this record. The handler may run
 * after this row has unmounted: its setState is then a no-op and the
 * refreshed list remounts the row unchecked. Checked state is controlled so
 * a still-mounted instance unchecks on undo.
 */
export function CompleteTaskCheckbox({
  taskId,
  personId,
  title,
  ariaLabel,
  errorLabel,
  completedLabel,
  undoLabel,
  undoErrorLabel,
}: {
  taskId: string;
  personId: string;
  title: string;
  ariaLabel: string;
  errorLabel: string;
  completedLabel: string;
  undoLabel: string;
  undoErrorLabel: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const undo = async () => {
    try {
      await setTaskStatusAction(taskId, "open");
      setBusy(false);
      router.refresh();
    } catch {
      showToast(undoErrorLabel, "error");
    }
  };

  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={busy}
      disabled={busy}
      onChange={async () => {
        setBusy(true);
        const result = await completeContactTaskAction(taskId, personId);
        if (result.ok) {
          router.refresh();
          showToast(completedToastMessage(completedLabel, title), "success", {
            actionLabel: undoLabel,
            onAction: undo,
          });
        } else {
          setBusy(false);
          showToast(errorLabel, "error");
        }
      }}
    />
  );
}
