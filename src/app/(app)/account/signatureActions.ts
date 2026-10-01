"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { prepareSignatureForSave, type SignatureSaveResult } from "@/lib/signature/validate";
import { sanitizeSignatureHtml, SIGNATURE_MAX_CHARS } from "@/lib/signature/sanitize";
import { saveOwnSignature } from "@/lib/signature/saveDb";

export type SaveSignatureResult =
  | { ok: true; html: string | null }
  | { ok: false; error: Extract<SignatureSaveResult, { ok: false }>["error"] | "unexpected" };

/**
 * Saves the CURRENT BD's signature (never another BD's: the id comes from
 * the session, not from the client). Sanitizes on the way in; the stored
 * value is what the preview showed. Blank input clears it. Every save writes
 * an audit_log row with the actor (saveOwnSignature).
 */
export async function saveSignatureAction(raw: string): Promise<SaveSignatureResult> {
  const prepared = prepareSignatureForSave(raw);
  if (!prepared.ok) return prepared;
  try {
    const me = await getCurrentBd();
    await saveOwnSignature(me.id, me.signatureHtml, prepared.html);
    revalidatePath("/account");
    return { ok: true, html: prepared.html };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[account] saveSignatureAction failed", err);
    return { ok: false, error: "unexpected" };
  }
}

/**
 * Live preview: runs the SAME sanitizer as the save, so the BD sees what
 * recipients get, not what they typed. Touches no data (pure function of the
 * input, capped at SIGNATURE_MAX_CHARS before parsing); the middleware has
 * already required a session for this route.
 */
export async function previewSignatureAction(raw: string): Promise<string> {
  if (typeof raw !== "string" || raw.length > SIGNATURE_MAX_CHARS) return "";
  return sanitizeSignatureHtml(raw);
}
