"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contact } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { getRecentOutreachHistory, isLeadershipRoleGroup } from "@/lib/outreach/queries";
import { runGenerateOutreachMessage, type GenerateOutreachMessageResult } from "@/lib/outreach/generateMessage";
import type { RoleGroupKey } from "@/lib/roleGroups";
import type { Locale } from "@/lib/i18n/locales";
import { isMessageLanguage, type MessageLanguage } from "@/lib/outreach/messageLanguage";

export type { GenerateOutreachMessageResult };

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
  const messageLanguage: MessageLanguage =
    typeof rawMessageLanguage === "string" && isMessageLanguage(rawMessageLanguage)
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

  return runGenerateOutreachMessage(
    {
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
      language: messageLanguage,
      // /outreach is the LinkedIn-triage view (owner direction, 2026-09-26:
      // "BDs use LinkedIn only for the first touch") — email-channel
      // generation lives on the record page and the bulk action instead.
      channel: "linkedin",
    },
    history.length,
  );
}
