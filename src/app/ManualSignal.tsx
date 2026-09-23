"use client";

import { useState } from "react";
import styles from "./ManualSignal.module.css";

interface ManualSignalProps {
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  onSignalAdded?: () => void;
}

export function ManualSignal({
  leadId,
  companyKey,
  contactId,
  onSignalAdded,
}: ManualSignalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [signal, setSignal] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signal.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/signals/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal,
          leadId,
          companyKey,
          contactId,
        }),
      });

      if (!res.ok) throw new Error("Failed to save signal");

      setSignal("");
      setIsOpen(false);
      onSignalAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signal");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button className={styles.toggle} onClick={() => setIsOpen(true)}>
        + Paste signal
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && <div className={styles.error}>{error}</div>}
      <textarea
        value={signal}
        onChange={(e) => setSignal(e.target.value)}
        placeholder="Paste any signal you found — LinkedIn post, job posting, news, etc."
        className={styles.textarea}
        autoFocus
        disabled={isSubmitting}
      />
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={!signal.trim() || isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={() => {
            setIsOpen(false);
            setSignal("");
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
