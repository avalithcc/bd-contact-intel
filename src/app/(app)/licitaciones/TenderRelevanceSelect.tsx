"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ToastProvider";
import { TENDER_RELEVANCE_CHOICES, type TenderRelevanceChoice } from "@/lib/tenders/relevance";

/**
 * A BD's own call on whether a tender is for us: "relevant", "not relevant", or "automatic" (the model decides). Busy and
 * disabled while saving; a failure puts the old value back and says so.
 */
export function TenderRelevanceSelect({
  id,
  value,
  labels,
  ariaLabel,
  errorLabel,
  setRelevance,
}: {
  id: string;
  value: TenderRelevanceChoice;
  labels: Record<TenderRelevanceChoice, string>;
  ariaLabel: string;
  errorLabel: string;
  /** The server action, passed in by the page so this client module never imports server-only code. */
  setRelevance: (id: string, choice: string) => Promise<void>;
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
        const next = e.target.value as TenderRelevanceChoice;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            await setRelevance(id, next);
          } catch {
            setCurrent(previous);
            showToast(errorLabel, "error");
          }
        });
      }}
    >
      {TENDER_RELEVANCE_CHOICES.map((c) => (
        <option key={c} value={c}>
          {labels[c]}
        </option>
      ))}
    </select>
  );
}
