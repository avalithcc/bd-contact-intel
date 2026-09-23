"use client";

import { useState } from "react";
import { createActivityAction } from "@/app/activity/actions";
import styles from "./AddActivityModal.module.css";

export function AddActivityButton({ companyKey }: { companyKey: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await createActivityAction({
        type: "note",
        companyKey,
        metadata: { body: note },
      });
      setNote("");
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add activity");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        className={styles.openButton}
        onClick={() => setIsOpen(true)}
      >
        Add activity
      </button>
    );
  }

  return (
    <div className={styles.modal}>
      <div className={styles.overlay} onClick={() => setIsOpen(false)} />
      <div className={styles.content}>
        <h2>Add Activity</h2>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened?"
            className={styles.textarea}
            autoFocus
            disabled={isSubmitting}
          />
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={!note.trim() || isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => {
                setIsOpen(false);
                setNote("");
                setError(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
