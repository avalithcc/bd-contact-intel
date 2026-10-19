"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { parseConnectionsCsv } from "@/lib/csv";
import { parseMessagesCsv } from "@/lib/messagesCsv";
import {
  getCurrentAuthUserId,
  getCurrentBd,
  importMessages,
  recomputeMessageSignals,
  upsertContacts,
} from "@/lib/queries";
import {
  emptyImportTotals,
  sanitizeConnectionsBatch,
  type ImportBatchOutcome,
} from "@/lib/contacts/importBatches";
import type { IdentityIngestReport } from "@/lib/identity/ingestWrite";
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
  // Contacts dropped because they belong to Avalith itself (a BD's own
  // coworker imported alongside their real connections) — see
  // src/lib/ownCompany.ts and src/lib/queries.ts#upsertContacts.
  skippedOwnCompany?: number;
  // Dedup outcome from the identity resolver (task 14.2's `/contacts/import`
  // outcome summary) — null when IDENTITY_DUAL_WRITE is off.
  identityReport?: IdentityIngestReport | null;
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
    const { imported, skippedOwnCompany, identityReport } = await upsertContacts(me.id, parsed);
    revalidatePath("/");
    revalidatePath("/contacts");
    // The form that calls this lives on /contacts/import, so that page has to
    // be revalidated too or a successful import leaves its own screen stale.
    revalidatePath("/contacts/import");
    return { ok: true, imported, skippedOwnCompany, identityReport };
  } catch (err) {
    unstable_rethrow(err);
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}

export type ImportBatchResult =
  | { ok: true; outcome: ImportBatchOutcome }
  | { ok: false; errorKey: UploadErrorKey };

/**
 * One batch of the browser-driven connections import (the browser parses the
 * CSV and sends ~1,000 rows per call; a single 13k-row action exceeded
 * Vercel's 300 s limit). Same write path as `uploadCsv`: bd scoping comes from
 * the session, never from the payload, and the own-company skip lives in
 * `upsertContacts`. Idempotent: a retried batch reports its rows as unchanged.
 */
export async function importConnectionsBatch(rows: unknown): Promise<ImportBatchResult> {
  try {
    // Auth first: an unauthenticated caller learns nothing about batch validity.
    const me = await getCurrentBd();
    const batch = sanitizeConnectionsBatch(rows);
    if (!batch) return { ok: false, errorKey: "genericFailed" };
    if (!batch.length) return { ok: true, outcome: emptyImportTotals() };
    const { created, updated, unchanged, skippedOwnCompany, identityReport } = await upsertContacts(me.id, batch);
    revalidatePath("/contacts");
    return { ok: true, outcome: { created, updated, unchanged, skippedOwnCompany, identityReport } };
  } catch (err) {
    unstable_rethrow(err);
    console.error("importConnectionsBatch failed", err);
    return { ok: false, errorKey: "genericFailed" };
  }
}

/**
 * Last call of a connections import: people imported after their LinkedIn
 * messages have no sent/received counts or status yet (the signals are only
 * computed from the messages side), so fill in just those. Safe to call after
 * a partial run too: it only touches contacts still at zero.
 */
export async function finalizeConnectionsImport(): Promise<{ ok: boolean }> {
  try {
    const me = await getCurrentBd();
    await recomputeMessageSignals(me.id, "unsignalled");
    revalidatePath("/");
    revalidatePath("/contacts");
    revalidatePath("/contacts/import");
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error("finalizeConnectionsImport failed", err);
    return { ok: false };
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
    // The form that calls this lives on /account/linkedin-messages, and
    // /account shows the same counts in its Importación row. Both read
    // getMessageImportStats, so both go stale after a successful import
    // unless they are revalidated here.
    revalidatePath("/account");
    revalidatePath("/account/linkedin-messages");
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
    unstable_rethrow(err);
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}
