"use client";

import { useActionState } from "react";
import { uploadCsv, type UploadResult } from "@/app/actions";
import type { ContactsImportLabels } from "@/lib/contacts/labels";
import { ImportOutcome } from "./ImportOutcome";

const CONNECTIONS_ERROR_KEY: Record<
  NonNullable<UploadResult["errorKey"]>,
  keyof ContactsImportLabels
> = {
  missingFile: "connectionsErrorMissingFile",
  noConnectionsFound: "connectionsErrorNoConnectionsFound",
  genericFailed: "connectionsErrorGenericFailed",
};

/**
 * LinkedIn connections upload, moved onto `/contacts/import` (task 14.2)
 * alongside the leads CSV upload. Reuses the EXACT same `uploadCsv` server
 * action (and therefore the same `upsertContacts`/identity-resolver write
 * path) as the pre-existing home-page `UploadForm` — this is a new,
 * Spanish-only (D10) surface for it, not a behavior change to the upload
 * itself. The home-page form is left in place (not removed) so nothing
 * currently depending on it breaks.
 */
export function ConnectionsUploadForm({ labels: l }: { labels: ContactsImportLabels }) {
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(uploadCsv, null);

  return (
    <form action={action}>
      <div className="row">
        <div className="field-grow">
          <label htmlFor="connections-file">{l.connectionsFileLabel}</label>
          <input id="connections-file" name="file" type="file" accept=".csv" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? l.connectionsImporting : l.connectionsSubmit}
        </button>
      </div>

      {state?.ok && <ImportOutcome
          report={state.identityReport ?? null}
          labels={l}
          ownCompanySkippedBeforeMatching={state.skippedOwnCompany ?? 0}
        />}
      {state && !state.ok && (
        <p className="text-danger mb-0">
          {state.errorKey ? l[CONNECTIONS_ERROR_KEY[state.errorKey]] : null}
        </p>
      )}
    </form>
  );
}
