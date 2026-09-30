"use server";

/**
 * Server actions over src/lib/gmail/neverLog.ts, scoped to the signed-in
 * BD. Backs /account/email/never-log (email-sync.html screen 3) — the
 * per-BD "Nunca registrar" settings screen (README decision 2: its own
 * route under the Gmail connection page, decision 3: strictly per-BD
 * self-service, no admin view of another BD's list).
 */
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import {
  addNeverLogEntry,
  listNeverLogEntries,
  removeNeverLogEntry,
  type NeverLogKind,
} from "@/lib/gmail/neverLog";
import { validateNeverLogInput, type NeverLogValidationResult } from "@/lib/gmail/neverLogRules";
import type { EmailNeverLog } from "@/db/schema";

export async function listNeverLogEntriesAction(): Promise<EmailNeverLog[]> {
  const me = await getCurrentBd();
  return listNeverLogEntries(me.id);
}

export type AddNeverLogEntryResult =
  | { ok: true; entries: EmailNeverLog[] }
  | { ok: false; error: Extract<NeverLogValidationResult, { ok: false }>["error"] | "unexpected" };

/** Validates + normalizes before writing (fix: the old version wrote whatever the form sent, unvalidated). */
export async function addNeverLogEntryAction(kind: NeverLogKind, rawValue: string): Promise<AddNeverLogEntryResult> {
  const validated = validateNeverLogInput(kind, rawValue);
  if (!validated.ok) return { ok: false, error: validated.error };
  try {
    const me = await getCurrentBd();
    await addNeverLogEntry(me.id, kind, validated.value);
    revalidatePath("/account/email/never-log");
    return { ok: true, entries: await listNeverLogEntries(me.id) };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[account/email/never-log] add failed", err);
    return { ok: false, error: "unexpected" };
  }
}

export type RemoveNeverLogEntryResult = { ok: true } | { ok: false; error: "unexpected" };

export async function removeNeverLogEntryAction(id: string): Promise<RemoveNeverLogEntryResult> {
  try {
    const me = await getCurrentBd();
    await removeNeverLogEntry(me.id, id);
    revalidatePath("/account/email/never-log");
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[account/email/never-log] remove failed", err);
    return { ok: false, error: "unexpected" };
  }
}
