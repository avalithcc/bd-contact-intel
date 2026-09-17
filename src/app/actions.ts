"use server";

import { revalidatePath } from "next/cache";
import { parseConnectionsCsv } from "@/lib/csv";
import { parseMessagesCsv } from "@/lib/messagesCsv";
import {
  getCurrentAuthUserId,
  getCurrentBd,
  importMessages,
  upsertContacts,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { MESSAGES_IMPORT_BUCKET } from "@/lib/storage";

// Stable keys, not translated text — the server action must not decide the
// visitor's language. The UI (src/app/UploadForm.tsx) maps these to
// localized copy at render time via src/lib/i18n/dictionaries.
export type UploadErrorKey = "missingFile" | "noConnectionsFound" | "genericFailed";
export type UploadMessagesErrorKey =
  | "missingFileRef"
  | "invalidFileRef"
  | "downloadFailed"
  | "noMessagesFound"
  | "genericFailed";

export interface UploadResult {
  ok: boolean;
  imported?: number;
  errorKey?: UploadErrorKey;
  // Raw message from an unexpected (not specifically handled) exception —
  // technical/diagnostic only, intentionally left untranslated like any
  // other caught error detail. See errorKey for the localized headline.
  errorDetail?: string;
}

export interface UploadMessagesResult {
  ok: boolean;
  conversations?: number;
  messages?: number;
  ownProfileKey?: string | null;
  // Coverage ratio (0-1) of the detected own profile — see
  // src/lib/messagesCsv.ts#detectOwnProfileKey.
  confidence?: number | null;
  // Set when detection confidence is low; the UI MUST surface this. Left
  // untranslated: it's produced deep inside the CSV parser (messagesCsv.ts)
  // and shared verbatim with scripts/import-messages.ts's console output —
  // restructuring it into a translatable key would change that parser's
  // return shape beyond a string swap, which is out of scope here.
  ownProfileWarning?: string | null;
  // Set when the import succeeded but deleting the staged upload from
  // Storage failed — the import itself is not affected.
  cleanupFailed?: boolean;
  errorKey?: UploadMessagesErrorKey;
  errorDetail?: string;
}

export async function uploadCsv(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, errorKey: "missingFile" };
  }
  try {
    const text = await file.text();
    const parsed = parseConnectionsCsv(text);
    if (!parsed.length) {
      return { ok: false, errorKey: "noConnectionsFound" };
    }
    const me = await getCurrentBd();
    const imported = await upsertContacts(me.id, parsed);
    revalidatePath("/");
    return { ok: true, imported };
  } catch (err) {
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}

/**
 * Receives only a Supabase Storage path (see src/lib/storage.ts) instead of
 * the file body — the browser already uploaded the ~6.5MB export directly
 * to Storage with its own session (src/app/UploadForm.tsx), which sidesteps
 * Vercel's ~4.5MB request body cap that a server action would otherwise hit.
 *
 * The path is never trusted at face value: it MUST be namespaced under the
 * caller's own auth user id, checked below before anything is downloaded.
 */
export async function uploadMessagesCsv(
  _prev: UploadMessagesResult | null,
  formData: FormData,
): Promise<UploadMessagesResult> {
  const path = formData.get("path");
  if (typeof path !== "string" || !path) {
    return { ok: false, errorKey: "missingFileRef" };
  }

  try {
    const authUserId = await getCurrentAuthUserId();
    // Reject any path not under the caller's own folder — the client
    // supplies this string, so it must never be trusted implicitly. This
    // is the one line standing between a BD and reading another BD's
    // staged upload.
    if (!path.startsWith(`${authUserId}/`)) {
      return { ok: false, errorKey: "invalidFileRef" };
    }

    const supabase = await createClient();
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(MESSAGES_IMPORT_BUCKET)
      .download(path);
    if (downloadError || !fileData) {
      return { ok: false, errorKey: "downloadFailed" };
    }

    const text = await fileData.text();
    const parsed = parseMessagesCsv(text);
    if (!parsed.messages.length) {
      return { ok: false, errorKey: "noMessagesFound" };
    }

    const me = await getCurrentBd();
    const { conversations, messages } = await importMessages(me.id, parsed);

    // Best-effort cleanup: message content is sensitive, so don't leave the
    // staged export sitting in Storage longer than needed. A failure here
    // must not fail the import — just surface it to the caller.
    const { error: removeError } = await supabase.storage
      .from(MESSAGES_IMPORT_BUCKET)
      .remove([path]);

    revalidatePath("/");
    return {
      ok: true,
      conversations,
      messages,
      ownProfileKey: parsed.ownProfileKey,
      confidence: parsed.ownProfileConfidence,
      ownProfileWarning: parsed.ownProfileWarning,
      cleanupFailed: Boolean(removeError),
    };
  } catch (err) {
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}
