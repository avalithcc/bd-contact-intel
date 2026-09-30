"use server";

/**
 * Server actions over src/lib/gmail/neverLog.ts, scoped to the signed-in
 * BD. No UI calls these yet — the never-log settings screen ships after a
 * mockup (email-sync brief, slice 5) — but the sync matcher already
 * enforces whatever rows exist here.
 */
import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import {
  addNeverLogEntry,
  listNeverLogEntries,
  removeNeverLogEntry,
  type NeverLogKind,
} from "@/lib/gmail/neverLog";

export async function listNeverLogEntriesAction() {
  const me = await getCurrentBd();
  return listNeverLogEntries(me.id);
}

export async function addNeverLogEntryAction(kind: NeverLogKind, value: string) {
  const me = await getCurrentBd();
  await addNeverLogEntry(me.id, kind, value);
  revalidatePath("/account/email");
}

export async function removeNeverLogEntryAction(id: string) {
  const me = await getCurrentBd();
  await removeNeverLogEntry(me.id, id);
  revalidatePath("/account/email");
}
