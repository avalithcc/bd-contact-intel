"use server";

// Thin shells over the Lusha reveal orchestration (src/lib/lusha/reveal.ts). Authorization: any BD
// (getCurrentBd), not admin-only. Every spend is one explicit call: nothing here retries, loops or batches.
// PR 5 ships these unreferenced; no component imports them until the UI PR.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { isUuid } from "@/lib/uuid";
import { livePorts } from "@/lib/lusha/ports";
import { getLushaUsage, rejectLushaMatch, revealLushaField, searchLushaContact } from "@/lib/lusha/reveal";
import { actionFailure } from "./actionErrors";

type Field = "emails" | "phones";
type Failure = { ok: false; reason: ReturnType<typeof actionFailure>["reason"]; retryable: boolean; permanent: boolean; remaining?: number };

// Unclassified errors (and redirect()/notFound()) go through actionFailure: rethrown or typed, never a raw message.
const failure = (err: unknown): Failure => ({ ...actionFailure(err), retryable: false, permanent: false });
const rejected = (reason: Failure["reason"]): Failure => ({ ok: false, reason, retryable: false, permanent: false });
const isField = (v: unknown): v is Field => v === "emails" || v === "phones";

export async function searchLushaContactAction(personId: string, field: Field) {
  try {
    if (!isUuid(personId)) return rejected("not_found");
    if (!isField(field)) return rejected("lusha_not_eligible");
    const me = await getCurrentBd();
    const result = await searchLushaContact({ personId, field, actorBdId: me.id }, livePorts());
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return failure(err);
  }
}

export async function revealLushaFieldAction(personId: string, field: Field) {
  try {
    if (!isUuid(personId)) return rejected("not_found");
    if (!isField(field)) return rejected("lusha_not_eligible");
    const me = await getCurrentBd();
    const result = await revealLushaField({ personId, field, actorBdId: me.id }, livePorts());
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return failure(err);
  }
}

export async function rejectLushaMatchAction(personId: string) {
  try {
    if (!isUuid(personId)) return rejected("not_found");
    const me = await getCurrentBd();
    const result = await rejectLushaMatch({ personId, actorBdId: me.id }, livePorts());
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return failure(err);
  }
}

/** Free and display-only: a failure here must never block a reveal. */
export async function getLushaAccountUsageAction() {
  try {
    await getCurrentBd();
    return await getLushaUsage(livePorts());
  } catch (err) {
    unstable_rethrow(err);
    return failure(err);
  }
}
