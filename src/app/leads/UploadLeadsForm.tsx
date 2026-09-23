"use client";

import { useActionState } from "react";
import { importLeadsCsv, type ImportLeadsResult } from "./actions";
import type { LeadsUploadLabels } from "@/lib/leads/labels";

/**
 * Import control for the event export files (see src/lib/leads/csv.ts for
 * the merge logic). All optional except a source key, which identifies the
 * event/import batch (`lead_source.key`) and is what makes re-running the
 * same import idempotent instead of creating a second, disconnected batch.
 */
export function UploadLeadsForm({ labels }: { labels: LeadsUploadLabels }) {
  const [state, action, pending] = useActionState<ImportLeadsResult | null, FormData>(
    importLeadsCsv,
    null,
  );

  return (
    <form action={action}>
      <div className="row row-md" style={{ flexWrap: "wrap" }}>
        <div className="field-grow">
          <label htmlFor="sourceKey">{labels.sourceKeyLabel}</label>
          <input
            id="sourceKey"
            name="sourceKey"
            type="text"
            placeholder={labels.sourceKeyPlaceholder}
            required
          />
        </div>
        <div className="field-grow">
          <label htmlFor="sourceName">{labels.sourceNameLabel}</label>
          <input
            id="sourceName"
            name="sourceName"
            type="text"
            placeholder={labels.sourceNamePlaceholder}
          />
        </div>
      </div>

      <div className="row row-md" style={{ flexWrap: "wrap" }}>
        <div className="field-grow">
          <label htmlFor="attendees">{labels.attendeesFileLabel}</label>
          <input id="attendees" name="attendees" type="file" accept=".csv" />
        </div>
        <div className="field-grow">
          <label htmlFor="decisores">{labels.decisoresFileLabel}</label>
          <input id="decisores" name="decisores" type="file" accept=".csv" />
        </div>
      </div>

      <div className="row row-md" style={{ flexWrap: "wrap" }}>
        <div className="field-grow">
          <label htmlFor="hunter">{labels.hunterFileLabel}</label>
          <input id="hunter" name="hunter" type="file" accept=".csv" />
        </div>
        <div className="field-grow">
          <label htmlFor="probables">{labels.probablesFileLabel}</label>
          <input id="probables" name="probables" type="file" accept=".csv" />
        </div>
      </div>

      <div className="row row-md" style={{ flexWrap: "wrap" }}>
        <div className="field-grow">
          <label htmlFor="correosFinal">{labels.correosFinalFileLabel}</label>
          <input id="correosFinal" name="correosFinal" type="file" accept=".csv" />
        </div>
        <div className="field-grow">
          <label htmlFor="columnaCorreos">{labels.columnaCorreosFileLabel}</label>
          <input id="columnaCorreos" name="columnaCorreos" type="file" accept=".tsv,.csv,.txt" />
        </div>
      </div>

      <div className="row">
        <button type="submit" disabled={pending}>
          {pending ? labels.importing : labels.import}
        </button>
      </div>

      {state?.ok && (
        <>
          <p className="muted mb-0">{labels.importedSummary(state.upserted ?? 0)}</p>
          {state.matchedOwners && state.matchedOwners.length > 0 && (
            <p className="muted mb-0">{labels.matchedOwnersSummary(state.matchedOwners.join(", "))}</p>
          )}
          {state.unmatchedOwners && state.unmatchedOwners.length > 0 && (
            <p className="text-warn mb-0">
              {labels.unmatchedOwnersSummary(state.unmatchedOwners.join(", "))}
            </p>
          )}
        </>
      )}
      {state && !state.ok && (
        <p className="text-danger mb-0">
          {state.errorKey ? labels.importErrors[state.errorKey] : null}
          {state.errorDetail ? ` ${state.errorDetail}` : ""}
        </p>
      )}
    </form>
  );
}
