"use client";

/**
 * "Guardar vista" (mockups/contacts.html `#save-view`): a real modal via
 * the shared Dialog (@/components/Dialog), not a dropdown menu — closes
 * that documented deviation. Submission is still the existing
 * `createSavedViewAction` server action/form (unchanged); the Dialog only
 * wraps its markup and adds the mockup's "Incluye" chip summary + columns
 * count + help text.
 */
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { createSavedViewAction } from "./viewActions";

export interface SaveViewDialogLabels {
  triggerLabel: string;
  title: string;
  nameLabel: string;
  includesLabel: string;
  helpText: string;
  cancelLabel: string;
  saveLabel: string;
}

export interface SaveViewDialogProps {
  labels: SaveViewDialogLabels;
  filtersQuery: string;
  summaryChips: string[];
}

export function SaveViewDialog({ labels: l, filtersQuery, summaryChips }: SaveViewDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="view-tab add" onClick={() => setOpen(true)}>
        {l.triggerLabel}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={l.title}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              {l.cancelLabel}
            </button>
            <button type="submit" form="save-view-form" className="btn btn-primary">
              {l.saveLabel}
            </button>
          </>
        }
      >
        <form action={createSavedViewAction} id="save-view-form" className="field">
          <input type="hidden" name="filtersQuery" value={filtersQuery} />
          <label htmlFor="save-view-name" className="label">
            {l.nameLabel}
          </label>
          <input id="save-view-name" className="input" type="text" name="name" placeholder={l.nameLabel} required />
        </form>
        <div className="field">
          <span className="label">{l.includesLabel}</span>
          <div className="row wrap">
            {summaryChips.map((text) => (
              <span key={text} className="chip">
                {text}
              </span>
            ))}
          </div>
        </div>
        <span className="help">{l.helpText}</span>
      </Dialog>
    </>
  );
}
