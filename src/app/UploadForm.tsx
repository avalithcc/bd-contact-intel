"use client";

import { useActionState } from "react";
import { uploadCsv, type UploadResult } from "./actions";

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(
    uploadCsv,
    null,
  );

  return (
    <form action={action}>
      <div className="row">
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="file">LinkedIn Connections.csv</label>
          <input id="file" name="file" type="file" accept=".csv" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
      {state?.ok && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Imported {state.imported} contacts.
        </p>
      )}
      {state && !state.ok && (
        <p style={{ color: "#ff6b6b", marginBottom: 0 }}>{state.error}</p>
      )}
    </form>
  );
}
