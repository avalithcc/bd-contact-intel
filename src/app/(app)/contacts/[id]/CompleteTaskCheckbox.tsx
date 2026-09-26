"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { completeContactTaskAction } from "../actions";

/**
 * "Completar tarea" checkbox (mockup-port r05; contact-record.html:181's
 * right-panel Tareas card — a checkbox, unlike the timeline's "Próximas"
 * card which uses a button, CompleteTaskButton.tsx). Same underlying action.
 */
export function CompleteTaskCheckbox({
  taskId,
  personId,
  ariaLabel,
  errorLabel,
}: {
  taskId: string;
  personId: string;
  ariaLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      disabled={busy}
      onChange={async () => {
        setBusy(true);
        const result = await completeContactTaskAction(taskId, personId);
        if (result.ok) {
          router.refresh();
        } else {
          setBusy(false);
          showToast(errorLabel, "error");
        }
      }}
    />
  );
}
