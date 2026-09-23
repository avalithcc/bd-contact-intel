"use client";

import { useState } from "react";
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      // TODO: call createTaskAction
      // await createTaskAction({
      //   title,
      //   leadId,
      //   companyKey,
      //   contactId,
      //   dueAt: dueDate ? new Date(dueDate) : null,
      // });
      setTitle("");
      setDueDate("");
      setIsOpen(false);
      onTaskCreated?.();
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
          }}
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
