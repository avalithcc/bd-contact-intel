"use client";

import { fillTemplate } from "@/lib/i18n/template";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadAttachmentObject } from "@/lib/email/attachments/browserUpload";
import { sanitizeDisplayFilename } from "@/lib/email/attachments/policy";
import { createClient } from "@/lib/supabase/client";
import { TENDER_DOCUMENTS_BUCKET, checkTenderDocument, tenderDocumentPath } from "@/lib/tenders/document";

/**
 * Uploads a pliego straight from the browser to the private bucket with the signed-in user's own token (a server action
 * body is capped near 4.5 MB on Vercel), then tells the server which path it is. The server re-checks everything.
 */
export function TenderDocumentUpload({
  tenderId,
  register,
  labels,
}: {
  tenderId: string;
  register: (input: { tenderId: string; storagePath: string; filename: string; size: number }) => Promise<{ ok: boolean }>;
  labels: { label: string; help: string; uploading: string; errors: Record<string, string> };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `tender-doc-${tenderId}`;

  async function onPick(file: File) {
    setError(null);
    const verdict = checkTenderDocument({ filename: file.name, contentType: file.type, size: file.size });
    if (!verdict.ok) return setError(labels.errors[verdict.reason] ?? "");
    const { data } = await createClient().auth.getSession();
    if (!data.session) return setError(labels.errors.notAuthenticated ?? "");
    const storagePath = tenderDocumentPath(data.session.user.id, crypto.randomUUID(), file.name);
    setProgress(0);
    const result = await uploadAttachmentObject({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      accessToken: data.session.access_token,
      bucket: TENDER_DOCUMENTS_BUCKET,
      path: storagePath,
      file,
      contentType: "application/pdf",
      onProgress: setProgress,
    }).done;
    const registered = result.ok ? await register({ tenderId, storagePath, filename: sanitizeDisplayFilename(file.name), size: file.size }).catch(() => ({ ok: false })) : { ok: false };
    setProgress(null);
    if (input.current) input.current.value = "";
    if (!registered.ok) return setError(labels.errors.upload ?? "");
    router.refresh();
  }

  return (
    <div className="field">
      <label className="label" htmlFor={fieldId}>
        {labels.label}
      </label>
      <input
        id={fieldId}
        ref={input}
        className="input"
        type="file"
        accept="application/pdf,.pdf"
        disabled={progress !== null}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
        }}
      />
      <span className="help">{progress !== null ? fillTemplate(labels.uploading, { percent: String(progress) }) : labels.help}</span>
      {error && (
        <span role="alert" className="error-text">
          {error}
        </span>
      )}
    </div>
  );
}
