"use client";

import { Dialog } from "@/components/Dialog";
import { WarningIcon } from "@/components/icons";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";

/**
 * The confirmation for a "Regenerar" that would overwrite hand-edited text (review dialog and card menu): the row is
 * replaced in place and nothing keeps the old text. It is driven by what the SERVER refused to overwrite, and `ago` comes
 * from the instant of the text the server found.
 */
export function RegenerateConfirmDialog({ open, ago, ownView, labels: l, onCancel, onConfirm }: { open: boolean; ago: string; ownView: boolean; labels: SequenceLabels; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onClose={onCancel} title={ownView ? l.regenConfirmTitle : l.regenConfirmTitleOther}
      footer={<><button type="button" className="btn btn-secondary" onClick={onCancel}>{l.regenConfirmCancel}</button><button type="button" className="btn btn-danger" onClick={onConfirm}>{l.regenConfirmAction}</button></>}>
      <div className="stack">
        <div className="alert alert-warn"><WarningIcon className="icon" /><div>
          {fill(ownView ? l.regenConfirmLead : l.regenConfirmLeadOther, { ago })} <strong>{l.regenConfirmStrong}</strong> {ownView ? l.regenConfirmTail : l.regenConfirmTailOther}
        </div></div>
        <p className="meta">{l.regenConfirmHelp}</p>
      </div>
    </Dialog>
  );
}
