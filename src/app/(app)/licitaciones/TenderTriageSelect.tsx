"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ToastProvider";
import { TENDER_TRIAGE_STATES, type TenderTriage } from "@/lib/tenders/triage";

/** Changes our triage state on one tender. Busy and disabled while saving; a failure puts the old value back and says so. */
export function TenderTriageSelect({
  id,
  value,
  labels,
  ariaLabel,
  errorLabel,
  setTriage,
}: {
  id: string;
  value: TenderTriage;
  labels: Record<TenderTriage, string>;
  ariaLabel: string;
  errorLabel: string;
  /** The server action, passed in by the page so this client module never imports server-only code. */
  setTriage: (id: string, status: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState(value);
  const [pending, startTransition] = useTransition();

  return (
    <select
      className="select input-sm"
      value={current}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = e.target.value as TenderTriage;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            await setTriage(id, next);
          } catch {
            setCurrent(previous);
            showToast(errorLabel, "error");
          }
        });
      }}
    >
      {TENDER_TRIAGE_STATES.map((s) => (
        <option key={s} value={s}>
          {labels[s]}
        </option>
      ))}
    </select>
  );
}
