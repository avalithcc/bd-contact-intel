"use client";

import { Dialog } from "@/components/Dialog";
import { EyeIcon, WarningIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

/**
 * Confirmation dialog before an admin opens another BD's conversation
 * (admin-conversation-access mockup, screen 1's `#confirm-view-*` overlay;
 * README "duplicates.html '¿Deshacer la fusión?' modal pattern"). Ported onto
 * the repo's shared `<Dialog>` (dialogMarkup-guard-clean) instead of the
 * mockup's raw `.overlay`/`:target` markup — every other confirm dialog in
 * this app already works this way.
 *
 * Confirming used to NAVIGATE to `/contacts/[personId]/conversation/[bdId]`.
 * Owner decision 2026-09-30: that route is gone — confirming now calls
 * `onConfirm`, which the caller (AdminConversationFlow.tsx) turns into the
 * SAME audited `getConversationForAdmin` read, rendered into the shared
 * `ConversationDialog` instead of a separate page. This dialog itself still
 * never touches the DB.
 *
 * Owner decision (2026-09-30): the target BD is never notified and has no
 * way to see this view — the audit copy below states that plainly, dropping
 * the mockup's earlier "Juan/Ana va a poder ver que la visualizaste" promise.
 */
export function AdminViewConversationDialog({
  open,
  onClose,
  onConfirm,
  busy,
  personName,
  bdName,
  labels: l,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  personName: string;
  bdName: string;
  labels: ContactRecordLabels;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${l.adminViewDialogTitlePrefix} ${bdName}?`}
      closeDisabled={busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            <EyeIcon className="icon" />
            {l.viewConversationLink}
            {busy && <span className="spinner" aria-hidden="true" />}
          </button>
        </>
      }
    >
      <p>
        {l.adminViewDialogBodyPrefix} <strong>{bdName}</strong> {l.adminViewDialogBodyWith}{" "}
        <strong>{personName}</strong>.
      </p>
      <div className="alert alert-audit">
        <WarningIcon className="icon" />
        <div>
          <div className="title">{l.adminAuditConfirmTitle}</div>
          {l.adminAuditConfirmBody}
        </div>
      </div>
    </Dialog>
  );
}
