"use client";

/**
 * Selection + bulk bar for the `/companies` table (mockup
 * company-client-status-bulk/estado-cliente-masivo.html). Mirrors
 * contacts/BulkActionsBar.tsx: row checkboxes stay plain server-rendered
 * HTML inside one shared `<form>`; selection is read off the DOM from a
 * plain JSX `onChange` on that form (an imperative useEffect + ref listener
 * was a real bug there, see contacts/bulkSelection.ts). Only one
 * `type="submit"` exists in the DOM at a time: the confirm button of the
 * dialog, which renders null while closed (@/components/Dialog).
 */
import { useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CheckIcon, CloseIcon, WarningIcon } from "@/components/icons";
import { requiresCountConfirmation, isCountConfirmed } from "@/lib/companies/bulkClientStatus";
import { resolveSelectAllChecked, SELECT_ALL_COMPANIES_CHECKBOX_ID } from "@/lib/contacts/bulkSelection";
import type { CompanyBulkLabels } from "@/lib/companies/labels";
import type { Locale } from "@/lib/i18n/locales";
import { bulkClientStatusAction } from "./bulkActions";

export interface CompanyBulkBarProps {
  labels: CompanyBulkLabels;
  statusLabels: { active: string; inactive: string; none: string };
  locale: Locale;
  // Rows matching the active filter; "Seleccionar las N" acts on all of them.
  total: number;
  // Current list query string (filters + view + page), so the action can
  // re-derive the filter-wide id set and redirect back to the same view.
  returnQuery: string;
  children: React.ReactNode;
}

export function CompanyBulkBar({ labels: l, statusLabels, locale, total, returnQuery, children }: CompanyBulkBarProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [filterWideMode, setFilterWideMode] = useState(false);
  const [typed, setTyped] = useState("");

  const count = filterWideMode ? total : selectedCount;
  const guarded = requiresCountConfirmation(count);
  const fill = (template: string, n: number) => template.replace("{n}", n.toLocaleString(locale));
  const companies = (n: number) => (n === 1 ? l.companiesOne : fill(l.companiesMany, n));

  function rowBoxes() {
    return formRef.current?.querySelectorAll<HTMLInputElement>('input[name="companyKey"]');
  }

  function recount() {
    setSelectedCount(formRef.current?.querySelectorAll('input[name="companyKey"]:checked').length ?? 0);
  }

  // Plain JSX onChange on the <form>: React's own delegation, no ref-timing race.
  function handleFormChange(e: React.ChangeEvent<HTMLFormElement>) {
    const target = e.target as unknown as HTMLInputElement;
    const selectAll = resolveSelectAllChecked(target.id, target.checked, SELECT_ALL_COMPANIES_CHECKBOX_ID);
    if (selectAll !== null) rowBoxes()?.forEach((box) => (box.checked = selectAll));
    if (target.name === "companyKey" || selectAll !== null) {
      // A manual change after "Seleccionar las N" drops the filter-wide mode.
      if (target.name === "companyKey") setFilterWideMode(false);
      recount();
    }
  }

  function clearSelection() {
    rowBoxes()?.forEach((box) => (box.checked = false));
    setSelectedCount(0);
    setFilterWideMode(false);
    closeDialog();
  }

  function selectAllMatching() {
    rowBoxes()?.forEach((box) => (box.checked = true));
    setFilterWideMode(true);
    recount();
  }

  function closeDialog() {
    setOpen(false);
    setTyped("");
  }

  const confirmDisabled = guarded && !isCountConfirmed(typed, count);

  return (
    <form ref={formRef} action={bulkClientStatusAction} onChange={handleFormChange}>
      <input type="hidden" name="returnQuery" value={returnQuery} />
      {filterWideMode && <input type="hidden" name="mode" value="filter" />}

      {selectedCount > 0 && (
        <div className="bulk-bar" role="region" aria-label={l.regionLabel}>
          <span className="count">{selectedCount === 1 && !filterWideMode ? l.selectedOne : fill(l.selectedMany, count)}</span>
          <span className="sep" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
            <CheckIcon className="icon" />
            {l.clientStatusAction}
          </button>
          <span className="grow" />
          {total > selectedCount && !filterWideMode && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllMatching}>
              {fill(l.selectAllMatching, total)}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={clearSelection} aria-label={l.clearSelection}>
            <CloseIcon className="icon" />
          </button>
        </div>
      )}

      <Dialog
        open={open}
        onClose={closeDialog}
        title={l.dialogTitle}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeDialog}>
              {l.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={confirmDisabled}>
              {l.confirmPrefix} {companies(count)}
            </button>
          </>
        }
      >
        <p>
          {l.dialogIntroPrefix} <strong>{companies(count)}</strong> {count === 1 ? l.dialogIntroSuffixOne : l.dialogIntroSuffixMany}
        </p>
        <fieldset className="status-options">
          <legend className="sr-only">{l.dialogTitle}</legend>
          <div className="status-option">
            <input id="bulk-status-active" type="radio" name="clientStatus" value="active" defaultChecked />
            <label htmlFor="bulk-status-active">
              <span className="name">{statusLabels.active}</span>
              <span className="hint">{l.activeHint}</span>
            </label>
          </div>
          <div className="status-option">
            <input id="bulk-status-inactive" type="radio" name="clientStatus" value="inactive" />
            <label htmlFor="bulk-status-inactive">
              <span className="name">{statusLabels.inactive}</span>
              <span className="hint">{l.inactiveHint}</span>
            </label>
          </div>
          <div className="status-option">
            <input id="bulk-status-none" type="radio" name="clientStatus" value="" />
            <label htmlFor="bulk-status-none">
              <span className="name">{statusLabels.none}</span>
              <span className="hint">{l.noneHint}</span>
            </label>
          </div>
        </fieldset>
        {guarded && (
          <>
            <div className="alert alert-warn">
              <WarningIcon className="icon" />
              <div>
                <div className="title">{fill(l.guardTitle, count)}</div>
                {l.guardBody}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="bulk-confirm-count">
                {l.guardInputLabel}
              </label>
              <input
                id="bulk-confirm-count"
                type="text"
                className="input"
                name="confirmCount"
                inputMode="numeric"
                autoComplete="off"
                placeholder={String(count)}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          </>
        )}
        <p className="meta">{l.historyNote}</p>
      </Dialog>

      {children}
    </form>
  );
}
