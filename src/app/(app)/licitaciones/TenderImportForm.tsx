"use client";

import { useActionState } from "react";
import { BusyButton } from "@/components/forms/BusyButton";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { importTendersAction, type ImportTendersState } from "./actions";

/** Upload for the portal's Excel. Always says what happened: created, updated, unchanged and any rejected rows. */
export function TenderImportForm({ locale }: { locale: Locale }) {
  const l = t(locale).tendersPage;
  const [state, action, pending] = useActionState<ImportTendersState, FormData>(importTendersAction, null);

  return (
    <form action={action} className="mb-lg">
      <div className="legacy-row">
        <div className="field-grow">
          <label htmlFor="tender-file">{l.uploadLabel}</label>
          <input id="tender-file" name="file" type="file" accept=".xls,.xlsx" required />
          <p className="meta">{l.uploadHelp}</p>
        </div>
        <BusyButton pending={pending} pendingLabel={l.importing}>
          {l.importButton}
        </BusyButton>
      </div>
      {state?.ok && (
        <div className="alert alert-success mb-lg" role="status">
          <div>
            {l.importResult(state.report.created, state.report.updated, state.report.unchanged)}
            {state.report.unclassified > 0 ? ` ${l.importUnclassified(state.report.unclassified)}` : state.report.classified > 0 ? ` ${l.importClassified(state.report.classified)}` : ""}
            {state.report.rejected.length > 0 && <> {l.importRejected(state.report.rejected.length)}</>}
          </div>
        </div>
      )}
      {state && !state.ok && (
        <div className="alert alert-danger mb-lg" role="alert">
          <div>
            {l.errors[state.error]}
            {state.detail && state.detail.length > 0 && <> {l.errors.missingColumns} {state.detail.join(", ")}</>}
          </div>
        </div>
      )}
    </form>
  );
}
