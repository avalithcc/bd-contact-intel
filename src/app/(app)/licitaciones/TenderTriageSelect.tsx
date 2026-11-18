"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ToastProvider";
import { TENDER_TRIAGE_STATES, type TenderTriage } from "@/lib/tenders/triage";
import { setTenderTriageAction } from "./actions";

/** Changes our triage state on one tender. Busy and disabled while saving; a failure puts the old value back and says so. */
export function TenderTriageSelect({
  id,
  value,
  labels,
  ariaLabel,
  errorLabel,
}: {
  id: string;
  value: TenderTriage;
  labels: Record<TenderTriage, string>;
  ariaLabel: string;
  errorLabel: string;
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
            await setTenderTriageAction(id, next);
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
