import { useCallback, useEffect, useRef, useState } from "react";
import { discardEmailAttachmentAction, registerEmailAttachmentAction } from "@/app/(app)/contacts/composeActions";
import { uploadAttachmentObject, type UploadHandle } from "@/lib/email/attachments/browserUpload";
import { attachmentTotals, planNewFiles, type DraftItem, type DraftRefusal } from "@/lib/email/attachments/draft";
import type { AttachmentRef } from "@/lib/email/attachments/load";
import { allowedTypeFor, sanitizeDisplayFilename, storageSafeName } from "@/lib/email/attachments/policy";
import { buildAttachmentPath } from "@/lib/email/attachments/storagePath";
import { createClient } from "@/lib/supabase/client";

/**
 * The composer's attachment list with uploads. Lives in the component that owns the composer (QuickActions for "Enviar
 * correo" and "Programar…", ReplyDialog for "Responder") so the files survive moving between dialogs.
 *
 * Each added file is checked (type, size, quota), uploaded straight to the private bucket with a progress bar, and then
 * registered on the server so a file nobody ends up sending is still known to the sweeper. A file removed or abandoned
 * before sending is deleted from Storage at once (`discardNew`); after a successful send the server deletes it.
 */
export interface AttachmentEntry extends DraftItem {
  contentType: string;
  progress: number;
  /** Why an errored file is errored. */
  reason?: DraftRefusal | "upload";
  storagePath?: string;
  /** Already held by a scheduled email: removing it from the list does not delete the object (saving does the rest). */
  existing?: boolean;
}

let counter = 0;
const nextKey = () => `att-${Date.now()}-${counter++}`;

export function useEmailAttachments() {
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const entriesRef = useRef<AttachmentEntry[]>([]);
  const uploads = useRef(new Map<string, UploadHandle>());

  const commit = useCallback((next: AttachmentEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);
  const patch = useCallback(
    (key: string, change: Partial<AttachmentEntry>) => commit(entriesRef.current.map((e) => (e.key === key ? { ...e, ...change } : e))),
    [commit],
  );

  const startUpload = useCallback(
    async (key: string, file: File) => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const type = allowedTypeFor(file.name);
      if (!data.session || !type) return patch(key, { status: "error", reason: "upload" });
      const storagePath = buildAttachmentPath(data.session.user.id, crypto.randomUUID(), storageSafeName(file.name));
      const handle = uploadAttachmentObject({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        accessToken: data.session.access_token,
        path: storagePath,
        file,
        contentType: type.contentType,
        onProgress: (progress) => patch(key, { progress }),
      });
      uploads.current.set(key, handle);
      const result = await handle.done;
      uploads.current.delete(key);
      if (!entriesRef.current.some((e) => e.key === key)) {
        // Removed while uploading: whatever reached Storage goes too.
        if (result.ok) void discardEmailAttachmentAction(storagePath);
        return;
      }
      if (!result.ok) return patch(key, { status: "error", reason: "upload" });
      const registered = await registerEmailAttachmentAction({ storagePath, filename: sanitizeDisplayFilename(file.name), contentType: type.contentType, size: file.size });
      if (!registered.ok) {
        void discardEmailAttachmentAction(storagePath);
        return patch(key, { status: "error", reason: "upload" });
      }
      patch(key, { status: "ready", progress: 100, storagePath });
    },
    [patch],
  );

  const add = useCallback(
    (files: File[]) => {
      const plans = planNewFiles(entriesRef.current, files);
      const added: AttachmentEntry[] = files.map((file, i) => {
        const plan = plans[i]!;
        const base = { key: nextKey(), filename: sanitizeDisplayFilename(file.name), size: file.size, contentType: file.type, progress: 0 };
        return plan.ok ? { ...base, status: "uploading" as const } : { ...base, status: "error" as const, reason: plan.reason };
      });
      commit([...entriesRef.current, ...added]);
      added.forEach((entry, i) => {
        if (entry.status === "uploading") void startUpload(entry.key, files[i]!);
      });
    },
    [commit, startUpload],
  );

  const remove = useCallback(
    (key: string) => {
      const entry = entriesRef.current.find((e) => e.key === key);
      if (!entry) return;
      uploads.current.get(key)?.abort();
      commit(entriesRef.current.filter((e) => e.key !== key));
      if (entry.storagePath && !entry.existing) void discardEmailAttachmentAction(entry.storagePath);
    },
    [commit],
  );

  /** Forget everything without deleting: the email went out (the server deleted the objects) or was scheduled (it holds them). */
  const clear = useCallback(() => {
    uploads.current.forEach((u) => u.abort());
    uploads.current.clear();
    commit([]);
  }, [commit]);

  /** The composer was closed without sending: delete what was uploaded for it and forget the list. */
  const discardNew = useCallback(() => {
    uploads.current.forEach((u) => u.abort());
    uploads.current.clear();
    for (const e of entriesRef.current) if (e.storagePath && !e.existing) void discardEmailAttachmentAction(e.storagePath);
    commit([]);
  }, [commit]);

  /** Load the files a scheduled email already holds (reschedule). */
  const seed = useCallback(
    (items: { filename: string; size: number; storagePath: string; contentType: string }[]) =>
      commit(items.map((i) => ({ key: nextKey(), filename: i.filename, size: i.size, contentType: i.contentType, status: "ready" as const, progress: 100, storagePath: i.storagePath, existing: true }))),
    [commit],
  );

  useEffect(() => () => uploads.current.forEach((u) => u.abort()), []);

  const refs: AttachmentRef[] = entries
    .filter((e) => e.status === "ready" && e.storagePath)
    .map((e) => ({ storagePath: e.storagePath!, filename: e.filename, contentType: e.contentType, size: e.size }));

  return { entries, add, remove, clear, discardNew, seed, refs, totals: attachmentTotals(entries) };
}

export type EmailAttachments = ReturnType<typeof useEmailAttachments>;
