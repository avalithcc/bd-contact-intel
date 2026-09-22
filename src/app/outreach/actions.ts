"use server";

import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { GatewayError } from "@ai-sdk/gateway";
import { db } from "@/db";
import { contact } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { getRecentOutreachHistory, isLeadershipRoleGroup } from "@/lib/outreach/queries";
import { buildOutreachMessagePrompt } from "@/lib/outreach/messagePrompt";
import type { RoleGroupKey } from "@/lib/roleGroups";
import { isLocale, type Locale } from "@/lib/i18n/locales";

// Model id verified against the live AI Gateway catalog
// (https://ai-gateway.vercel.sh/v1/models) at implementation time — highest
// released Sonnet version available. Re-check that endpoint before bumping
// this if Anthropic ships a newer Sonnet.
const OUTREACH_MODEL = "anthropic/claude-sonnet-5";

export type GenerateOutreachMessageResult =
  | { ok: true; message: string; historyCount: number }
  | {
      ok: false;
      errorKey: "notFound" | "gatewayNotConfigured" | "generationFailed";
    };

/**
 * Generates one outreach LinkedIn DM for `contactId`, grounded in that
 * contact's real profile data and their company's real open IT postings —
 * see src/lib/outreach/messagePrompt.ts for the prompt itself. Scoped to the
 * signed-in BD via getCurrentBd()+bdId, same as every other contact read in
 * this app — a contactId belonging to another BD resolves to "not found",
 * never leaks another BD's data.
 *
 * Bound with (contactId, locale) from the client (see
 * GenerateMessageButton.tsx) so useActionState's (prevState, formData)
 * signature is all that's left for the form to supply. `locale` here is
 * only the UI-locale fallback: the actual message language comes from the
 * "messageLanguage" field the client submits (the inline language choice in
 * GenerateMessageButton), validated server-side against LOCALES and falling
 * back to `locale` if it's missing or invalid.
 */
export async function generateOutreachMessage(
  contactId: string,
  locale: Locale,
  _prevState: GenerateOutreachMessageResult | null,
  formData: FormData,
): Promise<GenerateOutreachMessageResult> {
  const me = await getCurrentBd();

  const rawMessageLanguage = formData.get("messageLanguage");
  const messageLanguage: Locale =
    typeof rawMessageLanguage === "string" && isLocale(rawMessageLanguage)
      ? rawMessageLanguage
      : locale;

  const row = await db.query.contact.findFirst({
    where: and(eq(contact.id, contactId), eq(contact.bdId, me.id)),
  });
  if (!row) return { ok: false, errorKey: "notFound" };

  const company = row.companyKey ? await getCompanyPostingsForKey(row.companyKey) : null;
  const history = await getRecentOutreachHistory(me.id, row.profileKey);

  // "Display name if the app has one, otherwise Cristian Civita, COO" — this
  // app's `bd.name` defaults to the email's local part at first sign-in (see
  // getCurrentBd in src/lib/queries.ts), so it's the closest thing to a
  // display name the app has. The COO title only applies to the fallback
  // identity; another BD's own name is used as-is, untitled.
  const senderName = me.name?.trim() || "Cristian Civita";
  const senderTitle = senderName === "Cristian Civita" ? "COO de Avalith" : undefined;

  const { system, prompt } = buildOutreachMessagePrompt({
    contact: {
      firstName: row.firstName,
      lastName: row.lastName,
      position: row.position,
      roleGroup: (row.roleGroup ?? null) as RoleGroupKey | null,
      isLeadership: isLeadershipRoleGroup(row.roleGroup),
      connectedOn: row.connectedOn,
    },
    company,
    history,
    senderName,
    senderTitle,
    locale: messageLanguage,
  });

  try {
    const { text } = await generateText({
      model: OUTREACH_MODEL,
      system,
      prompt,
      // The prompt caps the message at ~60-100 words (well under 150
      // tokens); this is a hard ceiling against a misbehaving/looping
      // generation blowing up latency and Gateway spend, not the expected
      // output size.
      maxOutputTokens: 350,
    });
    // Casual Spanish chat drops the opening "¿"/"¡"; the prompt asks for
    // that, and this guarantees it even if the model slips.
    const message = (messageLanguage === "es" ? text.replace(/[¿¡]/g, "") : text).trim();
    if (!message) return { ok: false, errorKey: "generationFailed" };
    return { ok: true, message, historyCount: history.length };
  } catch (error) {
    // Missing/invalid AI Gateway credentials (no AI_GATEWAY_API_KEY locally,
    // no OIDC token on Vercel) surface as an authentication failure from the
    // gateway itself — worth a distinct, actionable error message rather
    // than the generic "generation failed". The Gateway wraps *every*
    // failure (auth, 402 insufficient credits, 429 rate limit, ...) in its
    // own GatewayError subclasses before it ever reaches generateText's
    // caller — it is never an APICallError here, so that's what must be
    // checked (confirmed by reading node_modules/@ai-sdk/gateway: doGenerate
    // catches and rethrows via asGatewayError() for every error, including
    // ones raised before any HTTP call, like a missing OIDC token).
    console.error("generateOutreachMessage failed", error);
    if (GatewayError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) {
      return { ok: false, errorKey: "gatewayNotConfigured" };
    }
    return { ok: false, errorKey: "generationFailed" };
  }
}
