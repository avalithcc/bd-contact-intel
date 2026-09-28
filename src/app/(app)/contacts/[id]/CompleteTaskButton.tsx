"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { CheckIcon } from "@/components/icons";
import { completeContactTaskAction } from "../actions";

/**
 * "Marcar como hecha" (contact-record.html:111/181) — the record page's own
 * button for the existing `completeContactTaskAction` (mockup-port r03),
 * used both in the timeline's "Próximas" card and the right panel's Tareas
 * card checkbox row (r05).
 */
export function CompleteTaskButton({
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
          const result = await completeContactTaskAction(taskId, personId);
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
      <CheckIcon className="icon" />
      {label}
    </button>
  );
}
