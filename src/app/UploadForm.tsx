"use client";

import { useActionState } from "react";
import { uploadCsv, uploadMessagesCsv, type UploadResult, type UploadMessagesResult } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { MESSAGES_IMPORT_BUCKET } from "@/lib/storage";

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

/**
 * Import control for LinkedIn's `messages.csv` export (see
 * src/lib/messagesCsv.ts). Separate from `UploadForm` above since it's a
 * distinct export with a different shape and a much larger typical file
 * size (~6.5MB), which is too big for a server action's request body on
 * Vercel (capped around 4.5MB regardless of Next.js's own
 * `serverActions.bodySizeLimit`).
 *
 * Instead: the browser uploads the file straight to Supabase Storage with
 * the user's own authenticated session (namespaced under their auth user
 * id), then calls the `uploadMessagesCsv` server action with only the
 * resulting storage path — a short string with no body-size problem. See
 * src/lib/storage.ts and README.md for the required bucket + RLS setup.
 */
async function uploadMessagesViaStorage(
  _prev: UploadMessagesResult | null,
  formData: FormData,
): Promise<UploadMessagesResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a messages.csv file first." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not authenticated. Please sign in again." };
  }

  const path = `${user.id}/messages-${Date.now()}.csv`;
  const { error: uploadError } = await supabase.storage
    .from(MESSAGES_IMPORT_BUCKET)
    .upload(path, file, { contentType: "text/csv" });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const serverFormData = new FormData();
  serverFormData.set("path", path);
  return uploadMessagesCsv(_prev, serverFormData);
}

export function UploadMessagesForm() {
  const [state, action, pending] = useActionState<UploadMessagesResult | null, FormData>(
    uploadMessagesViaStorage,
    null,
  );

  return (
    <form action={action}>
      <div className="row">
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="messagesFile">LinkedIn messages.csv</label>
          <input id="messagesFile" name="file" type="file" accept=".csv" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
      {state?.ok && (
        <>
          <p className="muted" style={{ marginBottom: 0 }}>
            Imported {state.messages} messages across {state.conversations} conversations
            {state.ownProfileKey ? ` (detected sender: ${state.ownProfileKey}` : ""}
            {state.confidence != null ? `, confidence ${Math.round(state.confidence * 100)}%)` : state.ownProfileKey ? ")" : ""}
            .
          </p>
          {state.ownProfileWarning && (
            <p style={{ color: "#e6a23c", marginBottom: 0 }}>{state.ownProfileWarning}</p>
          )}
          {state.cleanupWarning && (
            <p style={{ color: "#e6a23c", marginBottom: 0 }}>{state.cleanupWarning}</p>
          )}
        </>
      )}
      {state && !state.ok && (
        <p style={{ color: "#ff6b6b", marginBottom: 0 }}>{state.error}</p>
      )}
    </form>
  );
}
