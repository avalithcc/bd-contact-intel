/**
 * Pure guard behind scripts/revert-contactos-comerciales-2026-10.ts. Every
 * table that references person.id cascades on delete, so deleting a created
 * contact that someone has since worked on would silently destroy that work.
 * A contact is deletable ONLY when none of TOUCH_FLAGS applies; anything else
 * is reported and left alone. Never mutates its inputs.
 */

/** [flag, table, columns]: any row pointing at the person means someone worked on it. */
export const REFERENCING_TABLES = [
  ["activity", "activity", ["person_id"]],
  ["task", "task", ["person_id"]],
  ["email_message", "email_message", ["person_id"]],
  ["email_message_person", "email_message_person", ["person_id"]],
  ["signal", "signal", ["person_id"]],
  ["linkedin_scrape_job", "linkedin_scrape_job", ["person_id"]],
  ["follow_up_queue", "follow_up_queue_item", ["person_id"]],
  ["connection", "person_bd_connection", ["person_id"]],
  ["id_map", "person_id_map", ["person_id"]],
  ["duplicate_candidate", "duplicate_candidate", ["person_a_id", "person_b_id"]],
  ["merge_event", "merge_event", ["survivor_id", "merged_id"]],
] as const;

/** Flags that are not a plain reference: computed from the person row and its history. */
export const STATE_FLAGS = ["merged_away", "merge_winner", "edited", "owner_or_status_changed"] as const;

export const TOUCH_FLAGS = [...REFERENCING_TABLES.map(([flag]) => flag), ...STATE_FLAGS] as const;
export type TouchFlag = (typeof TOUCH_FLAGS)[number];

export interface RevertInput {
  createdIds: readonly string[];
  /** Touch flags per still-existing created person; an id absent from the map no longer exists. */
  facts: ReadonlyMap<string, readonly TouchFlag[]>;
  /** What the import filled on EXISTING contacts, from person_property_history. */
  fills: readonly { personId: string; property: string; filledValue: string }[];
  currentPhones: ReadonlyMap<string, { phone: string | null; mobilePhone: string | null }>;
}

export interface RevertPlan {
  deletable: string[];
  kept: { id: string; reasons: TouchFlag[] }[];
  missing: number;
  /** Columns to set back to NULL: only where the value is still the one the import wrote. */
  clears: { personId: string; phone: boolean; mobilePhone: boolean }[];
  /** Filled columns someone has changed since: left alone. */
  changedSince: number;
}

export function planRevert(input: RevertInput): RevertPlan {
  const deletable: string[] = [];
  const kept: RevertPlan["kept"] = [];
  let missing = 0;
  for (const id of input.createdIds) {
    const flags = input.facts.get(id);
    if (!flags) missing++;
    else if (flags.length === 0) deletable.push(id);
    else kept.push({ id, reasons: [...flags] });
  }

  const clearsById = new Map<string, { personId: string; phone: boolean; mobilePhone: boolean }>();
  let changedSince = 0;
  for (const fill of input.fills) {
    const column = fill.property === "phone" ? "phone" : fill.property === "mobilePhone" ? "mobilePhone" : null;
    const current = input.currentPhones.get(fill.personId);
    if (!column || !current) continue;
    if (current[column] !== fill.filledValue) {
      changedSince++;
      continue;
    }
    const entry = clearsById.get(fill.personId) ?? { personId: fill.personId, phone: false, mobilePhone: false };
    entry[column] = true;
    clearsById.set(fill.personId, entry);
  }
  return { deletable, kept, missing, clears: [...clearsById.values()], changedSince };
}
