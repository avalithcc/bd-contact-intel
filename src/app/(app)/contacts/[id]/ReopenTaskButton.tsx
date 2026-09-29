"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { reopenContactTaskAction } from "../actions";

/**
 * "Reabrir" on a done task row in the record page's "Tareas" filter pill
 * (mockup-port timeline-tasks-pill) — the reopen counterpart of
 * CompleteTaskButton.tsx, for the pill's own completed-tasks group. The
 * mockup never renders a completed-task card (contact-record.html's only
 * task example is the open one in "Próximas"), so this has no icon —
 * matching the mockup's other inert-looking secondary action
 * ("Reprogramar") rather than inventing an icon the design never specified.
 */
export function ReopenTaskButton({
  taskId,
  personId,
  label,
  errorLabel,
}: {
  taskId: string;
  personId: string;
  label: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await reopenContactTaskAction(taskId, personId);
          if (result.ok) {
            router.refresh();
          } else {
            showToast(errorLabel, "error");
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
