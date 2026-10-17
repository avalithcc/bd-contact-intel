"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import { settleAction } from "@/lib/contacts/actionOutcome";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { needsSendConfirm, stateOf, whenParts, type ScheduledAction, type ScheduledItem } from "@/lib/scheduledEmail/view";
import type { ContactActionResult } from "../contacts/actionErrors";
import { ScheduleEmailDialog } from "../contacts/[id]/ScheduleEmailDialog";
import { cancelScheduledEmailAction, editScheduledEmailAction, sendScheduledNowAction } from "../contacts/scheduleActions";

const TICK_MS = 30_000;

/**
 * The clock of a scheduled-email view. It starts from the server's `now` (so the first client render matches the server's)
 * and ticks, so a row that crosses the 2-minute lock stops offering Edit/Cancel without a reload.
 */
export function useNow(serverNow: Date): Date {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The actions behind every scheduled-email control (contact timeline card and "Programados" menu): edit / change time /
 * reschedule reopen the scheduling dialog with the row loaded, cancel asks first, send-now/send-anyway act at once.
 * Dialogs close on success and stay open with the error on failure.
 */
export function useScheduledActions(l: ContactRecordLabels) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<ScheduledItem | null>(null);
  const [cancelling, setCancelling] = useState<ScheduledItem | null>(null);
  const [confirming, setConfirming] = useState<ScheduledItem | null>(null);
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle(call: () => Promise<ContactActionResult>, success: string, close?: () => void) {
    setBusy(true);
    setError(null);
    const result = await settleAction(call);
    setBusy(false);
    if (!result.ok && result.reason === "unconfirmed") router.refresh();
    if (result.ok) {
      close?.();
      showToast(success);
      router.refresh();
    } else {
      const message = contactActionErrorMessage(l, result.reason);
      setError(message);
      showToast(message, "error");
    }
  }

  function run(action: ScheduledAction, item: ScheduledItem) {
    setError(null);
    if (action === "cancel") setCancelling(item);
    else if (busy) return;
    else if (action === "sendNow" && needsSendConfirm(stateOf(item, new Date()))) setConfirming(item); // it may already have gone out
    else if (action === "sendNow" || action === "sendAnyway") void settle(() => sendScheduledNowAction(item.id), l.toastScheduleSendNow);
    else {
      setDraft({ subject: item.subject, body: item.body });
      setEditing(item);
    }
  }

  const cancelWhen = cancelling ? whenParts(cancelling.sendAt, "argentina") : null;

  const dialogs = (
    <>
      {editing && (
        <ScheduleEmailDialog
          labels={l}
          name={editing.personName}
          subject={draft.subject}
          body={draft.body}
          busy={busy}
          error={error}
          edit={{ initialSendAt: editing.sendAt, allowUnchanged: editing.status === "scheduled" }}
          onSubjectChange={(subject) => setDraft((d) => ({ ...d, subject }))}
          onBodyChange={(body) => setDraft((d) => ({ ...d, body }))}
          onCancel={() => setEditing(null)}
          onSubmit={(sendAt) => void settle(() => editScheduledEmailAction(editing.id, draft.subject, draft.body, sendAt.toISOString()), l.toastScheduleSaved, () => setEditing(null))}
        />
      )}
      {confirming && (
        <Dialog
          open
          onClose={() => setConfirming(null)}
          closeDisabled={busy}
          title={l.schedConfirmTitle}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>
                {l.cancel}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void settle(() => sendScheduledNowAction(confirming.id), l.toastScheduleSendNow, () => setConfirming(null))}>
                {l.schedActionSendAnyway}
              </button>
            </>
          }
        >
          {error && <div className="error-text" role="alert">{error}</div>}
          <p>{l.schedConfirmBody}</p>
        </Dialog>
      )}
      {cancelling && (
        <Dialog
          open
          onClose={() => setCancelling(null)}
          closeDisabled={busy}
          title={l.schedCancelTitle}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setCancelling(null)} disabled={busy}>
                {l.schedCancelKeep}
              </button>
              <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={() => void settle(() => cancelScheduledEmailAction(cancelling.id), l.toastScheduleCancelled, () => setCancelling(null))}>
                {l.schedActionCancel}
              </button>
            </>
          }
        >
          {error && <div className="error-text" role="alert">{error}</div>}
          <p>
            “{cancelling.subject}” {l.schedCancelWont} {cancelWhen?.day} {l.schedCancelAt} {cancelWhen?.clock}. {l.schedCancelBodyAfter}
          </p>
        </Dialog>
      )}
    </>
  );
  return { run, dialogs, busy };
}

export type RunScheduled = (action: ScheduledAction, item: ScheduledItem) => void;

export const ACTION_LABEL: Record<ScheduledAction, keyof ContactRecordLabels> = {
  edit: "schedActionEdit",
  changeTime: "schedActionChangeTime",
  sendNow: "schedActionSendNow",
  sendAnyway: "schedActionSendAnyway",
  reschedule: "schedActionReschedule",
  cancel: "schedActionCancel",
};
