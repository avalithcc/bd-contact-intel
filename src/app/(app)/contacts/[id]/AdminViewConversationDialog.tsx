"use client";

import Link from "next/link";
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
 * Confirming NAVIGATES to `/contacts/[personId]/conversation/[bdId]`
 * (a plain `<Link>`, not a server action) — the audited read itself still
 * only happens once, inside `getConversationForAdmin` on that destination
 * page (task instruction: "audit BEFORE reading ... keep it"). This dialog
 * never touches the DB.
 *
 * Owner decision (2026-09-30): the target BD is never notified and has no
 * way to see this view — the audit copy below states that plainly, dropping
 * the mockup's earlier "Juan/Ana va a poder ver que la visualizaste" promise.
 */
export function AdminViewConversationDialog({
  open,
  onClose,
  personId,
  personName,
  bdId,
  bdName,
  labels: l,
}: {
  open: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  bdId: string;
  bdName: string;
  labels: ContactRecordLabels;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${l.adminViewDialogTitlePrefix} ${bdName}?`}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {l.cancel}
          </button>
          <Link
            href={`/contacts/${personId}/conversation/${bdId}`}
            prefetch={false}
            className="btn btn-primary"
            onClick={onClose}
          >
            <EyeIcon className="icon" />
            {l.viewConversationLink}
          </Link>
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
