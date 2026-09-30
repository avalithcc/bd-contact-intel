"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { completeCompanyTaskAction } from "../actions";

/**
 * "Completar tarea" checkbox for the company record's Tareas card
 * (task-edit change — brings this card's markup up to the same
 * checkbox + clickable-title shape the Contact record's Tareas card
 * already has, mirroring CompleteTaskCheckbox.tsx under contacts/[id]).
 */
export function CompleteTaskCheckbox({
  taskId,
  companyKey,
  ariaLabel,
  errorLabel,
}: {
  taskId: string;
  companyKey: string;
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
        const result = await completeCompanyTaskAction(taskId, companyKey);
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
