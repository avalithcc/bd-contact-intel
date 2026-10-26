import type { OutreachRow } from "@/lib/outreach/ranking";

/**
 * Which server action the outreach row's "Generar mensaje" control binds,
 * and which id it takes. The two actions live in DIFFERENT id spaces:
 * `generateOutreachMessage` takes the legacy `contact.id` and is scoped to
 * the calling BD; `generatePersonOutreachMessageAction` takes the unified
 * `person.id` and works for any person, including a teammate's contact.
 * Passing one id to the other action 404s, so the choice lives here, once.
 */
export type OutreachGenerateTarget =
  | { kind: "contact"; id: string }
  | { kind: "person"; id: string }
  | { kind: "none" };

export function outreachRowGenerateTarget(
  row: Pick<OutreachRow, "id" | "hasOwnContact" | "personId">,
): OutreachGenerateTarget {
  if (row.hasOwnContact) return { kind: "contact", id: row.id };
  if (row.personId) return { kind: "person", id: row.personId };
  return { kind: "none" };
}
