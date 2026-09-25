"use client";

import { useState } from "react";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import styles from "./TaskQuickAdd.module.css";

export interface TaskQuickAddProps {
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  onTaskCreated?: () => void;
}

export function TaskQuickAdd({
  leadId,
  companyKey,
  contactId,
  onTaskCreated,
}: TaskQuickAddProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await createTaskAction({
        title,
        leadId,
        companyKey,
        contactId,
        dueAt: dueDate ? new Date(dueDate) : undefined,
      });
      setTitle("");
      setDueDate("");
      setIsOpen(false);
      onTaskCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button className={styles.toggle} onClick={() => setIsOpen(true)}>
        + Add task
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && <div className={styles.error}>{error}</div>}
      <input
        type="text"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={styles.titleInput}
        autoFocus
        disabled={isSubmitting}
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className={styles.dateInput}
        disabled={isSubmitting}
      />
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={!title.trim() || isSubmitting}
        >
          {isSubmitting ? "Creating..." : "Create"}
        </button>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={() => {
            setIsOpen(false);
            setTitle("");
            setDueDate("");
            setError(null);
          }}
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
