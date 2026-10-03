"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DoneButton } from "@/components/DoneButton";
import { useToast } from "@/components/ToastProvider";
import { completedToastMessage } from "@/lib/tasks/completedToastMessage";
import { setTaskStatusAction } from "../../tasks/actions";
import { completeContactTaskAction } from "../actions";

/**
 * "Completar tarea" button (mockup-port r05; contact-record.html:181's
 * right-panel Tareas card; task-complete-affordance turned it from a checkbox
 * into the shared DoneButton). The timeline's "Próximas" card uses a labelled
 * `btn` instead, CompleteTaskButton.tsx. Same underlying action.
 *
 * Completing shows a toast naming the task with "Deshacer", because the
 * row leaves the list on refresh and the next click would land on a
 * different task. Undo reopens through `setTaskStatusAction`, which
 * authorizes and revalidates by the task's own subject (the same write path
 * the complete action uses); `router.refresh()` then brings the row back
 * even for a task whose subject is not this record. The handler may run
 * after this row has unmounted: its setState is then a no-op and the
 * refreshed list remounts the row at rest. The done state is controlled so
 * a still-mounted instance resets on undo.
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
    <DoneButton
      done={busy}
      label={ariaLabel}
      onClick={async () => {
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
