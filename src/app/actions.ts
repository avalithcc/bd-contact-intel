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

export interface UploadResult {
  ok: boolean;
  imported?: number;
  error?: string;
}

export interface UploadMessagesResult {
  ok: boolean;
  conversations?: number;
  messages?: number;
  ownProfileKey?: string | null;
  // Coverage ratio (0-1) of the detected own profile — see
  // src/lib/messagesCsv.ts#detectOwnProfileKey.
  confidence?: number | null;
  // Set when detection confidence is low; the UI MUST surface this.
  ownProfileWarning?: string | null;
  // Set when the import succeeded but deleting the staged upload from
  // Storage failed — the import itself is not affected.
  cleanupWarning?: string;
  error?: string;
}

export async function uploadCsv(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a Connections.csv file first." };
  }
  try {
    const text = await file.text();
    const parsed = parseConnectionsCsv(text);
    if (!parsed.length) {
      return {
        ok: false,
        error:
          "No connections found. Make sure this is the LinkedIn Connections.csv export.",
      };
    }
    const me = await getCurrentBd();
    const imported = await upsertContacts(me.id, parsed);
    revalidatePath("/");
    return { ok: true, imported };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
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
    return { ok: false, error: "Missing uploaded file reference." };
  }

  try {
    const authUserId = await getCurrentAuthUserId();
    // Reject any path not under the caller's own folder — the client
    // supplies this string, so it must never be trusted implicitly. This
    // is the one line standing between a BD and reading another BD's
    // staged upload.
    if (!path.startsWith(`${authUserId}/`)) {
      return { ok: false, error: "Invalid file reference." };
    }

    const supabase = await createClient();
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(MESSAGES_IMPORT_BUCKET)
      .download(path);
    if (downloadError || !fileData) {
      return { ok: false, error: "Could not read the uploaded file. Please try again." };
    }

    const text = await fileData.text();
    const parsed = parseMessagesCsv(text);
    if (!parsed.messages.length) {
      return {
        ok: false,
        error: "No messages found. Make sure this is the LinkedIn messages.csv export.",
      };
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
      cleanupWarning: removeError
        ? "Import succeeded, but the staged upload could not be deleted from storage. Please remove it manually."
        : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
