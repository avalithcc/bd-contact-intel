"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { completeTaskAction } from "./actions";
import styles from "./page.module.css";

/**
 * Controlled so the checkbox only stays checked once the server action
 * succeeds: while saving it shows checked and disabled, on success it stays
 * that way until revalidation removes the row, and on failure it unchecks
 * and reports the error as a toast.
 */
export function CompleteTaskButton({
  taskId,
  ariaLabel,
  errorLabel,
}: {
  taskId: string;
  ariaLabel: string;
  errorLabel: string;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  const handleChange = async () => {
    setState("saving");
    try {
      await completeTaskAction(taskId);
      setState("done");
    } catch {
      setState("idle");
      showToast(errorLabel, "error");
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
