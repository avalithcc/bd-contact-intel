/**
 * "Contacto previo" cell of the Outreach table: which CRM user previously had
 * contact with this person, and HOW we know. Pure (no `@/db`), same convention
 * as lanes.ts, so the priority rule is unit-testable on its own.
 *
 * Priority: the newest attributed touch (already newest-wins in
 * previousContactRawSql) -> else the person's owner, labelled "dueño" (an
 * assignment, never "wrote to them") -> else null ("sin registro").
 */
import { argentinaDateTimeParts } from "@/lib/tasks/argentinaDate";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { formatLastActivityLabel } from "@/lib/contacts/lastActivity";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** The activity types that mean a CRM user engaged THIS PERSON, so the
 * "Contacto previo" cell can name them. Derived from WORKED_ACTIVITY_TYPES
 * ("the BD did something on this contact") rather than hand-kept, so a type
 * added there joins this cell too. `discarded` is the one exclusion: parking
 * a contact is a BD action ON the record, not contact WITH the person. Every
 * NO_PROGRESS_ACTIVITY_TYPES value is absent by construction: a Lusha
 * reveal, a bounce, an auto-reply and a dialled-but-unanswered number all
 * reached nobody, so none of them can name a previous contact. */
export const PREVIOUS_CONTACT_ACTIVITY_TYPES: readonly string[] = [...WORKED_ACTIVITY_TYPES].filter(
  (type) => type !== "discarded",
);

/** The JSON `previousContactRawSql` returns: `at` is a possibly offset-less driver string. */
export interface PreviousContactRaw {
  source: string;
  bdId: string;
  // Resolved inside the statement (see previousContactRawSql.ts); null for a deleted BD.
  name: string | null;
  at: string | null;
}

/** The person's owner as the query returns it: the id and its resolved name. */
export interface PreviousContactOwner {
  bdId: string | null | undefined;
  name: string | null | undefined;
}

export interface PreviousContact {
  bdId: string;
  name: string;
  label: string;
  at: Date | null;
}

/** `dd/mm` in the Argentina calendar, the same day basis as every other date in the CRM. */
export function formatDayMonth(at: Date): string {
  const { day, month } = argentinaDateTimeParts(at);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

export function resolvePreviousContact(
  raw: PreviousContactRaw | null | undefined,
  owner: PreviousContactOwner | null | undefined,
  dict: Dictionary,
): PreviousContact | null {
  // A BD with no name (deleted after the touch) is never shown as a uuid or an empty cell.
  if (raw && raw.name) {
    return {
      bdId: raw.bdId,
      name: raw.name,
      // The same labeller as the adjacent "Último contacto" cell, so the words cannot drift.
      label: formatLastActivityLabel({ type: raw.source, metadata: null }, dict),
      at: raw.at == null ? null : parseDbTimestamp(raw.at),
    };
  }
  if (owner && owner.bdId && owner.name) {
    return { bdId: owner.bdId, name: owner.name, label: dict.outreach.previousContactOwner, at: null };
  }
  return null;
}
