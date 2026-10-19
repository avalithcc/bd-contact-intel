"use client";

import { useState, type FormEvent } from "react";
import { finalizeConnectionsImport, importConnectionsBatch } from "@/app/actions";
import type { ContactsImportLabels } from "@/lib/contacts/labels";
import { runBatchedImport, type ImportBatchOutcome } from "@/lib/contacts/importBatches";
import { parseConnectionsCsv } from "@/lib/csv";
import { ImportOutcome } from "./ImportOutcome";

type FormState =
  | { phase: "idle" }
  | { phase: "importing"; done: number; total: number }
  | { phase: "done"; totals: ImportBatchOutcome; finalizeFailed: boolean }
  | { phase: "failed"; message: string; totals: ImportBatchOutcome | null };

function fill(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (values[k] ?? "").toLocaleString());
}

/**
 * LinkedIn connections upload on `/contacts/import`. The browser parses the
 * CSV (a 13k-row file in one server action exceeded Vercel's 300 s limit) and
 * sends it in sequential batches, then asks the server to fill in message
 * signals for people imported after their messages. Every batch goes through
 * the same `upsertContacts`/identity-resolver write path as before and is
 * idempotent, so after a failure uploading the same file again just continues.
 */
export function ConnectionsUploadForm({ labels: l }: { labels: ContactsImportLabels }) {
  const [state, setState] = useState<FormState>({ phase: "idle" });
  const importing = state.phase === "importing";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setState({ phase: "failed", message: l.connectionsErrorMissingFile, totals: null });
      return;
    }
    setState({ phase: "importing", done: 0, total: 0 });
    let rows;
    try {
      rows = parseConnectionsCsv(await file.text());
    } catch (err) {
      console.error("Could not parse the connections CSV", err);
      setState({ phase: "failed", message: l.connectionsErrorUnreadable, totals: null });
      return;
    }
    if (!rows.length) {
      setState({ phase: "failed", message: l.connectionsErrorNoConnectionsFound, totals: null });
      return;
    }
    setState({ phase: "importing", done: 0, total: rows.length });
    const result = await runBatchedImport(rows, {
      send: async (batch) => {
        const res = await importConnectionsBatch(batch);
        return res.ok ? { ok: true, outcome: res.outcome } : { ok: false };
      },
      onProgress: (done, total) => setState({ phase: "importing", done, total }),
    });
    if (!result.ok) {
      setState({
        phase: "failed",
        message: fill(l.connectionsErrorBatchFailed, { batch: result.failedBatch, total: result.totalBatches }),
        totals: result.totals,
      });
      return;
    }
    let finalizeFailed = false;
    try {
      finalizeFailed = !(await finalizeConnectionsImport()).ok;
    } catch {
      finalizeFailed = true;
    }
    setState({ phase: "done", totals: result.totals, finalizeFailed });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="legacy-row">
        <div className="field-grow">
          <label htmlFor="connections-file">{l.connectionsFileLabel}</label>
          <input id="connections-file" name="file" type="file" accept=".csv" required />
        </div>
        <button type="submit" disabled={importing}>
          {importing ? l.connectionsImporting : l.connectionsSubmit}
        </button>
      </div>

      {state.phase === "importing" && state.total > 0 && (
        <div>
          <progress value={state.done} max={state.total} style={{ width: "100%" }} />
          <p className="muted mb-0">
            {fill(l.connectionsProgress, { done: state.done, total: state.total })}
          </p>
        </div>
      )}
      {state.phase === "done" && (
        <>
          <ImportOutcome
            report={state.totals.identityReport}
            labels={l}
            ownCompanySkippedBeforeMatching={state.totals.skippedOwnCompany}
            counts={state.totals}
          />
          {state.finalizeFailed && <p className="text-danger mb-0">{l.connectionsFinalizeFailed}</p>}
        </>
      )}
      {state.phase === "failed" && (
        <>
          <p className="text-danger mb-0">{state.message}</p>
          {state.totals && (
            <ImportOutcome
              report={state.totals.identityReport}
              labels={l}
              ownCompanySkippedBeforeMatching={state.totals.skippedOwnCompany}
              counts={state.totals}
            />
          )}
        </>
      )}
    </form>
  );
}
