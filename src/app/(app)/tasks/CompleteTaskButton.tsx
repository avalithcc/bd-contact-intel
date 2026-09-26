"use client";

import { useState } from "react";
import { completeTaskAction } from "./actions";
import styles from "./page.module.css";

export function CompleteTaskButton({ taskId }: { taskId: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await completeTaskAction(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={styles.completeButton}
      disabled={isLoading}
      title={error || "Mark complete"}
      aria-label="Mark complete"
    >
      {isLoading ? "…" : "✓"}
    </button>
  );
}
