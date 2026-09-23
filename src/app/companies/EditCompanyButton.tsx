"use client";

import { useState } from "react";
import { updateCompanyAction } from "@/app/companies/actions";
import styles from "./EditCompanyModal.module.css";

interface EditCompanyButtonProps {
  companyKey: string;
  displayName: string;
  relationshipStage?: string | null;
  revenuePotential?: number | null;
  notes?: string | null;
}

export function EditCompanyButton({
  companyKey,
  displayName,
  relationshipStage,
  revenuePotential,
  notes,
}: EditCompanyButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(displayName);
  const [stage, setStage] = useState(relationshipStage ?? "");
  const [revenue, setRevenue] = useState(revenuePotential?.toString() ?? "");
  const [notesText, setNotesText] = useState(notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await updateCompanyAction(companyKey, {
        displayName: name,
        relationshipStage: stage || undefined,
        revenuePotential: revenue ? parseInt(revenue) : undefined,
        notes: notesText || undefined,
      });
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update company");
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
        Edit company
      </button>
    );
  }

  return (
    <div className={styles.modal}>
      <div className={styles.overlay} onClick={() => setIsOpen(false)} />
      <div className={styles.content}>
        <h2>Edit Company</h2>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Company Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Stage</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className={styles.select}
              disabled={isSubmitting}
            >
              <option value="">None</option>
              <option value="prospect">Prospect</option>
              <option value="qualified">Qualified</option>
              <option value="proposal_sent">Proposal Sent</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Revenue Potential</label>
            <input
              type="number"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              placeholder="0"
              className={styles.input}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Notes</label>
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              className={styles.textarea}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => {
                setIsOpen(false);
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
