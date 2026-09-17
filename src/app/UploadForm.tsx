"use client";

import { useActionState } from "react";
import { uploadCsv, uploadMessagesCsv, type UploadResult, type UploadMessagesResult } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { MESSAGES_IMPORT_BUCKET } from "@/lib/storage";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

export function UploadForm({ locale }: { locale: Locale }) {
  const dict = t(locale);
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(
    uploadCsv,
    null,
  );

  return (
    <form action={action}>
      <div className="row">
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="file">{dict.upload.connectionsLabel}</label>
          <input id="file" name="file" type="file" accept=".csv" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? dict.upload.importing : dict.upload.import}
        </button>
      </div>
      {state?.ok && (
        <p className="muted" style={{ marginBottom: 0 }}>
          {dict.upload.importedContacts(state.imported ?? 0)}
        </p>
      )}
      {state && !state.ok && (
        <p style={{ color: "#ff6b6b", marginBottom: 0 }}>
          {state.errorKey ? dict.upload.connectionsErrors[state.errorKey] : null}
          {state.errorDetail ? ` ${state.errorDetail}` : ""}
        </p>
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
function makeUploadMessagesViaStorage(locale: Locale) {
  const dict = t(locale);
  return async function uploadMessagesViaStorage(
    _prev: UploadMessagesResult | null,
    formData: FormData,
  ): Promise<UploadMessagesResult> {
    // These three checks never reach the server action, so there is no
    // language-neutral boundary to cross — this closure already has the
    // resolved dictionary, so it builds the final text directly instead of
    // going through an errorKey.
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, errorDetail: dict.upload.messagesErrors.missingFile };
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { ok: false, errorDetail: dict.upload.messagesErrors.notAuthenticated };
    }

    const path = `${user.id}/messages-${Date.now()}.csv`;
    const { error: uploadError } = await supabase.storage
      .from(MESSAGES_IMPORT_BUCKET)
      .upload(path, file, { contentType: "text/csv" });
    if (uploadError) {
      return {
        ok: false,
        errorDetail: `${dict.upload.messagesErrors.storageUploadFailedPrefix}${uploadError.message}`,
      };
    }

    const serverFormData = new FormData();
    serverFormData.set("path", path);
    return uploadMessagesCsv(_prev, serverFormData);
  };
}

export function UploadMessagesForm({ locale }: { locale: Locale }) {
  const dict = t(locale);
  const [state, action, pending] = useActionState<UploadMessagesResult | null, FormData>(
    makeUploadMessagesViaStorage(locale),
    null,
  );

  return (
    <form action={action}>
      <div className="row">
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="messagesFile">{dict.upload.messagesLabel}</label>
          <input id="messagesFile" name="file" type="file" accept=".csv" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? dict.upload.importing : dict.upload.import}
        </button>
      </div>
      {state?.ok && (
        <>
          <p className="muted" style={{ marginBottom: 0 }}>
            {dict.upload.importedMessages(state.messages ?? 0, state.conversations ?? 0)}
            {state.ownProfileKey ? dict.upload.detectedSender(state.ownProfileKey) : ""}
            {state.confidence != null
              ? dict.upload.withConfidence(Math.round(state.confidence * 100))
              : state.ownProfileKey
                ? dict.upload.closeParen
                : ""}
            .
          </p>
          {state.ownProfileWarning && (
            <p style={{ color: "#e6a23c", marginBottom: 0 }}>{state.ownProfileWarning}</p>
          )}
          {state.cleanupFailed && (
            <p style={{ color: "#e6a23c", marginBottom: 0 }}>{dict.upload.cleanupWarning}</p>
          )}
        </>
      )}
      {state && !state.ok && (
        <p style={{ color: "#ff6b6b", marginBottom: 0 }}>
          {state.errorKey ? dict.upload.messagesErrors[state.errorKey] : state.errorDetail}
          {state.errorKey === "genericFailed" && state.errorDetail ? ` ${state.errorDetail}` : ""}
        </p>
      )}
    </form>
  );
}
