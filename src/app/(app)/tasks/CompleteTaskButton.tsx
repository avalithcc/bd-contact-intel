"use client";

import { useState } from "react";
import { completeTaskAction } from "./actions";
import styles from "./page.module.css";

export function CompleteTaskButton({
  taskId,
  ariaLabel,
}: {
  taskId: string;
  ariaLabel: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await completeTaskAction(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
      setIsLoading(false);
    }
  };

  return (
    <input
      type="checkbox"
      className={styles.completeCheckbox}
      onChange={handleChange}
      disabled={isLoading}
      title={error ?? ariaLabel}
      aria-label={ariaLabel}
    />
  );
}
