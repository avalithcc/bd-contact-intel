"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createActivityAction } from "@/app/activity/actions";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import type { CompanyRecordLabels } from "./EditCompanyButton";
import styles from "./AddActivityModal.module.css";

export function AddActivityButton({
  companyKey,
  labels: l,
}: {
  companyKey: string;
  labels: CompanyRecordLabels;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setNote("");
    setError(null);
  }

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
      showToast(l.addActivitySuccess);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : l.addActivityError;
      setError(message);
      showToast(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button type="button" className={styles.openButton} onClick={() => setIsOpen(true)}>
        {l.addActivity}
      </button>

      <Dialog open={isOpen} onClose={close} title={l.addActivityDialogTitle}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={l.notePlaceholder}
            className={styles.textarea}
            autoFocus
            disabled={isSubmitting}
          />
          <div className={styles.actions}>
            <button type="button" onClick={close} disabled={isSubmitting}>
              {l.cancel}
            </button>
            <button type="submit" disabled={!note.trim() || isSubmitting}>
              {isSubmitting ? l.saving : l.save}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
