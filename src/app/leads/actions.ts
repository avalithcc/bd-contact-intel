"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { GatewayError } from "@ai-sdk/gateway";
import { db } from "@/db";
import { signal } from "@/db/schema";
import { buildLeadDrafts, type LeadCsvBundle } from "@/lib/leads/csv";
import {
  getLeadById,
  importLeads,
  updateLeadOwner,
  updateLeadStatus,
} from "@/lib/leads/queries";
import { getCurrentBd } from "@/lib/queries";
import { buildOutreachEmailPrompt } from "@/lib/outreach/emailPrompt";
import { sendGmailMessage } from "@/lib/gmail/send";
import { isLeadStatusKey, type LeadStatusKey } from "@/lib/leads/types";

// Same gateway catalog check as OUTREACH_MODEL in src/app/outreach/actions.ts.
const OUTREACH_EMAIL_MODEL = "anthropic/claude-sonnet-5";

// Stable keys, not translated text — server actions must not decide the
// visitor's language (see src/app/actions.ts for the same convention).
export type ImportLeadsErrorKey = "missingSourceKey" | "missingFiles" | "genericFailed";

export interface ImportLeadsResult {
  ok: boolean;
  upserted?: number;
  matchedOwners?: string[];
  unmatchedOwners?: string[];
  errorKey?: ImportLeadsErrorKey;
  errorDetail?: string;
}

async function fileText(formData: FormData, field: string): Promise<string | undefined> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file.text();
}

/**
 * Import server action backing the /leads upload control (see
 * UploadLeadsForm.tsx). All the source files are small (a few hundred KB at
 * most), well under a server action's request body cap, so — unlike
 * messages.csv (see src/app/actions.ts#uploadMessagesCsv) — this does not
 * need the Supabase Storage indirection.
 */
export async function importLeadsCsv(
  _prev: ImportLeadsResult | null,
  formData: FormData,
): Promise<ImportLeadsResult> {
  // Writes to shared team data, so it verifies the session itself rather
  // than relying on middleware alone (throws when not authenticated).
  await getCurrentBd();
  const sourceKey = String(formData.get("sourceKey") ?? "").trim();
  const sourceName = String(formData.get("sourceName") ?? "").trim() || sourceKey;
  if (!sourceKey) return { ok: false, errorKey: "missingSourceKey" };

  try {
    const bundle: LeadCsvBundle = {
      attendees: await fileText(formData, "attendees"),
      decisores: await fileText(formData, "decisores"),
      hunter: await fileText(formData, "hunter"),
      probables: await fileText(formData, "probables"),
      correosFinal: await fileText(formData, "correosFinal"),
      columnaCorreos: await fileText(formData, "columnaCorreos"),
    };
    const hasAnyFile = Object.values(bundle).some((v) => v !== undefined);
    if (!hasAnyFile) return { ok: false, errorKey: "missingFiles" };

    const drafts = buildLeadDrafts(bundle);
    const result = await importLeads(sourceKey, sourceName, drafts);
    revalidatePath("/leads");
    return {
      ok: true,
      upserted: result.upserted,
      matchedOwners: result.matchedOwners,
      unmatchedOwners: result.unmatchedOwners,
    };
  } catch (err) {
    return {
      ok: false,
      errorKey: "genericFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}

export interface UpdateLeadStatusResult {
  ok: boolean;
  errorDetail?: string;
}

/** Any signed-in BD may edit a lead's status/notes — leads are shared, not per-BD. */
export async function updateLeadStatusAction(
  leadId: string,
  fields: { status?: string; notes?: string },
): Promise<UpdateLeadStatusResult> {
  try {
    const me = await getCurrentBd();
    const status: LeadStatusKey | undefined = isLeadStatusKey(fields.status)
      ? fields.status
      : undefined;
    await updateLeadStatus(leadId, me.id, { status, notes: fields.notes });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    return { ok: false, errorDetail: err instanceof Error ? err.message : undefined };
  }
}

/** Any signed-in BD may reassign a lead's owner. `ownerBdId` empty/null = unassign. */
export async function updateLeadOwnerAction(
  leadId: string,
  ownerBdId: string | null,
): Promise<UpdateLeadStatusResult> {
  try {
    const me = await getCurrentBd();
    await updateLeadOwner(leadId, me.id, ownerBdId || null);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (err) {
    return { ok: false, errorDetail: err instanceof Error ? err.message : undefined };
  }
}

export type DraftLeadEmailResult =
  | { ok: true; subject: string; body: string; signalCount: number }
  | { ok: false; errorKey: "notFound" | "gatewayNotConfigured" | "generationFailed" };

/**
 * Drafts a cold outreach email for `leadId`, grounded only in the lead's own
 * fields and any signals a BD pasted for them. Pure generation — nothing is
 * sent and nothing is persisted until the BD explicitly sends it.
 */
export async function draftLeadEmailAction(
  leadId: string,
): Promise<DraftLeadEmailResult> {
  const me = await getCurrentBd();
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, errorKey: "notFound" };

  const signalRows = await db
    .select({ data: signal.data })
    .from(signal)
    .where(eq(signal.leadId, leadId))
    .orderBy(desc(signal.createdAt))
    .limit(10);

  const signals = signalRows
    .map((row) => (row.data as { body?: string } | null)?.body?.trim())
    .filter((body): body is string => Boolean(body));

  const { system, prompt } = buildOutreachEmailPrompt({
    lead: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      jobTitle: lead.jobTitle,
      companyDisplay: lead.companyDisplay,
      seniority: lead.seniority,
    },
    signals,
    senderName: me.name ?? "Avalith",
  });

  try {
    const { text } = await generateText({ model: OUTREACH_EMAIL_MODEL, system, prompt });
    // Tolerate a missing blank line after the subject — the model occasionally
    // drops it, and that alone should not fail the whole draft.
    const match = text.match(/^\s*Subject:\s*(.+?)\n([\s\S]+)$/);
    if (!match) return { ok: false, errorKey: "generationFailed" };

    return {
      ok: true,
      subject: match[1]!.trim(),
      body: match[2]!.trim(),
      signalCount: signals.length,
    };
  } catch (err) {
    if (err instanceof GatewayError) return { ok: false, errorKey: "gatewayNotConfigured" };
    return { ok: false, errorKey: "generationFailed" };
  }
}

export type SendLeadEmailResult =
  | { ok: true }
  | { ok: false; errorKey: "notFound" | "noEmail" | "sendFailed"; errorDetail?: string };

/** Sends `subject`/`body` to the lead from the signed-in BD's own Gmail mailbox. */
export async function sendLeadEmailAction(
  leadId: string,
  subject: string,
  body: string,
): Promise<SendLeadEmailResult> {
  const me = await getCurrentBd();
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, errorKey: "notFound" };
  if (!lead.email) return { ok: false, errorKey: "noEmail" };

  try {
    await sendGmailMessage({
      bdId: me.id,
      to: lead.email,
      subject,
      body,
      leadId,
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      errorKey: "sendFailed",
      errorDetail: err instanceof Error ? err.message : undefined,
    };
  }
}
