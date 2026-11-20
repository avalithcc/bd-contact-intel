"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ToastProvider";
import { REQUIREMENT_STATUSES, type RequirementStatus } from "@/lib/tenders/requirementStatus";

/** What Avalith has for ONE requirement: not asked yet / we have it / we do not have it. Strings only. A failure puts the old value back and says so. */
export function TenderRequirementStatusSelect({
  id,
  requirementKey,
  value,
  labels,
  ariaLabel,
  errorLabel,
  setStatus,
}: {
  id: string;
  /** The stable requirement key the answer is stored under, never the requirement's text. */
  requirementKey: string;
  value: RequirementStatus;
  labels: Record<RequirementStatus, string>;
  ariaLabel: string;
  errorLabel: string;
  setStatus: (id: string, key: string, status: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState(value);
  const [pending, startTransition] = useTransition();
  return (
    <select
      className="select input-sm"
      data-requirement={requirementKey}
      value={current}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      onChange={(e) => {
        const next = e.target.value as RequirementStatus;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            await setStatus(id, requirementKey, next);
          } catch {
            setCurrent(previous);
            showToast(errorLabel, "error");
          }
        });
      }}
    >
      {REQUIREMENT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {labels[s]}
        </option>
      ))}
    </select>
  );
}
