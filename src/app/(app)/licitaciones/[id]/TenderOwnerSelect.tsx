"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ToastProvider";

/** Assigns the tender to a BD (or to nobody). Busy while saving; a failure puts the old value back and says so. Strings only: no dictionary slice crosses here. */
export function TenderOwnerSelect({
  id,
  value,
  options,
  noneLabel,
  ariaLabel,
  errorLabel,
  setOwner,
}: {
  id: string;
  /** The owner's bd id, "" for nobody. */
  value: string;
  options: { id: string; name: string }[];
  noneLabel: string;
  ariaLabel: string;
  errorLabel: string;
  setOwner: (id: string, ownerBdId: string) => Promise<void>;
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
        const next = e.target.value;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            await setOwner(id, next);
          } catch {
            setCurrent(previous);
            showToast(errorLabel, "error");
          }
        });
      }}
    >
      <option value="">{noneLabel}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
