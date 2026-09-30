"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { ChevronDownIcon } from "@/components/icons";
import { postponeFollowUpAction, skipFollowUpAction } from "./actions";

/**
 * "Posponer" dropdown (follow-up-queue mockup README decision 5). Neither
 * option logs an activity or asks for a reason — this is the queue's own
 * state, not a contact-record quick action, so (unlike the reused note/
 * call/email/task/meeting/discard icons, which just navigate) it needs its
 * own client component calling its own server actions. Same "call the
 * action, let `revalidatePath` refresh the server-rendered list" pattern as
 * `CompleteTaskButton.tsx` — no optimistic local list state here either.
 */
export function PostponeMenu({
  itemId,
  labels,
}: {
  itemId: string;
  labels: { postponeMenuLabel: string; postponeTomorrow: string; skipToday: string; postponeError: string };
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: (id: string) => Promise<void>) {
    setBusy(true);
    try {
      await action(itemId);
    } catch {
      showToast(labels.postponeError, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="dropdown">
      <summary className="btn btn-ghost btn-sm">
        {labels.postponeMenuLabel}
        <ChevronDownIcon className="icon" />
      </summary>
      <div className="menu left">
        <button type="button" className="menu-item" disabled={busy} onClick={() => run(postponeFollowUpAction)}>
          {labels.postponeTomorrow}
        </button>
        <button type="button" className="menu-item" disabled={busy} onClick={() => run(skipFollowUpAction)}>
          {labels.skipToday}
        </button>
      </div>
    </details>
  );
}
