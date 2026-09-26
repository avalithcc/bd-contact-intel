"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCompanyAction } from "@/app/(app)/companies/actions";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import styles from "./EditCompanyModal.module.css";

export type CompanyRecordLabels = ClientStrings<Dictionary["companyRecord"]>;

interface EditCompanyButtonProps {
  companyKey: string;
  displayName: string;
  relationshipStage?: string | null;
  revenuePotential?: number | null;
  notes?: string | null;
  labels: CompanyRecordLabels;
  stageLabels: Record<string, string>;
}

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;

export function EditCompanyButton({
  companyKey,
  displayName,
  relationshipStage,
  revenuePotential,
  notes,
  labels: l,
  stageLabels,
}: EditCompanyButtonProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(displayName);
  const [stage, setStage] = useState(relationshipStage ?? "");
  const [revenue, setRevenue] = useState(revenuePotential?.toString() ?? "");
  const [notesText, setNotesText] = useState(notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setError(null);
  }

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
      showToast(l.editSuccess);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : l.editError;
      setError(message);
      showToast(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button type="button" className={styles.openButton} onClick={() => setIsOpen(true)}>
        {l.editCompany}
      </button>

      <Dialog open={isOpen} onClose={close} title={l.editDialogTitle}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <label className={styles.field}>
            <span>{l.companyNameLabel}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <label className={styles.field}>
            <span>{l.stageLabel}</span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="">{l.stageNone}</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {stageLabels[s] ?? s}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>{l.revenueLabel}</span>
            <input
              type="number"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              placeholder="0"
              disabled={isSubmitting}
            />
          </label>

          <label className={styles.field}>
            <span>{l.notesLabel}</span>
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <div className={styles.actions}>
            <button type="button" onClick={close} disabled={isSubmitting}>
              {l.cancel}
            </button>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? l.saving : l.save}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
