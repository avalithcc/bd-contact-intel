"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BusyButton } from "@/components/forms/BusyButton";

/** Runs the AI reading of the CURRENT pliego. Off when there is no document: the reading is never made from the title. */
export function TenderAnalyseButton({
  tenderId,
  disabled,
  label,
  busyLabel,
  analyse,
  errors,
}: {
  tenderId: string;
  disabled: boolean;
  label: string;
  busyLabel: string;
  analyse: (tenderId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack-sm">
      <div className="row">
        <BusyButton
          type="button"
          pending={pending}
          pendingLabel={busyLabel}
          disabled={disabled}
          className="btn btn-primary btn-sm"
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                const result = await analyse(tenderId);
                if (result.ok) router.refresh();
                else setError(errors[result.error] ?? errors.generationFailed ?? "");
              } catch {
                setError(errors.generationFailed ?? "");
              }
            })
          }
        >
          {label}
        </BusyButton>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
