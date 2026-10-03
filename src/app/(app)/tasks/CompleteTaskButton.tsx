"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { completedToastMessage } from "@/lib/tasks/completedToastMessage";
import { setTaskStatusAction } from "./actions";
import styles from "./page.module.css";

/**
 * Controlled so the checkbox only stays checked once the server action
 * succeeds: while saving it shows checked and disabled, on success it stays
 * that way until revalidation removes the row, and on failure it unchecks
 * and reports the error as a toast.
 *
 * `done` is the task's real status: a task that is already done starts
 * checked and disabled, so the "Completadas" tab shows it as done and a click
 * cannot ask for a second completion.
 */
export function CompleteTaskButton({
  taskId,
  title,
  done = false,
  ariaLabel,
  errorLabel,
  completedLabel,
  undoLabel,
  undoErrorLabel,
}: {
  taskId: string;
  title: string;
  done?: boolean;
  ariaLabel: string;
  errorLabel: string;
  completedLabel: string;
  undoLabel: string;
  undoErrorLabel: string;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<"idle" | "saving" | "done">(done ? "done" : "idle");

  const handleChange = async () => {
    setState("saving");
    try {
      await setTaskStatusAction(taskId, "done");
      setState("done");
    } catch {
      setState("idle");
      showToast(errorLabel, "error");
      return;
    }
    showToast(completedToastMessage(completedLabel, title), "success", { actionLabel: undoLabel, onAction: handleUndo });
  };

  /**
   * Runs from a toast whose row has usually been unmounted by revalidation,
   * so this closure may belong to a dead instance (setState there is a safe
   * no-op; the remounted row starts idle from the refreshed `done` prop).
   * Defensive guard, not a live case: every list that renders this button
   * only holds open rows (done rows render disabled and never toast), so
   * revalidation normally unmounts the row. If revalidation is slow and the
   * instance is still alive, `useState` ignores a changed `done` prop, so
   * success resets to "idle" explicitly rather than leaving an open task
   * checked and disabled. On failure the task is still done, so "done"
   * stays truthful.
   */
  const handleUndo = async () => {
    try {
      await setTaskStatusAction(taskId, "open");
      setState("idle");
    } catch {
      showToast(undoErrorLabel, "error");
    }
  };

  return (
    <input
      type="checkbox"
      className={styles.completeCheckbox}
      checked={state !== "idle"}
      onChange={handleChange}
      disabled={state !== "idle"}
      aria-label={ariaLabel}
    />
  );
}
