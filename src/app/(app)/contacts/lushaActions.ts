"use server";

// Thin shells over the Lusha reveal orchestration (src/lib/lusha/reveal.ts). Authorization: any BD
// (getCurrentBd), not admin-only. Every spend is one explicit call: nothing here retries, loops or batches.
// Only LushaReveal.tsx imports this file (tests/unit/lushaInert.test.ts pins it).

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { isUuid } from "@/lib/uuid";
import { livePorts } from "@/lib/lusha/ports";
import { applyStoredReveal } from "@/lib/lusha/revealDb";
import { getLushaUsage, rejectLushaMatch, revealLushaField, searchLushaContact } from "@/lib/lusha/reveal";
import { actionFailure } from "./actionErrors";

type Field = "emails" | "phones";
type Failure = { ok: false; reason: ReturnType<typeof actionFailure>["reason"]; retryable: boolean; permanent: boolean; remaining?: number };

// Unclassified errors (and redirect()/notFound()) go through actionFailure, which rethrows Next's control-flow errors first.
const rejected = (reason: Failure["reason"]): Failure => ({ ok: false, reason, retryable: false, permanent: false });
const isField = (v: unknown): v is Field => v === "emails" || v === "phones";

export async function searchLushaContactAction(personId: string, field: Field) {
  try {
    const me = await getCurrentBd(); // authenticate first, then validate
    if (!isUuid(personId)) return rejected("not_found");
    if (!isField(field)) return rejected("lusha_not_eligible");
    const result = await searchLushaContact({ personId, field, actorBdId: me.id }, livePorts());
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    const failed = actionFailure(err);
    return { ...failed, retryable: false, permanent: false };
  }
}

const isExpect = (v: unknown): v is { searchId: string; price: number } =>
  typeof v === "object" && v !== null && isUuid((v as { searchId?: unknown }).searchId as string) && Number.isSafeInteger((v as { price?: unknown }).price);

/** `expect` is what the BD confirmed on screen (the search and the price); the server refuses anything else. */
export async function revealLushaFieldAction(personId: string, field: Field, expect: { searchId: string; price: number }) {
  try {
    const me = await getCurrentBd(); // authenticate first, then validate
    if (!isUuid(personId)) return rejected("not_found");
    if (!isField(field)) return rejected("lusha_not_eligible");
    if (!isExpect(expect)) return rejected("lusha_stale");
    const result = await revealLushaField({ personId, field, actorBdId: me.id, expect }, livePorts());
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    const failed = actionFailure(err);
    return { ...failed, retryable: false, permanent: false };
  }
}

export async function rejectLushaMatchAction(personId: string) {
  try {
    const me = await getCurrentBd(); // authenticate first, then validate
    if (!isUuid(personId)) return rejected("not_found");
    const result = await rejectLushaMatch({ personId, actorBdId: me.id }, livePorts());
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    const failed = actionFailure(err);
    return { ...failed, retryable: false, permanent: false };
  }
}

/** Free and display-only: a failure here must never block a reveal. */
export async function getLushaAccountUsageAction() {
  try {
    await getCurrentBd();
    return await getLushaUsage(livePorts());
  } catch (err) {
    const failed = actionFailure(err);
    return { ...failed, retryable: false, permanent: false };
  }
}

/** Task 6.11: applies a paid value that is sitting on the ledger because the Contact write failed. Never calls Lusha, never spends. */
export async function applyStoredLushaValueAction(personId: string, field: Field) {
  try {
    const me = await getCurrentBd(); // authenticate first, then validate
    if (!isUuid(personId)) return rejected("not_found");
    if (!isField(field)) return rejected("lusha_not_eligible");
    await assertContactEditableById(personId);
    const result = await applyStoredReveal({ personId, field, actorBdId: me.id });
    if (!result.ok) return rejected("lusha_not_eligible");
    revalidatePath(`/contacts/${personId}`);
    return result;
  } catch (err) {
    const failed = actionFailure(err);
    return { ...failed, retryable: false, permanent: false };
  }
}
