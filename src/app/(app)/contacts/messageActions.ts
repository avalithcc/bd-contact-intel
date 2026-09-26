"use server";

/**
 * "Generar mensaje" on the `/contacts/[id]` record page (task 13.3, PR
 * 13c). Reuses the same prompt/generator as `/outreach`'s
 * generateOutreachMessage (src/app/outreach/actions.ts), but builds the
 * input from the unified `person` record instead of the legacy `contact`
 * table (src/lib/outreach/personMessageInput.ts) — so it works for ANY
 * person, including a teammate-only Contact the calling BD has no
 * `person_bd_connection` row for. Never reads message content (R6): only
 * the calling BD's own connection counts/dates and shared `signal.data.body`
 * research notes feed the prompt.
 */
import { and, desc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { GatewayError } from "@ai-sdk/gateway";
import { db } from "@/db";
import { person, personBdConnection, signal } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import { buildPersonMessageInput } from "@/lib/outreach/personMessageInput";
import type { GenerateOutreachMessageResult } from "@/app/(app)/outreach/actions";
import type { RoleGroupKey } from "@/lib/roleGroups";
import { isLocale, type Locale } from "@/lib/i18n/locales";

// Same gateway catalog check as OUTREACH_MODEL in src/app/outreach/actions.ts
// — kept as a separate constant (not imported) since that file's constant
// isn't exported, and duplicating one string id isn't worth widening that
// module's public surface.
const OUTREACH_MODEL = "anthropic/claude-sonnet-5";

// Same budget as draftLeadEmailAction's signal fetch (src/app/leads/actions.ts).
const MAX_SIGNALS = 10;

/**
 * Bound with (personId, locale) from the client (see QuickActions.tsx /
 * EmailForm), same convention as generateOutreachMessage — the
 * (prevState, formData) signature is what GenerateMessageButton's
 * useActionState expects; `messageLanguage` in formData picks the
 * generated message's actual language, independent of the UI locale.
 */
export async function generatePersonOutreachMessageAction(
  personId: string,
  locale: Locale,
  _prevState: GenerateOutreachMessageResult | null,
  formData: FormData,
): Promise<GenerateOutreachMessageResult> {
  const me = await getCurrentBd();

  const rawMessageLanguage = formData.get("messageLanguage");
  const messageLanguage: Locale =
    typeof rawMessageLanguage === "string" && isLocale(rawMessageLanguage) ? rawMessageLanguage : locale;

  const [row] = await db.select().from(person).where(eq(person.id, personId));
  if (!row || row.mergedIntoId) return { ok: false, errorKey: "notFound" };

  const [connectionRow] = await db
    .select({
      connectedOn: personBdConnection.connectedOn,
      messageCount: personBdConnection.messageCount,
      reciprocal: personBdConnection.reciprocal,
      lastMessageAt: personBdConnection.lastMessageAt,
    })
    .from(personBdConnection)
    .where(and(eq(personBdConnection.personId, personId), eq(personBdConnection.bdId, me.id)));

  const signalRows = await db
    .select({ data: signal.data })
    .from(signal)
    .where(eq(signal.personId, personId))
    .orderBy(desc(signal.createdAt))
    .limit(MAX_SIGNALS);
  const signalBodies = signalRows
    .map((r) => (r.data as { body?: string } | null)?.body?.trim())
    .filter((b): b is string => Boolean(b));

  const company = row.companyKey ? await getCompanyPostingsForKey(row.companyKey) : null;

  const senderName = me.name?.trim() || "Cristian Civita";
  const senderTitle = senderName === "Cristian Civita" ? "COO de Avalith" : undefined;

  const input = buildPersonMessageInput({
    person: {
      firstName: row.firstName,
      lastName: row.lastName,
      jobTitle: row.jobTitle,
      roleGroup: (row.roleGroup ?? null) as RoleGroupKey | null,
      industry: row.industry,
      companyKey: row.companyKey,
    },
    connection: connectionRow ?? null,
    signalBodies,
    company,
    senderName,
    senderTitle,
    locale: messageLanguage,
  });

  const { system, prompt } = buildOutreachMessagePrompt(input);

  try {
    const { text } = await generateText({
      model: OUTREACH_MODEL,
      system,
      prompt,
      maxOutputTokens: 350,
    });
    const message = (messageLanguage === "es" ? text.replace(/[¿¡]/g, "") : text).trim();
    if (!message) return { ok: false, errorKey: "generationFailed" };
    // historyCount is always 0 here (not signalBodies.length): the existing
    // hint copy ("Tiene en cuenta N mensajes anteriores") describes prior
    // CONVERSATION messages, which this variant never reads (R6) — reusing
    // it for the signal-note count would misrepresent what was used.
    return { ok: true, message, historyCount: 0 };
  } catch (error) {
    console.error("generatePersonOutreachMessageAction failed", error);
    if (GatewayError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) {
      return { ok: false, errorKey: "gatewayNotConfigured" };
    }
    return { ok: false, errorKey: "generationFailed" };
  }
}
